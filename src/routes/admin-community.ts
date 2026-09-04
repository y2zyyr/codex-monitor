import { Hono } from 'hono';
import type { Env } from '../types';
import { getCommunityConfig } from '../community/config';
import { readCommunityFilters } from '../community/filters';
import { COMMUNITY_ADMIN_NICKNAME } from '../community/identity';
import {
  hmacSha256Hex,
  isAllowedCommunityOrigin,
  isCommunityAdminRequest,
  isValidAdminExpiry,
  isValidSourceHash,
  normalizeCommunityContent,
  validateCommunityInput,
} from '../community/security';
import { CommunityRepository, toAdminCommunityPost } from '../community/repository';
import { processCommunityPost, retryCommunityEmbeds, retryCommunityTranslation } from '../community/service';
import { backfillMonitorEventTranslations } from '../event-translations';
import type { CommunityPostStatus } from '../community/types';

const adminCommunity = new Hono<{ Bindings: Env }>();
const POST_STATUSES: CommunityPostStatus[] = ['approved', 'pending', 'hidden', 'deleted'];

function requestId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `community-admin-${Date.now().toString(36)}`;
  }
}

function errorResponse(
  c: { json: (data: unknown, status?: number) => Response },
  status: number,
  code: string,
  message: string,
  id: string,
): Response {
  const response = c.json({ error: code, message, requestId: id }, status);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

function parsePostId(value: string): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function parseStatus(value: string | undefined): CommunityPostStatus | null | 'invalid' {
  if (!value || value === 'all') return null;
  return POST_STATUSES.includes(value as CommunityPostStatus) ? value as CommunityPostStatus : 'invalid';
}

function normalizeReason(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') return null;
  return value.trim().slice(0, 240) || null;
}

function readAction(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function readAdminLimit(value: string | undefined): number | null {
  if (!value) return 20;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return null;
  return Math.min(parsed, 50);
}

function readTranslationBackfillLimit(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return 1;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return null;
  return Math.min(parsed, 3);
}

adminCommunity.use('*', async (c, next) => {
  const id = requestId();
  const config = getCommunityConfig(c.env);
  if (!isAllowedCommunityOrigin(c.req.raw, config.siteUrl)) {
    return errorResponse(c, 403, 'ORIGIN_NOT_ALLOWED', 'This operator endpoint is not available from this origin.', id);
  }
  if (!await isCommunityAdminRequest(c.req.raw, config.adminToken)) {
    return errorResponse(c, 401, 'UNAUTHORIZED', 'Administrator authentication is required.', id);
  }
  c.header('Cache-Control', 'no-store');
  await next();
});

adminCommunity.get('/posts', async (c) => {
  const id = requestId();
  const limit = readAdminLimit(c.req.query('limit'));
  if (limit === null) return errorResponse(c, 400, 'INVALID_LIMIT', 'Please use a page size between 1 and 50.', id);
  const status = parseStatus(c.req.query('status'));
  if (status === 'invalid') return errorResponse(c, 400, 'INVALID_STATUS', 'Unknown moderation status.', id);
  const filterResult = readCommunityFilters(new URL(c.req.url));
  if (filterResult.invalidTopic) return errorResponse(c, 400, 'INVALID_TOPIC', 'Unknown community topic.', id);
  const rawCursor = c.req.query('cursor');
  const cursor = rawCursor ? CommunityRepository.decodeCursor(rawCursor) : null;
  if (rawCursor && !cursor) return errorResponse(c, 400, 'INVALID_CURSOR', 'This feed page has expired. Please reload.', id);

  try {
    const result = await new CommunityRepository(c.env.DB).getAdminPosts({ limit, status, cursor, filters: filterResult.filters });
    return c.json({ ...result, filters: filterResult.filters });
  } catch (error) {
    console.error('[Community Admin] list_failed', { requestId: id, error: error instanceof Error ? error.message.slice(0, 160) : 'unknown' });
    return errorResponse(c, 500, 'ADMIN_UNAVAILABLE', 'Unable to load moderation data right now.', id);
  }
});

/**
 * Authenticated-only publisher for official announcements. The public post
 * endpoint never accepts an author role or official flag from the browser.
 */
adminCommunity.post('/posts', async (c) => {
  const request = requestId();
  const config = getCommunityConfig(c.env);
  if (!config.postingFlag) {
    return errorResponse(c, 503, 'POSTING_DISABLED', 'Community posting is temporarily disabled.', request);
  }
  const contentLength = Number(c.req.header('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > 24_000) {
    return errorResponse(c, 413, 'PAYLOAD_TOO_LARGE', 'This message is too large.', request);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return errorResponse(c, 400, 'INVALID_JSON', 'Please submit a valid announcement.', request);
  }
  const candidate = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const input = validateCommunityInput({
    nickname: COMMUNITY_ADMIN_NICKNAME,
    content: candidate.content,
    topic: candidate.topic,
  }, config, { allowReservedNickname: true });
  if (!input.ok) return errorResponse(c, 400, input.code ?? 'INVALID_INPUT', input.error, request);

  const hashSecret = config.abuseHashSecret || config.adminToken;
  if (!hashSecret) return errorResponse(c, 503, 'ADMIN_UNAVAILABLE', 'Administrator publishing is not configured.', request);

  const now = new Date();
  const repository = new CommunityRepository(c.env.DB);
  try {
    const [sourceHash, contentHash] = await Promise.all([
      hmacSha256Hex(hashSecret, 'community:admin'),
      hmacSha256Hex(hashSecret, `content:${normalizeCommunityContent(input.value.content)}`),
    ]);
    const postId = await repository.insertPost({
      nickname: COMMUNITY_ADMIN_NICKNAME,
      originalContent: input.value.content,
      topic: input.value.topic,
      authorRole: 'admin',
      isAnnouncement: true,
      isPinned: candidate.pin === true || candidate.isPinned === true,
      status: 'approved',
      moderationReason: 'admin_published',
      sourceHash,
      contentHash,
      createdAt: now.toISOString(),
    });
    console.info('[Community Admin] announcement_created', { requestId: request, postId });

    try {
      await processCommunityPost(postId, c.env, repository, config, now);
    } catch (error) {
      console.error('[Community Admin] announcement_derivative_failed', {
        requestId: request,
        postId,
        error: error instanceof Error ? error.message.slice(0, 160) : 'unknown',
      });
    }

    const saved = await repository.getPostById(postId);
    if (!saved) throw new Error('announcement could not be reloaded');
    return c.json({ data: toAdminCommunityPost(saved), message: 'Announcement published.', requestId: request }, 201);
  } catch (error) {
    console.error('[Community Admin] announcement_failed', { requestId: request, error: error instanceof Error ? error.message.slice(0, 160) : 'unknown' });
    return errorResponse(c, 500, 'ADMIN_UNAVAILABLE', 'Unable to publish the announcement right now.', request);
  }
});

adminCommunity.patch('/posts/:id', async (c) => {
  const request = requestId();
  const postId = parsePostId(c.req.param('id'));
  if (postId === null) return errorResponse(c, 400, 'INVALID_POST_ID', 'Invalid post id.', request);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return errorResponse(c, 400, 'INVALID_JSON', 'Please submit a valid moderation action.', request);
  }
  const candidate = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const action = readAction(candidate.action ?? candidate.status);
  const repository = new CommunityRepository(c.env.DB);

  try {
    const post = await repository.getPostById(postId);
    if (!post) return errorResponse(c, 404, 'POST_NOT_FOUND', 'Post not found.', request);
    if (action === 'ban' || action === 'ban-source') {
      const expiresAt = candidate.expiresAt === undefined ? null : candidate.expiresAt;
      if (!isValidAdminExpiry(expiresAt)) return errorResponse(c, 400, 'INVALID_EXPIRY', 'expiresAt must be a future timestamp.', request);
      await repository.banSource(post.sourceHash, normalizeReason(candidate.reason ?? candidate.moderationReason), expiresAt || null, new Date().toISOString());
      console.info('[Community Admin] source_banned', { requestId: request, postId, sourceHash: post.sourceHash });
      return c.json({ data: toAdminCommunityPost(post), action: 'ban-source', requestId: request });
    }
    if (action === 'unban' || action === 'unban-source') {
      await repository.unbanSource(post.sourceHash);
      console.info('[Community Admin] source_unbanned', { requestId: request, postId, sourceHash: post.sourceHash });
      return c.json({ data: toAdminCommunityPost(post), action: 'unban-source', requestId: request });
    }

    if (action === 'pin' || action === 'unpin' || action === 'feature' || action === 'unfeature') {
      const flags = action === 'pin'
        ? { isPinned: true }
        : action === 'unpin'
          ? { isPinned: false }
          : action === 'feature'
            ? { isFeatured: true }
            : { isFeatured: false };
      const updated = await repository.updatePostFlags(postId, flags, new Date().toISOString());
      if (!updated) return errorResponse(c, 404, 'POST_NOT_FOUND', 'Post not found.', request);
      const saved = await repository.getPostById(postId);
      console.info('[Community Admin] feed_flag_changed', { requestId: request, postId, action });
      return c.json({ data: saved ? toAdminCommunityPost(saved) : null, action, requestId: request });
    }

    if (post.status === 'deleted' && action === 'approve') {
      return errorResponse(c, 400, 'RESTORE_REQUIRED', 'Use restore to bring back a deleted post.', request);
    }

    const status = action === 'approve'
      ? 'approved'
      : action === 'hide'
        ? 'hidden'
        : action === 'unhide'
          ? 'approved'
          : action === 'restore'
            ? 'approved'
          : action === 'delete'
            ? 'deleted'
            : POST_STATUSES.includes(action as CommunityPostStatus) ? action as CommunityPostStatus : null;
    if (!status) return errorResponse(c, 400, 'INVALID_ACTION', 'Unknown moderation action.', request);

    const reason = normalizeReason(candidate.reason ?? candidate.moderationReason)
      ?? (action === 'restore' ? 'restored_by_admin' : null);
    const updated = await repository.updatePostStatus(postId, status, reason, new Date().toISOString());
    if (!updated) return errorResponse(c, 404, 'POST_NOT_FOUND', 'Post not found.', request);
    const saved = await repository.getPostById(postId);
    console.info('[Community Admin] moderation_decision', { requestId: request, postId, status });
    return c.json({ data: saved ? toAdminCommunityPost(saved) : null, action: status, requestId: request });
  } catch (error) {
    console.error('[Community Admin] moderation_failed', { requestId: request, postId, error: error instanceof Error ? error.message.slice(0, 160) : 'unknown' });
    return errorResponse(c, 500, 'ADMIN_UNAVAILABLE', 'Unable to update this post right now.', request);
  }
});

adminCommunity.get('/stats', async (c) => {
  const request = requestId();
  try {
    const data = await new CommunityRepository(c.env.DB).getCommunityStats();
    return c.json({ data, requestId: request });
  } catch (error) {
    console.error('[Community Admin] stats_failed', { requestId: request, error: error instanceof Error ? error.message.slice(0, 160) : 'unknown' });
    return errorResponse(c, 500, 'ADMIN_UNAVAILABLE', 'Unable to load community statistics right now.', request);
  }
});

/**
 * Authenticated maintenance endpoint for the small, write-once event
 * translation cache. It is intentionally bounded because each event can
 * require one provider call per target language.
 */
adminCommunity.post('/events/translations/backfill', async (c) => {
  const request = requestId();
  let candidate: Record<string, unknown> = {};
  const contentLength = Number(c.req.header('content-length') || 0);
  if (contentLength > 0) {
    try {
      const body = await c.req.json();
      if (body && typeof body === 'object') candidate = body as Record<string, unknown>;
    } catch {
      return errorResponse(c, 400, 'INVALID_JSON', 'Please submit a valid translation backfill request.', request);
    }
  }
  const limit = readTranslationBackfillLimit(c.req.query('limit') ?? candidate.limit);
  if (limit === null) return errorResponse(c, 400, 'INVALID_LIMIT', 'Please use a backfill size between 1 and 3.', request);

  try {
    const data = await backfillMonitorEventTranslations(c.env, limit);
    console.info('[Community Admin] event_translation_backfill', {
      requestId: request,
      processed: data.processed,
      translated: data.translated,
      failed: data.failed,
      remaining: data.remaining,
    });
    return c.json({ data, requestId: request });
  } catch (error) {
    console.error('[Community Admin] event_translation_backfill_failed', {
      requestId: request,
      error: error instanceof Error ? error.message.slice(0, 160) : 'unknown',
    });
    return errorResponse(c, 500, 'TRANSLATION_BACKFILL_FAILED', 'Unable to backfill event translations right now.', request);
  }
});

adminCommunity.delete('/posts/:id', async (c) => {
  const request = requestId();
  const postId = parsePostId(c.req.param('id'));
  if (postId === null) return errorResponse(c, 400, 'INVALID_POST_ID', 'Invalid post id.', request);
  try {
    const repository = new CommunityRepository(c.env.DB);
    const updated = await repository.updatePostStatus(postId, 'deleted', 'deleted_by_admin', new Date().toISOString());
    if (!updated) return errorResponse(c, 404, 'POST_NOT_FOUND', 'Post not found.', request);
    console.info('[Community Admin] moderation_decision', { requestId: request, postId, status: 'deleted' });
    return c.json({ ok: true, action: 'deleted', requestId: request });
  } catch (error) {
    console.error('[Community Admin] delete_failed', { requestId: request, postId, error: error instanceof Error ? error.message.slice(0, 160) : 'unknown' });
    return errorResponse(c, 500, 'ADMIN_UNAVAILABLE', 'Unable to delete this post right now.', request);
  }
});

adminCommunity.post('/posts/:id/retry-translation', async (c) => {
  const request = requestId();
  const postId = parsePostId(c.req.param('id'));
  if (postId === null) return errorResponse(c, 400, 'INVALID_POST_ID', 'Invalid post id.', request);
  try {
    const post = await retryCommunityTranslation(postId, c.env);
    if (!post) return errorResponse(c, 404, 'POST_NOT_FOUND', 'Post not found.', request);
    console.info('[Community Admin] translation_retry', { requestId: request, postId });
    return c.json({ data: toAdminCommunityPost(post), action: 'retry-translation', requestId: request });
  } catch (error) {
    console.error('[Community Admin] translation_retry_failed', { requestId: request, postId, error: error instanceof Error ? error.message.slice(0, 160) : 'unknown' });
    return errorResponse(c, 500, 'RETRY_FAILED', 'Unable to retry translation right now.', request);
  }
});

adminCommunity.post('/posts/:id/retry-embed', async (c) => {
  const request = requestId();
  const postId = parsePostId(c.req.param('id'));
  if (postId === null) return errorResponse(c, 400, 'INVALID_POST_ID', 'Invalid post id.', request);
  try {
    const post = await retryCommunityEmbeds(postId, c.env);
    if (!post) return errorResponse(c, 404, 'POST_NOT_FOUND', 'Post not found.', request);
    console.info('[Community Admin] embed_retry', { requestId: request, postId });
    return c.json({ data: toAdminCommunityPost(post), action: 'retry-embed', requestId: request });
  } catch (error) {
    console.error('[Community Admin] embed_retry_failed', { requestId: request, postId, error: error instanceof Error ? error.message.slice(0, 160) : 'unknown' });
    return errorResponse(c, 500, 'RETRY_FAILED', 'Unable to retry repository metadata right now.', request);
  }
});

adminCommunity.get('/bans', async (c) => {
  const request = requestId();
  try {
    const includeInactive = c.req.query('all') === '1' || c.req.query('includeInactive') === 'true';
    const bans = await new CommunityRepository(c.env.DB).listBans(includeInactive);
    return c.json({ data: bans, requestId: request });
  } catch (error) {
    console.error('[Community Admin] bans_list_failed', { requestId: request, error: error instanceof Error ? error.message.slice(0, 160) : 'unknown' });
    return errorResponse(c, 500, 'ADMIN_UNAVAILABLE', 'Unable to load source blocks right now.', request);
  }
});

adminCommunity.post('/bans', async (c) => {
  const request = requestId();
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return errorResponse(c, 400, 'INVALID_JSON', 'Please submit a valid source block.', request);
  }
  const candidate = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const sourceHash = typeof candidate.sourceHash === 'string' ? candidate.sourceHash.trim().toLowerCase() : '';
  if (!isValidSourceHash(sourceHash)) return errorResponse(c, 400, 'INVALID_SOURCE_HASH', 'sourceHash must be a valid source hash.', request);
  const expiresAt = candidate.expiresAt === undefined ? null : candidate.expiresAt;
  if (!isValidAdminExpiry(expiresAt)) return errorResponse(c, 400, 'INVALID_EXPIRY', 'expiresAt must be a future timestamp.', request);
  try {
    await new CommunityRepository(c.env.DB).banSource(sourceHash, normalizeReason(candidate.reason), expiresAt || null, new Date().toISOString());
    console.info('[Community Admin] source_banned', { requestId: request, sourceHash });
    return c.json({ ok: true, sourceHash, requestId: request }, 201);
  } catch (error) {
    console.error('[Community Admin] ban_failed', { requestId: request, error: error instanceof Error ? error.message.slice(0, 160) : 'unknown' });
    return errorResponse(c, 500, 'ADMIN_UNAVAILABLE', 'Unable to block this source right now.', request);
  }
});

adminCommunity.delete('/bans/:sourceHash', async (c) => {
  const request = requestId();
  const sourceHash = c.req.param('sourceHash').trim().toLowerCase();
  if (!isValidSourceHash(sourceHash)) return errorResponse(c, 400, 'INVALID_SOURCE_HASH', 'sourceHash must be a valid source hash.', request);
  try {
    const changed = await new CommunityRepository(c.env.DB).unbanSource(sourceHash);
    console.info('[Community Admin] source_unbanned', { requestId: request, sourceHash, changed });
    return c.json({ ok: true, changed, requestId: request });
  } catch (error) {
    console.error('[Community Admin] unban_failed', { requestId: request, sourceHash, error: error instanceof Error ? error.message.slice(0, 160) : 'unknown' });
    return errorResponse(c, 500, 'ADMIN_UNAVAILABLE', 'Unable to unblock this source right now.', request);
  }
});

export default adminCommunity;
