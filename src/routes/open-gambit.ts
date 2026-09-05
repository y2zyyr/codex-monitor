import { Hono } from 'hono';
import type { Context } from 'hono';
import type { ClassificationProvider, Env } from '../types';
import { classifyAndCreateEvent } from '../cron';
import { LLMClassifier } from '../classifier/llm';
import { hmacSha256Hex, isAllowedCommunityOrigin, isCommunityAdminRequest } from '../community/security';
import { Repository } from '../db/repository';
import { GambitRepository } from '../open-gambit/repository';
import { appendResolution } from '../open-gambit/resolution';
import { publishApprovedGambit, runGambitDiscovery } from '../open-gambit/service';
import { createConfiguredProviders, dispatchQualifiedGambit, workflowIdForCandidate } from '../open-gambit/workflow';
import {
  GAMBIT_APPROVAL_ACTIONS,
  GAMBIT_RESOLUTION_STATES,
  type GambitApprovalAction,
  type GambitResolutionInput,
  type GambitResolutionState,
} from '../open-gambit/types';

const openGambitApi = new Hono<{ Bindings: Env }>();

function requestId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `gambit-${Date.now().toString(36)}`;
  }
}

function adminToken(env: Env): string | null {
  return env.GAMBIT_ADMIN_TOKEN?.trim() || null;
}

function errorResponse(c: { json: (data: unknown, status?: number) => Response }, status: number, code: string, message: string, id: string): Response {
  const response = c.json({ error: code, message, requestId: id }, status);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

async function requireAdmin(c: Context<{ Bindings: Env }>): Promise<Response | null> {
  const id = requestId();
  const token = adminToken(c.env as Env);
  if (!isAllowedCommunityOrigin(c.req.raw, c.env.SITE_URL || 'https://tibo.modelyard.dev')) {
    return errorResponse(c, 403, 'ORIGIN_NOT_ALLOWED', 'This operator endpoint is not available from this origin.', id);
  }
  if (!await isCommunityAdminRequest(c.req.raw, token)) {
    return errorResponse(c, 401, 'UNAUTHORIZED', 'Administrator authentication is required.', id);
  }
  c.header('Cache-Control', 'no-store');
  return null;
}

openGambitApi.get('/articles', async (c) => {
  const rawLimit = c.req.query('limit');
  const limit = rawLimit ? Number(rawLimit) : 10;
  if (!Number.isInteger(limit) || limit < 1) return c.json({ error: 'limit must be a positive integer' }, 400);
  try {
    const articles = await new GambitRepository(c.env.DB).listPublished(Math.min(50, limit));
    return c.json({ data: articles, total: articles.length });
  } catch (error) {
    console.error('[Open Gambit] public_articles_failed', { error: error instanceof Error ? error.message.slice(0, 160) : 'unknown' });
    return c.json({ error: 'Open Gambit is not available yet.', data: [], total: 0 }, 503);
  }
});

openGambitApi.get('/articles/:slug', async (c) => {
  const slug = c.req.param('slug').trim();
  if (!/^[a-z0-9][a-z0-9-]{0,95}$/u.test(slug)) return c.json({ error: 'Invalid article slug' }, 400);
  try {
    const article = await new GambitRepository(c.env.DB).getArticleBySlug(slug);
    if (!article || article.status !== 'PUBLISHED' || article.politicalTopic) return c.json({ error: 'Article not found' }, 404);
    return c.json({ data: article });
  } catch (error) {
    console.error('[Open Gambit] public_article_failed', { error: error instanceof Error ? error.message.slice(0, 160) : 'unknown' });
    return c.json({ error: 'Open Gambit is not available yet.' }, 503);
  }
});

/**
 * Replay one already-ingested authoritative monitor post through the normal
 * classifier/event path. This is intentionally narrow and authenticated so
 * an operator can reconcile a missed historical post without broad
 * rediscovery or direct SQL event insertion.
 */
openGambitApi.post('/replay/source/:sourcePostId', async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;
  const id = requestId();
  const sourcePostId = c.req.param('sourcePostId').trim();
  if (!/^\d{5,30}$/u.test(sourcePostId)) {
    return errorResponse(c, 400, 'INVALID_SOURCE_POST_ID', 'Invalid X source post id.', id);
  }
  try {
    const repository = new Repository(c.env.DB);
    const post = await repository.getSourcePostBySourceId('x_api', sourcePostId);
    if (!post) return errorResponse(c, 404, 'SOURCE_POST_NOT_FOUND', 'Source post not found.', id);
    if (post.canonical_platform !== 'x' || post.source_quality === 'INDEXED' || post.verification_status === 'INDEXED_ONLY') {
      return errorResponse(c, 409, 'SOURCE_POST_NOT_AUTHORITATIVE', 'Only an authoritative X source post can be replayed.', id);
    }
    const result = await classifyAndCreateEvent(repository, replayClassifier(c.env), post);
    const classification = result.outcome.status === 'SUCCESS'
      ? {
        label: result.outcome.result.category,
        relevant: result.outcome.result.relevant,
        productScope: result.outcome.result.product_scope,
        statementNature: result.outcome.result.statement_nature,
        confidence: result.outcome.result.confidence,
      }
      : { label: 'ERROR', relevant: false, productScope: null, statementNature: null, confidence: null };
    return c.json({
      data: {
        sourcePostId,
        sourceRowId: post.id,
        created: result.created,
        classification,
        status: result.outcome.status,
      },
      requestId: id,
    }, result.outcome.status === 'SUCCESS' ? 200 : 503);
  } catch (error) {
    console.error('[Open Gambit] source_replay_failed', { requestId: id, error: error instanceof Error ? error.message.slice(0, 160) : 'unknown' });
    return errorResponse(c, 500, 'SOURCE_REPLAY_FAILED', 'The source post replay failed safely.', id);
  }
});

function replayClassifier(env: Env): ClassificationProvider {
  if (env.LLM_API_KEY?.trim()) return new LLMClassifier(env);
  // Staging deliberately has no legacy monitor LLM credential. Keep this
  // replay-only fallback bounded and conservative: contextual deterministic
  // reset rules may still admit a trusted strong reset, while ordinary posts
  // remain non-events without sharing Gambit's separate credential namespace.
  return {
    classify: async () => ({
      status: 'SUCCESS' as const,
      result: {
        relevant: false,
        category: 'IRRELEVANT' as const,
        product_scope: 'OTHER' as const,
        statement_nature: 'FACT' as const,
        confidence: 0,
        title_en: '',
        title_zh: '',
        summary_en: '',
        summary_zh: '',
        effective_time: null,
        reset_time: null,
        reason: 'Replay-only conservative fallback; no classifier credential is configured.',
      },
    }),
  };
}

openGambitApi.get('/review', async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;
  try {
    return c.json({ data: await new GambitRepository(c.env.DB).listReviewQueue(50) });
  } catch {
    return errorResponse(c, 503, 'REVIEW_UNAVAILABLE', 'Review data is not available yet.', requestId());
  }
});

openGambitApi.post('/discovery/run', async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;
  const id = requestId();
  const parsedBody = await boundedJsonBody(c, 8_000, id, 'Please submit a valid discovery request.');
  if (parsedBody instanceof Response) return parsedBody;
  const body = parsedBody;
  const windowKey = typeof body.windowKey === 'string' && /^[A-Za-z0-9:_-]{1,80}$/u.test(body.windowKey) ? body.windowKey : undefined;
  try {
    const result = await runGambitDiscovery(c.env, {
      windowKey,
      startWorkflows: body.startWorkflows !== false,
    });
    return c.json({ data: result, requestId: id }, 200);
  } catch (error) {
    console.error('[Open Gambit] discovery_failed', { requestId: id, error: error instanceof Error ? error.message.slice(0, 160) : 'unknown' });
    return errorResponse(c, 500, 'DISCOVERY_FAILED', 'The bounded discovery run failed safely.', id);
  }
});

openGambitApi.post('/candidates/:id/workflow', async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;
  const id = requestId();
  const parsedBody = await boundedJsonBody(c, 8_000, id, 'Please submit a valid workflow request.');
  if (parsedBody instanceof Response) return parsedBody;
  const candidateId = positiveInteger(c.req.param('id'));
  if (!candidateId) return errorResponse(c, 400, 'INVALID_CANDIDATE_ID', 'Invalid candidate id.', id);
  try {
    const repository = new GambitRepository(c.env.DB);
    const candidate = await repository.getCandidate(candidateId);
    if (!candidate) return errorResponse(c, 404, 'CANDIDATE_NOT_FOUND', 'Candidate not found.', id);
    if (candidate.status !== 'QUALIFIED') return errorResponse(c, 409, 'CANDIDATE_NOT_QUALIFIED', 'Only a qualified candidate can start analysis.', id);
    const result = await dispatchQualifiedGambit({ workflowId: workflowIdForCandidate(candidateId), candidateId, snapshotIds: candidate.snapshotIds }, c.env, {
      repository,
      binding: c.env.GAMBIT_ANALYSIS_WORKFLOW as unknown as import('../open-gambit/workflow').WorkflowBindingLike | undefined,
      providers: createConfiguredProviders(c.env),
    });
    return c.json({ data: result, requestId: id }, 202);
  } catch (error) {
    console.error('[Open Gambit] workflow_dispatch_failed', { requestId: id, error: error instanceof Error ? error.message.slice(0, 160) : 'unknown' });
    return errorResponse(c, 500, 'WORKFLOW_DISPATCH_FAILED', 'The analysis workflow could not be started.', id);
  }
});

openGambitApi.post('/review/:revisionId', async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;
  const id = requestId();
  const revisionId = positiveInteger(c.req.param('revisionId'));
  if (!revisionId) return errorResponse(c, 400, 'INVALID_REVISION_ID', 'Invalid revision id.', id);
  const parsedBody = await boundedJsonBody(c, 16_000, id, 'Please submit a valid review action.');
  if (parsedBody instanceof Response) return parsedBody;
  const body = parsedBody;
  const action = typeof body.action === 'string' ? body.action.trim().toUpperCase() : '';
  if (!GAMBIT_APPROVAL_ACTIONS.includes(action as GambitApprovalAction)) return errorResponse(c, 400, 'INVALID_ACTION', 'Action must be APPROVE, REJECT, or RETURN_FOR_REANALYSIS.', id);
  const idempotencyKey = c.req.header('Idempotency-Key')?.trim() || (typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '');
  if (!/^[A-Za-z0-9._:-]{8,128}$/u.test(idempotencyKey)) return errorResponse(c, 400, 'IDEMPOTENCY_REQUIRED', 'Provide a bounded Idempotency-Key.', id);
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : null;
  try {
    const token = adminToken(c.env)!;
    const adminSubjectHash = await hmacSha256Hex(token, 'open-gambit-admin');
    const repository = new GambitRepository(c.env.DB);
    const approval = await repository.approveRevision({
      revisionId,
      action: action as GambitApprovalAction,
      adminSubjectHash,
      idempotencyKey,
      staleAcknowledged: body.staleAcknowledged === true,
      note,
    });
    const publication = approval.approved && !approval.idempotent
      ? await publishApprovedGambit(c.env, approval.articleId, approval.revisionId, { repository, translationProvider: createConfiguredProviders(c.env).translation })
      : null;
    return c.json({ data: { approval, publication }, requestId: id }, 200);
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (code === 'STALE_REVISION') return errorResponse(c, 409, 'STALE_REVISION', 'A newer draft revision exists; acknowledge it explicitly before approving.', id);
    if (code === 'REVISION_NOT_FOUND' || code === 'ARTICLE_NOT_FOUND') return errorResponse(c, 404, 'REVISION_NOT_FOUND', 'Draft revision not found.', id);
    console.error('[Open Gambit] review_failed', { requestId: id, error: code.slice(0, 160) || 'unknown' });
    return errorResponse(c, 500, 'REVIEW_FAILED', 'The review action failed safely.', id);
  }
});

openGambitApi.post('/predictions/:id/resolve', async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;
  const id = requestId();
  const predictionId = positiveInteger(c.req.param('id'));
  if (!predictionId) return errorResponse(c, 400, 'INVALID_PREDICTION_ID', 'Invalid prediction id.', id);
  const parsedBody = await boundedJsonBody(c, 12_000, id, 'Please submit a valid resolution event.');
  if (parsedBody instanceof Response) return parsedBody;
  const body = parsedBody;
  const state = typeof body.state === 'string' ? body.state.toUpperCase() : '';
  const evaluatorResult = typeof body.evaluatorResult === 'string' ? body.evaluatorResult.toUpperCase() : 'HUMAN_REVIEW';
  const reviewState = typeof body.reviewState === 'string' ? body.reviewState.toUpperCase() : 'APPROVED';
  const explanation = typeof body.explanation === 'string' ? body.explanation.trim().slice(0, 2_000) : '';
  const evidenceIds = Array.isArray(body.evidenceIds) ? body.evidenceIds.filter((value): value is number => Number.isInteger(value) && value > 0).slice(0, 20) : [];
  if (!GAMBIT_RESOLUTION_STATES.includes(state as GambitResolutionState) || !explanation) return errorResponse(c, 400, 'INVALID_RESOLUTION', 'A valid state and explanation are required.', id);
  if (!['DETERMINISTIC', 'PRIMARY_SOURCE', 'SECONDARY_CORROBORATION', 'LLM_INTERPRETATION', 'HUMAN_REVIEW'].includes(evaluatorResult)) return errorResponse(c, 400, 'INVALID_EVALUATOR', 'Unknown evaluator result.', id);
  if (!['NOT_REQUIRED', 'WAITING_FOR_REVIEW', 'APPROVED'].includes(reviewState)) return errorResponse(c, 400, 'INVALID_REVIEW_STATE', 'Unknown review state.', id);
  try {
    const event = await appendResolution(new GambitRepository(c.env.DB), predictionId, {
      state: state as GambitResolutionState,
      evaluatorResult: evaluatorResult as GambitResolutionInput['evaluatorResult'],
      reviewState: reviewState as GambitResolutionInput['reviewState'],
      explanation,
      evidenceIds,
      supersededReason: typeof body.supersededReason === 'string' ? body.supersededReason.trim().slice(0, 500) : null,
    });
    return c.json({ data: event, requestId: id }, 201);
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (code === 'SUPERSEDED_REQUIRES_REASON_EVIDENCE_AND_APPROVAL') return errorResponse(c, 400, 'SUPERSEDED_REQUIRES_REVIEW', 'SUPERSEDED requires evidence, an explanation, and approved human review.', id);
    console.error('[Open Gambit] resolution_failed', { requestId: id, error: code.slice(0, 160) || 'unknown' });
    return errorResponse(c, 500, 'RESOLUTION_FAILED', 'The append-only resolution event could not be recorded.', id);
  }
});

openGambitApi.post('/articles/:id/corrections', async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;
  const request = requestId();
  const articleId = positiveInteger(c.req.param('id'));
  if (!articleId) return errorResponse(c, 400, 'INVALID_ARTICLE_ID', 'Invalid article id.', request);
  const parsedBody = await boundedJsonBody(c, 12_000, request, 'Please submit a valid correction.');
  if (parsedBody instanceof Response) return parsedBody;
  const body = parsedBody;
  const correctionType = typeof body.correctionType === 'string' ? body.correctionType.toUpperCase() : '';
  const explanation = typeof body.explanation === 'string' ? body.explanation.trim().slice(0, 2_000) : '';
  const predictionId = positiveInteger(String(body.predictionId ?? ''));
  const evidenceIds = Array.isArray(body.evidenceIds) ? body.evidenceIds.filter((value): value is number => Number.isInteger(value) && value > 0).slice(0, 20) : [];
  if (!['CORRECTION', 'RETRACTION', 'SUPERSESSION'].includes(correctionType) || explanation.length < 3 || evidenceIds.length === 0) {
    return errorResponse(c, 400, 'INVALID_CORRECTION', 'A valid correction type, explanation, and evidence are required.', request);
  }
  try {
    const id = await new GambitRepository(c.env.DB).addCorrection({
      articleId,
      predictionId,
      correctionType: correctionType as 'CORRECTION' | 'RETRACTION' | 'SUPERSESSION',
      explanation,
      evidenceIds,
    });
    return c.json({ data: { id, idempotent: id === 0 }, requestId: request }, 201);
  } catch (error) {
    if (error instanceof Error && error.message === 'CORRECTION_REQUIRES_EVIDENCE') return errorResponse(c, 400, 'CORRECTION_REQUIRES_EVIDENCE', 'A correction must cite evidence.', request);
    console.error('[Open Gambit] correction_failed', { requestId: request, error: error instanceof Error ? error.message.slice(0, 160) : 'unknown' });
    return errorResponse(c, 500, 'CORRECTION_FAILED', 'The append-only correction could not be recorded.', request);
  }
});

function positiveInteger(value: string): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function boundedJsonBody(
  c: Context<{ Bindings: Env }>,
  maxBytes: number,
  requestIdValue: string,
  invalidMessage: string,
): Promise<Record<string, unknown> | Response> {
  const contentLength = Number(c.req.header('content-length') || '');
  if (Number.isFinite(contentLength) && contentLength > maxBytes) return errorResponse(c, 413, 'PAYLOAD_TOO_LARGE', 'The request is too large.', requestIdValue);
  const stream = c.req.raw.body;
  if (!stream) return {};
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      totalBytes += part.value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        return errorResponse(c, 413, 'PAYLOAD_TOO_LARGE', 'The request is too large.', requestIdValue);
      }
      chunks.push(part.value);
    }
  } catch {
    return errorResponse(c, 400, 'INVALID_JSON', invalidMessage, requestIdValue);
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return errorResponse(c, 400, 'INVALID_JSON', invalidMessage, requestIdValue);
  }
}

export default openGambitApi;
