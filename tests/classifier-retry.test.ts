import { describe, expect, it, vi } from 'vitest';
import { classifyAndCreateEvent } from '../src/cron';
import {
  boundedClassificationError,
  classifierRetryDelayMinutes,
  isClassificationRetryEligible,
  normalizeClassificationFailureKind,
} from '../src/classifier/retry';
import type { ClassificationOutcome, SourcePost } from '../src/types';

function post(overrides: Partial<SourcePost> = {}): SourcePost {
  return {
    id: 205,
    source: 'x_api',
    source_account: 'thsottiaux',
    source_post_id: '205',
    source_url: 'https://x.com/thsottiaux/status/205',
    text: 'Codex is back with a new workflow.',
    published_at: '2026-09-09T00:00:00.000Z',
    fetched_at: '2026-09-09T00:01:00.000Z',
    raw_json: '{}',
    content_hash: 'retry-test',
    classification_pending: true,
    canonical_platform: 'x',
    canonical_post_id: '205',
    source_quality: 'DIRECT',
    verification_status: 'DIRECT_VERIFIED',
    ...overrides,
  };
}

function successOutcome(): ClassificationOutcome {
  return {
    status: 'SUCCESS',
    result: {
      relevant: true,
      category: 'CODEX_UPDATE',
      product_scope: 'CODEX',
      statement_nature: 'FACT',
      confidence: 0.9,
      title_en: 'Codex update',
      title_zh: 'Codex 更新',
      summary_en: 'A Codex update is available.',
      summary_zh: 'Codex 更新已可用。',
      effective_time: null,
      reset_time: null,
      reason: 'Retry recovery fixture.',
    },
  };
}

describe('classifier retry resilience', () => {
  it('uses bounded provider backoff and a separate classifier-output delay', () => {
    expect([1, 2, 3, 4, 5, 99].map(attempt => classifierRetryDelayMinutes(attempt, 'TRANSIENT_PROVIDER_ERROR')))
      .toEqual([15, 30, 60, 240, 360, 360]);
    expect(classifierRetryDelayMinutes(1, 'PERMANENT_OR_CONFIGURATION_ERROR')).toBe(15);
    expect(classifierRetryDelayMinutes(5, 'CLASSIFIER_OUTPUT_ERROR')).toBe(60);
  });

  it('keeps provider-failure posts eligible after the quality retry cap', () => {
    const sixHoursLater = new Date('2026-09-09T06:00:00.000Z');
    const providerPost = post({
      classification_attempts: 9,
      classification_failure_kind: 'TRANSIENT_PROVIDER_ERROR',
      last_classification_attempt_at: '2026-09-09T00:00:00.000Z',
    });
    const outputPost = post({
      classification_attempts: 5,
      classification_failure_kind: 'CLASSIFIER_OUTPUT_ERROR',
      last_classification_attempt_at: '2026-09-09T00:00:00.000Z',
    });

    expect(isClassificationRetryEligible(providerPost, sixHoursLater)).toBe(true);
    expect(isClassificationRetryEligible(outputPost, sixHoursLater)).toBe(false);
  });

  it('normalizes provider/configuration errors without retaining arbitrary text', () => {
    expect(normalizeClassificationFailureKind({ error: 'HTTP_400' })).toBe('PERMANENT_OR_CONFIGURATION_ERROR');
    expect(normalizeClassificationFailureKind({ error: 'HTTP_503' })).toBe('TRANSIENT_PROVIDER_ERROR');
    expect(normalizeClassificationFailureKind({ error: 'provider response contained a secret' })).toBe('CLASSIFIER_OUTPUT_ERROR');
    expect(boundedClassificationError({ error: 'provider response contained a secret' })).toBe('CLASSIFIER_OUTPUT_ERROR');
  });

  it('persists a transient provider failure through the normal retry path', async () => {
    const repo = {
      recordProviderStatus: vi.fn(async () => undefined),
      updateClassificationRetry: vi.fn(async () => undefined),
      markClassified: vi.fn(async () => undefined),
      insertEvent: vi.fn(async () => 99),
      getEventById: vi.fn(async () => null),
      handleResetEvent: vi.fn(async () => undefined),
    };
    const classifier = {
      classify: vi.fn(async () => ({
        status: 'ERROR' as const,
        error: 'HTTP_503',
        errorCode: 'HTTP_503',
        failureKind: 'TRANSIENT_PROVIDER_ERROR' as const,
        category: 'ERROR' as const,
      })),
    };

    const result = await classifyAndCreateEvent(
      repo as any,
      classifier as any,
      post(),
      new Date('2026-09-09T00:00:00.000Z'),
    );

    expect(result).toMatchObject({ created: false, outcome: { status: 'ERROR', error: 'HTTP_503' } });
    expect(repo.updateClassificationRetry).toHaveBeenCalledWith(
      205,
      '2026-09-09T00:00:00.000Z',
      'HTTP_503',
      'TRANSIENT_PROVIDER_ERROR',
    );
    expect(repo.markClassified).not.toHaveBeenCalled();
    expect(repo.insertEvent).not.toHaveBeenCalled();
  });

  it('recovers automatically after provider health returns and does not duplicate the event', async () => {
    const state = {
      pending: true,
      attempts: 0,
      lastAttempt: null as string | null,
      failureKind: 'TRANSIENT_PROVIDER_ERROR' as const,
      eventInserted: false,
    };
    const repo = {
      recordProviderStatus: vi.fn(async () => undefined),
      updateClassificationRetry: vi.fn(async (_id: number, at: string, _code: string, kind: typeof state.failureKind) => {
        state.pending = true;
        state.attempts += 1;
        state.lastAttempt = at;
        state.failureKind = kind;
      }),
      markClassified: vi.fn(async () => {
        state.pending = false;
        state.attempts += 1;
        state.failureKind = 'CLASSIFIER_OUTPUT_ERROR';
      }),
      insertEvent: vi.fn(async () => {
        if (state.eventInserted) return null;
        state.eventInserted = true;
        return 2050;
      }),
      getEventById: vi.fn(async () => ({ id: 2050, source_post_id: 205, category: 'CODEX_UPDATE' })),
      handleResetEvent: vi.fn(async () => undefined),
    };
    const classifier = {
      classify: vi.fn()
        .mockResolvedValueOnce({
          status: 'ERROR' as const,
          error: 'HTTP_400',
          errorCode: 'HTTP_400',
          failureKind: 'PERMANENT_OR_CONFIGURATION_ERROR' as const,
          category: 'ERROR' as const,
        })
        .mockResolvedValue(successOutcome()),
    };

    const first = await classifyAndCreateEvent(
      repo as any,
      classifier as any,
      post(),
      new Date('2026-09-09T00:00:00.000Z'),
    );
    expect(first.created).toBe(false);
    expect(state).toMatchObject({ pending: true, attempts: 1, failureKind: 'PERMANENT_OR_CONFIGURATION_ERROR' });

    const recoveredPost = post({
      classification_attempts: state.attempts,
      last_classification_attempt_at: state.lastAttempt,
      classification_failure_kind: state.failureKind,
    });
    expect(isClassificationRetryEligible(recoveredPost, new Date('2026-09-09T00:16:00.000Z'))).toBe(true);

    const recovered = await classifyAndCreateEvent(
      repo as any,
      classifier as any,
      recoveredPost,
      new Date('2026-09-09T00:16:00.000Z'),
    );
    expect(recovered.created).toBe(true);
    expect(state).toMatchObject({ pending: false, eventInserted: true });

    const duplicate = await classifyAndCreateEvent(
      repo as any,
      classifier as any,
      post({
        classification_attempts: state.attempts,
        classification_pending: true,
        classification_failure_kind: 'TRANSIENT_PROVIDER_ERROR',
        last_classification_attempt_at: '2026-09-09T00:16:00.000Z',
      }),
      new Date('2026-09-09T00:32:00.000Z'),
    );
    expect(duplicate.created).toBe(false);
    expect(state.eventInserted).toBe(true);
    expect(repo.insertEvent).toHaveBeenCalledTimes(2);
  });
});
