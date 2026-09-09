// ============================================================
// Tibo Monitor - bounded classifier retry semantics
// ============================================================
import type { ClassificationFailureKind, ClassificationOutcome, SourcePost } from '../types';

export const CLASSIFIER_MAX_QUALITY_ATTEMPTS = 5;
export const CLASSIFIER_PROVIDER_BACKOFF_MINUTES = [15, 30, 60, 240, 360] as const;
export const CLASSIFIER_OUTPUT_BACKOFF_MINUTES = 60;

export function isProviderFailureKind(value: string | null | undefined): value is ClassificationFailureKind {
  return value === 'TRANSIENT_PROVIDER_ERROR' || value === 'PERMANENT_OR_CONFIGURATION_ERROR';
}

export function normalizeClassificationFailureKind(
  outcome: Pick<Extract<ClassificationOutcome, { status: 'ERROR' }>, 'failureKind' | 'error' | 'errorCode'>,
): ClassificationFailureKind {
  if (outcome.failureKind === 'TRANSIENT_PROVIDER_ERROR'
    || outcome.failureKind === 'PERMANENT_OR_CONFIGURATION_ERROR'
    || outcome.failureKind === 'CLASSIFIER_OUTPUT_ERROR') {
    return outcome.failureKind;
  }
  const code = outcome.errorCode ?? outcome.error;
  if (/^(?:TIMEOUT|NETWORK_ERROR|PROVIDER_RESPONSE_ERROR|HTTP_(?:408|425|429|5\d\d))$/u.test(code)) {
    return 'TRANSIENT_PROVIDER_ERROR';
  }
  if (/^HTTP_4\d\d$/u.test(code) || code === 'LLM_NOT_CONFIGURED') {
    return 'PERMANENT_OR_CONFIGURATION_ERROR';
  }
  return 'CLASSIFIER_OUTPUT_ERROR';
}

/** Return a safe diagnostic code suitable for D1/provider status storage. */
export function boundedClassificationError(
  outcome: Pick<Extract<ClassificationOutcome, { status: 'ERROR' }>, 'failureKind' | 'error' | 'errorCode'>,
): string {
  const code = outcome.errorCode ?? outcome.error;
  if (/^(?:TIMEOUT|NETWORK_ERROR|PROVIDER_RESPONSE_ERROR|EMPTY_RESPONSE|INVALID_JSON_RESPONSE|INVALID_STRUCTURED_OUTPUT|LLM_NOT_CONFIGURED|UNEXPECTED_CLASSIFIER_ERROR|HTTP_[1-5]\d\d)$/u.test(code)) {
    return code;
  }
  const kind = normalizeClassificationFailureKind(outcome);
  return kind === 'TRANSIENT_PROVIDER_ERROR'
    ? 'PROVIDER_ERROR'
    : kind === 'PERMANENT_OR_CONFIGURATION_ERROR'
    ? 'PROVIDER_CONFIGURATION_ERROR'
    : 'CLASSIFIER_OUTPUT_ERROR';
}

export function classificationFailureKindForPost(post: Pick<SourcePost, 'classification_failure_kind' | 'classification_error'>): ClassificationFailureKind | null {
  if (post.classification_failure_kind && (
    post.classification_failure_kind === 'TRANSIENT_PROVIDER_ERROR'
    || post.classification_failure_kind === 'PERMANENT_OR_CONFIGURATION_ERROR'
    || post.classification_failure_kind === 'CLASSIFIER_OUTPUT_ERROR'
  )) {
    return post.classification_failure_kind;
  }

  // Legacy rows predate the additive taxonomy. Only recognize the bounded
  // prefixes emitted by the old classifier implementation; arbitrary stored
  // text is never copied into diagnostics.
  const error = post.classification_error ?? '';
  if (/^LLM API error: (?:408|425|429|5\d\d)$/u.test(error) || /^LLM request failed:/u.test(error)) {
    return 'TRANSIENT_PROVIDER_ERROR';
  }
  if (/^LLM API error: 4\d\d$/u.test(error)) {
    return 'PERMANENT_OR_CONFIGURATION_ERROR';
  }
  if (/^(?:Empty LLM response|Parse error:)/u.test(error)) {
    return 'CLASSIFIER_OUTPUT_ERROR';
  }
  return null;
}

export function classifierRetryDelayMinutes(attempts: number, failureKind: ClassificationFailureKind | null | undefined): number {
  if (isProviderFailureKind(failureKind)) {
    const index = Math.max(0, Math.min(CLASSIFIER_PROVIDER_BACKOFF_MINUTES.length - 1, Math.floor(attempts) - 1));
    return CLASSIFIER_PROVIDER_BACKOFF_MINUTES[index] ?? CLASSIFIER_PROVIDER_BACKOFF_MINUTES[0];
  }
  return CLASSIFIER_OUTPUT_BACKOFF_MINUTES;
}

export function isClassificationRetryEligible(post: Pick<SourcePost, 'classification_pending' | 'classification_attempts' | 'last_classification_attempt_at' | 'classification_failure_kind' | 'classification_error'>, now: Date): boolean {
  if (post.classification_pending !== true) return false;

  const attempts = Math.max(0, Math.floor(post.classification_attempts ?? 0));
  const failureKind = classificationFailureKindForPost(post);
  if (!isProviderFailureKind(failureKind) && attempts >= CLASSIFIER_MAX_QUALITY_ATTEMPTS) return false;

  const lastAttemptAt = post.last_classification_attempt_at;
  if (!lastAttemptAt) return true;
  const lastAttemptMs = new Date(lastAttemptAt).getTime();
  if (!Number.isFinite(lastAttemptMs)) return true;
  return now.getTime() >= lastAttemptMs + classifierRetryDelayMinutes(Math.max(1, attempts), failureKind) * 60_000;
}

export function isProviderFailurePost(post: Pick<SourcePost, 'classification_failure_kind' | 'classification_error'>): boolean {
  return isProviderFailureKind(classificationFailureKindForPost(post));
}

export function providerFailureKindsSql(): string {
  return "'TRANSIENT_PROVIDER_ERROR', 'PERMANENT_OR_CONFIGURATION_ERROR'";
}
