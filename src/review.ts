import type { ClassificationProvider, Env, EventCategory } from './types';
import { EVENT_CATEGORIES } from './types';
import { Repository } from './db/repository';
import { applyTrustedResetContext, CLASSIFIER_VERSION, getTrustedSourceContext, hasExplicitCodexReference, hasCredibleActiveResetContext, isCodexProductSignalAdmissible } from './classifier/types';
import { providerUsageDate } from './utils/schedule';

export class ReviewError extends Error {
  constructor(public code: string, public status: 400 | 404 | 409 | 422 | 429 | 503) { super(code); }
}
export const REVIEW_REJECT_REASONS = ['OPERATOR_REJECTED', 'NON_RESET_CONTEXT', 'INSUFFICIENT_EVIDENCE'] as const;
/** Serializes manual resolution, including lifecycle repair, without a migration. */
export async function resolveReview(repo: Repository, classifier: ClassificationProvider, input: unknown, now = new Date()) {
  const body = input as { id?: number; action?: string } | null;
  if (!body || !Number.isSafeInteger(body.id) || body.id! <= 0 || !['publish', 'reject'].includes(body.action ?? '')) throw new ReviewError('INVALID_REVIEW_REQUEST', 400);
  const key = `review_resolve:${body.id}`;
  const lock = await repo.acquireLock(key, now, 120);
  if (!lock) throw new ReviewError('REVIEW_BUSY', 409);
  try { return await resolveReviewUnlocked(repo, classifier, input, now); }
  finally { await repo.releaseLock(key, lock); }
}

async function resolveReviewUnlocked(repo: Repository, classifier: ClassificationProvider, input: unknown, now = new Date()) {
  const body = input as { id?: number; action?: string; category?: EventCategory; reason?: string } | null;
  if (!body || !Number.isSafeInteger(body.id) || body.id! <= 0 || !['publish', 'reject'].includes(body.action ?? '')) throw new ReviewError('INVALID_REVIEW_REQUEST', 400);
  if (body.category !== undefined && (!EVENT_CATEGORIES.includes(body.category) || body.category === 'IRRELEVANT')) throw new ReviewError('INVALID_CATEGORY', 400);
  if (body.reason !== undefined && !(REVIEW_REJECT_REASONS as readonly string[]).includes(body.reason)) throw new ReviewError('INVALID_REASON_CODE', 400);
  const post = await repo.getSourcePostById(body.id!);
  if (!post) throw new ReviewError('SOURCE_NOT_FOUND', 404);
  if (post.verification_status === 'REJECTED' || post.classification_reason_code === 'OPERATOR_REJECTED') throw new ReviewError('REJECTED_TERMINAL', 409);
  if (post.classification_decision !== 'REVIEW') throw new ReviewError('NOT_IN_REVIEW', 409);
  if (body.action === 'reject') {
    if (!await repo.rejectReview(post.id!, body.reason ?? 'OPERATOR_REJECTED')) throw new ReviewError('REVIEW_CONFLICT', 409);
    return { action: 'reject', id: post.id };
  }
  if (!getTrustedSourceContext(post).trusted || post.source_quality !== 'DIRECT' || post.verification_status !== 'DIRECT_VERIFIED') throw new ReviewError('DIRECT_EVIDENCE_REQUIRED', 422);
  // Replaying a partially completed publish repairs lifecycle before closing
  // the queue; the unique source key keeps concurrent publishes idempotent.
  let event = await repo.getReviewEvent(post.id!);
  if (event && event.verification_status !== 'DIRECT_VERIFIED') throw new ReviewError('REJECTED_TERMINAL', 409);
  if (!event) {
    if (!await repo.reserveProviderUsage('review_classifier', providerUsageDate(now), 8, now.toISOString(), `review:${post.id}:${now.toISOString()}`)) throw new ReviewError('REVIEW_BUDGET_EXHAUSTED', 429);
    const outcome = await classifier.classify(post);
    if (outcome.status !== 'SUCCESS') throw new ReviewError('REVIEW_CLASSIFIER_UNAVAILABLE', 503);
    // An operator category choice cannot turn an observation into a fact.
    if (outcome.result.statement_nature === 'OBSERVATION') throw new ReviewError('OBSERVATION_NOT_ADMITTED', 422);
    const cycle = await repo.getActiveResetCycle({ advance: false });
    const context = applyTrustedResetContext(post, outcome, { activeCodexReset: hasCredibleActiveResetContext(cycle) });
    if (context.outcome.status !== 'SUCCESS') throw new ReviewError('REVIEW_NOT_ADMISSIBLE', 422);
    const result = context.outcome.result;
    if (body.category && body.category !== result.category) throw new ReviewError('CATEGORY_EVIDENCE_MISMATCH', 422);
    if (!result.relevant || result.category === 'IRRELEVANT' || result.product_scope !== 'CODEX' || !isCodexProductSignalAdmissible(result)
      || !(hasExplicitCodexReference(post.text) || context.applied)) throw new ReviewError('REVIEW_NOT_ADMISSIBLE', 422);
    await repo.insertEvent({ source_post_id: post.id!, category: result.category, title_en: result.title_en, title_zh: result.title_zh,
      summary_en: result.summary_en, summary_zh: result.summary_zh, confidence: result.confidence,
      published_at: post.published_at, effective_at: result.effective_time, reset_at: result.reset_time,
      source_url: post.source_url, source_quality: 'DIRECT', evidence_quality: 'DIRECT', verification_status: 'DIRECT_VERIFIED', verified_at: now.toISOString(),
    }, true);
    event = await repo.getReviewEvent(post.id!);
    if (!event || event.verification_status !== 'DIRECT_VERIFIED') throw new ReviewError('REVIEW_CONFLICT', 409);
  }
  if (['RESET_PLANNED', 'RESET_COMPLETED', 'RESET_TIME_CHANGED'].includes(event.category)) await repo.handleResetEvent(event);
  await repo.markClassified(post.id!);
  await repo.recordClassificationDecision(post.id!, { classification_label: event.category, classification_decision: 'EVENT_CREATED',
    classification_reason_code: 'REVIEW_PUBLISHED', classification_source_context: getTrustedSourceContext(post).sourceContext,
    classification_event_created: true, classifier_version: CLASSIFIER_VERSION });
  return { action: 'publish', id: post.id, eventId: event.id };
}

export function evaluateReviewAlert(queue: { count: number; oldestAt: string | null }, env: Env, now = new Date()) {
  const hours = Number(env.REVIEW_ALERT_AFTER_HOURS ?? '6');
  const threshold = Number.isFinite(hours) && hours >= 0 ? hours : 6;
  const overdue = queue.count > 0 && queue.oldestAt !== null && now.getTime() - new Date(queue.oldestAt).getTime() >= threshold * 3600000;
  return { ...queue, overdue, thresholdHours: threshold, checkedAt: now.toISOString() };
}

export async function recordReviewAlert(repo: Repository, env: Env, now = new Date()) {
  const alert = evaluateReviewAlert(await repo.getReviewQueueStats(), env, now);
  const { overdue } = alert;
  await repo.setSetting('review_queue_alert', JSON.stringify(alert));
  if (env.REVIEW_ALERT_PROVIDER_STATUS === 'true') await repo.recordProviderStatus('review-queue', overdue ? 'degraded' : 'ok', overdue ? null : now.toISOString(), overdue ? 'REVIEW_QUEUE_OVERDUE' : null);
  return alert;
}
