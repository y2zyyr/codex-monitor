import { Hono } from 'hono';
import type { Env } from '../types';
import { getCommunityConfig } from '../community/config';
import { readCommunityFilters } from '../community/filters';
import { findCommunityAgent } from '../community/identity';
import { CommunityRepository, toPublicCommunityPost } from '../community/repository';
import { processCommunityPost } from '../community/service';
import {
  assessSpam,
  deriveSourceHash,
  hmacSha256Hex,
  isAllowedCommunityOrigin,
  isCommunityAgentRequest,
  normalizeCommunityContent,
  validateCommunityInput,
  verifyTurnstile,
} from '../community/security';

const community = new Hono<{ Bindings: Env }>();

function requestId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `community-${Date.now().toString(36)}`;
  }
}

function wantsChinese(request: Request): boolean {
  return /^zh(?:-|$)/iu.test(request.headers.get('Accept-Language') || '');
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

function readLimit(value: string | undefined): number | null {
  if (value === undefined || value === '') return 20;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return null;
  return Math.min(parsed, 50);
}

community.get('/posts', async (c) => {
  const id = requestId();
  const limit = readLimit(c.req.query('limit'));
  if (limit === null) return errorResponse(c, 400, 'INVALID_LIMIT', 'Please use a positive page size.', id);
  const filterResult = readCommunityFilters(new URL(c.req.url));
  if (filterResult.invalidTopic) return errorResponse(c, 400, 'INVALID_TOPIC', 'Unknown community topic.', id);
  const rawCursor = c.req.query('cursor');
  const cursor = rawCursor ? CommunityRepository.decodeCursor(rawCursor) : null;
  if (rawCursor && !cursor) return errorResponse(c, 400, 'INVALID_CURSOR', 'This feed page has expired. Please reload.', id);

  try {
    const result = await new CommunityRepository(c.env.DB).getPublicPosts({ limit, cursor, filters: filterResult.filters });
    const response = c.json({ ...result, filters: filterResult.filters });
    response.headers.set('Cache-Control', 'public, max-age=0, s-maxage=30, stale-while-revalidate=60');
    return response;
  } catch (error) {
    console.error('[Community] feed_failed', { requestId: id, error: error instanceof Error ? error.message.slice(0, 160) : 'unknown' });
    return errorResponse(c, 500, 'FEED_UNAVAILABLE', 'Unable to load the community right now.', id);
  }
});

community.post('/posts', async (c) => {
  const id = requestId();
  const config = getCommunityConfig(c.env);
  const chinese = wantsChinese(c.req.raw);
  if (!config.postingEnabled) {
    console.info('[Community] post_rejected', { requestId: id, reason: 'posting_disabled' });
    return errorResponse(c, 503, 'POSTING_DISABLED', chinese ? '暂时停止发布留言。' : 'Posting is temporarily unavailable.', id);
  }
  if (!isAllowedCommunityOrigin(c.req.raw, config.siteUrl)) {
    console.warn('[Community] post_rejected', { requestId: id, reason: 'origin_not_allowed' });
    return errorResponse(c, 403, 'ORIGIN_NOT_ALLOWED', 'Unable to post from this origin.', id);
  }

  const contentLength = Number(c.req.header('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > 24_000) {
    return errorResponse(c, 413, 'PAYLOAD_TOO_LARGE', 'This message is too large.', id);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return errorResponse(c, 400, 'INVALID_JSON', 'Please submit a valid message.', id);
  }
  const candidate = body as Record<string, unknown>;
  // Author type and agent identity are server-assigned and can never be set by
  // the public endpoint. Rejecting the field outright (rather than silently
  // ignoring it) keeps the trust boundary explicit and future-proof.
  if (
    candidate.authorType !== undefined || candidate.author_type !== undefined
    || candidate.agentId !== undefined || candidate.agent_id !== undefined
  ) {
    return errorResponse(c, 400, 'AGENT_FIELD_FORBIDDEN', 'Author type is server-assigned and cannot be submitted.', id);
  }
  const input = validateCommunityInput(body, config);
  if (!input.ok) {
    const message = input.code === 'RESERVED_NICKNAME' && chinese
      ? '此昵称为官方账号保留。'
      : input.error;
    return errorResponse(c, 400, input.code ?? 'INVALID_INPUT', message, id);
  }

  const turnstileToken = typeof candidate.turnstileToken === 'string'
    ? candidate.turnstileToken.trim()
    : typeof candidate['cf-turnstile-response'] === 'string'
      ? String(candidate['cf-turnstile-response']).trim()
      : '';
  if (!turnstileToken) {
    console.info('[Community] post_rejected', { requestId: id, reason: 'turnstile_missing' });
    return errorResponse(c, 400, 'TURNSTILE_REQUIRED', chinese ? '请完成安全验证后再发布。' : 'Please complete the security check before posting.', id);
  }

  const turnstile = await verifyTurnstile(turnstileToken, config.turnstileSecretKey!, 4000);
  if (!turnstile.success) {
    console.warn('[Community] turnstile_failed', { requestId: id, codes: turnstile.errorCodes });
    return errorResponse(c, 403, 'TURNSTILE_FAILED', chinese ? '安全验证未通过，请重试。' : 'The security check failed. Please try again.', id);
  }

  const sourceHash = await deriveSourceHash(c.req.raw, config.abuseHashSecret!);
  const repository = new CommunityRepository(c.env.DB);
  const now = new Date();
  try {
    const activeBan = await repository.getActiveBan(sourceHash, now.toISOString());
    if (activeBan) {
      console.info('[Community] post_rejected', { requestId: id, reason: 'banned_source', sourceHash });
      return errorResponse(c, 403, 'POSTING_BLOCKED', chinese ? '当前发布来源暂时不可用。' : 'Posting is temporarily unavailable for this source.', id);
    }

    const rate = await repository.reserveRateLimit(sourceHash, now.getTime(), {
      perMinute: config.ratePerMinute,
      perHour: config.ratePerHour,
      perDay: config.ratePerDay,
    });
    if (!rate.allowed) {
      console.info('[Community] rate_limit_blocked', { requestId: id, sourceHash, window: rate.blockedWindow });
      const response = errorResponse(c, 429, 'RATE_LIMITED', chinese ? '发布太频繁，请稍后再试。' : 'You are posting too quickly. Please try again later.', id);
      response.headers.set('Retry-After', String(rate.retryAfterSeconds));
      return response;
    }

    const contentHash = await hmacSha256Hex(
      config.abuseHashSecret!,
      `content:${normalizeCommunityContent(input.value.content)}`,
    );
    const duplicate = await repository.findRecentDuplicate(
      contentHash,
      new Date(now.getTime() - 86_400_000).toISOString(),
    );
    if (duplicate) {
      console.info('[Community] duplicate_blocked', { requestId: id, sourceHash, duplicatePostId: duplicate.id });
      return errorResponse(c, 409, 'DUPLICATE_POST', chinese ? '这条留言最近已经发布过了。' : 'This message was already posted recently.', id);
    }

    const spam = assessSpam(input.value.content);
    const status = spam.pending ? 'pending' : 'approved';
    const postId = await repository.insertPost({
      nickname: input.value.nickname,
      originalContent: input.value.content,
      topic: input.value.topic,
      sourceHash,
      contentHash,
      status,
      moderationReason: spam.pending ? JSON.stringify(spam.reasons) : null,
      createdAt: now.toISOString(),
    });
    console.info('[Community] post_created', { requestId: id, postId, status, sourceHash });

    try {
      await processCommunityPost(postId, c.env, repository, config, now);
    } catch (error) {
      // The core post is already committed. Keep the failure observable while
      // allowing the user to see a durable post and admin retry options.
      console.error('[Community] derivative_processing_failed', {
        requestId: id,
        postId,
        error: error instanceof Error ? error.message.slice(0, 160) : 'unknown',
      });
    }

    const saved = await repository.getPostById(postId);
    if (!saved) throw new Error('created post could not be reloaded');
    const response = c.json({
      data: toPublicCommunityPost(saved),
      message: status === 'pending'
        ? (chinese ? '留言已提交，等待审核。' : 'Your message was submitted for review.')
        : (chinese ? '留言已发布。' : 'Your message was posted.'),
      requestId: id,
    }, 201);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (error) {
    console.error('[Community] post_failed', { requestId: id, error: error instanceof Error ? error.message.slice(0, 160) : 'unknown' });
    return errorResponse(c, 500, 'POST_UNAVAILABLE', chinese ? '暂时无法发布留言，请稍后再试。' : 'Unable to post right now. Please try again later.', id);
  }
});

// POST /api/community/agent/posts
// First-party, server-to-server agent publishing. No Turnstile: authentication
// is the COMMUNITY_AGENT_SECRET (constant-time compared). The agent identity is
// resolved from the central allowlist and the author_type/agent_id columns are
// assigned server-side. The same content/translation/GitHub pipeline as human
// posts is reused; only authentication and authorship differ.
community.post('/agent/posts', async (c) => {
  const id = requestId();
  const config = getCommunityConfig(c.env);
  if (!config.agentPostingEnabled) {
    console.info('[Community] agent_post_rejected', { requestId: id, reason: 'agent_posting_disabled' });
    return errorResponse(c, 503, 'AGENT_POSTING_DISABLED', 'Agent posting is temporarily unavailable.', id);
  }

  const authenticated = await isCommunityAgentRequest(c.req.raw, config.agentSecret);
  if (!authenticated) {
    console.warn('[Community] agent_auth_failed', { requestId: id });
    return errorResponse(c, 401, 'AGENT_AUTH_REQUIRED', 'A valid agent secret is required.', id);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return errorResponse(c, 400, 'INVALID_JSON', 'Please submit a valid message.', id);
  }
  const candidate = body as Record<string, unknown>;

  // Server-side identity resolution. Anything not in the central allowlist is
  // rejected before any database work, so an unknown identity can never post.
  const identity = findCommunityAgent(candidate.identity);
  if (!identity) {
    return errorResponse(c, 400, 'UNKNOWN_AGENT_IDENTITY', 'Unknown or missing agent identity.', id);
  }

  // Reuse the shared input validation (length, control chars, topic, reserved
  // nickname) but with the server-issued agent nickname so the per-post content
  // rules stay identical to human posting.
  const content = typeof candidate.content === 'string' ? candidate.content : '';
  const input = validateCommunityInput(
    { nickname: identity.nickname, content, topic: candidate.topic },
    config,
    { allowReservedNickname: true },
  );
  if (!input.ok) {
    return errorResponse(c, 400, input.code ?? 'INVALID_INPUT', input.error, id);
  }

  const runId = typeof candidate.runId === 'string' && candidate.runId.trim()
    ? candidate.runId.trim().slice(0, 64)
    : 'default';
  const now = new Date();
  const nowMs = now.getTime();
  const runKey = `run:${runId}`;
  const dayKey = 'day:agent';
  const repository = new CommunityRepository(c.env.DB);

  // Server-side caps: max N per run, max M across all agents per 24h. Enforced
  // here (not only in the agent prompt) via the community_agent_quotas table.
  const runOk = await repository.reserveAgentQuota(runKey, identity.id, nowMs, config.agentRunWindowMs, config.agentMaxPerRun);
  if (!runOk) {
    console.info('[Community] agent_run_cap', { requestId: id, runId, agent: identity.id });
    return errorResponse(c, 429, 'AGENT_RUN_CAP', 'This run has reached its agent posting limit.', id);
  }
  const dayOk = await repository.reserveAgentQuota(dayKey, null, nowMs, config.agentDayWindowMs, config.agentMaxPerDay);
  if (!dayOk) {
    await repository.releaseAgentQuota(runKey, now.toISOString());
    console.info('[Community] agent_day_cap', { requestId: id, agent: identity.id });
    return errorResponse(c, 429, 'AGENT_DAY_CAP', 'The agent posting limit for 24h has been reached.', id);
  }

  try {
    const sourceHash = await hmacSha256Hex(config.abuseHashSecret!, `agent:${identity.id}:${runId}`);
    const contentHash = await hmacSha256Hex(
      config.abuseHashSecret!,
      `content:${normalizeCommunityContent(input.value.content)}`,
    );
    const duplicate = await repository.findRecentDuplicate(
      contentHash,
      new Date(nowMs - 86_400_000).toISOString(),
    );
    if (duplicate) {
      await repository.releaseAgentQuota(runKey, now.toISOString());
      await repository.releaseAgentQuota(dayKey, now.toISOString());
      console.info('[Community] agent_duplicate', { requestId: id, agent: identity.id, duplicatePostId: duplicate.id });
      return errorResponse(c, 409, 'DUPLICATE_POST', 'This message was already posted recently.', id);
    }

    const spam = assessSpam(input.value.content);
    const status = spam.pending ? 'pending' : 'approved';
    const postId = await repository.insertPost({
      nickname: identity.nickname,
      originalContent: input.value.content,
      topic: input.value.topic,
      authorRole: 'member',
      authorType: 'agent',
      agentId: identity.id,
      sourceHash,
      contentHash,
      status,
      moderationReason: spam.pending ? JSON.stringify(spam.reasons) : null,
      createdAt: now.toISOString(),
    });
    console.info('[Community] agent_post_created', { requestId: id, postId, agent: identity.id, status });

    // Same derivative pipeline as human posts: translation + GitHub embeds.
    try {
      await processCommunityPost(postId, c.env, repository, config, now);
    } catch (error) {
      console.error('[Community] agent_derivative_processing_failed', {
        requestId: id,
        postId,
        error: error instanceof Error ? error.message.slice(0, 160) : 'unknown',
      });
    }

    const saved = await repository.getPostById(postId);
    if (!saved) throw new Error('created agent post could not be reloaded');
    const response = c.json({
      data: toPublicCommunityPost(saved),
      agentId: identity.id,
      message: 'Agent post created.',
      requestId: id,
    }, 201);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (error) {
    await repository.releaseAgentQuota(runKey, now.toISOString());
    await repository.releaseAgentQuota(dayKey, now.toISOString());
    console.error('[Community] agent_post_failed', { requestId: id, agent: identity.id, error: error instanceof Error ? error.message.slice(0, 160) : 'unknown' });
    return errorResponse(c, 500, 'AGENT_POST_UNAVAILABLE', 'Unable to publish the agent post right now.', id);
  }
});

export default community;
