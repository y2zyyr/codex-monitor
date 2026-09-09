import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeCron } from '../src/cron';
import { Repository } from '../src/db/repository';
import type { ClassificationOutcome, Env, SourcePost } from '../src/types';

function pendingPost(state: {
  attempts: number;
  lastAttempt: string | null;
  failureKind: SourcePost['classification_failure_kind'];
}): SourcePost {
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
    content_hash: 'natural-recovery-fixture',
    classification_pending: true,
    classification_attempts: state.attempts,
    last_classification_attempt_at: state.lastAttempt,
    classification_failure_kind: state.failureKind,
    canonical_platform: 'x',
    canonical_post_id: '205',
    source_quality: 'DIRECT',
    verification_status: 'DIRECT_VERIFIED',
  };
}

function success(): ClassificationOutcome {
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
      reason: 'Natural cron recovery fixture.',
    },
  };
}

describe('natural scheduled classifier recovery', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps a provider failure pending and recovers it on a later natural-equivalent run', async () => {
    const state = {
      pending: true,
      attempts: 0,
      lastAttempt: null as string | null,
      failureKind: null as SourcePost['classification_failure_kind'],
      eventCount: 0,
      runCount: 0,
    };
    const statuses: string[] = [];
    vi.spyOn(Repository.prototype, 'insertRun').mockImplementation(async () => {
      state.runCount += 1;
      return state.runCount;
    });
    vi.spyOn(Repository.prototype, 'updateRun').mockResolvedValue(undefined);
    vi.spyOn(Repository.prototype, 'advanceResetCycleState').mockResolvedValue(undefined);
    vi.spyOn(Repository.prototype, 'getActiveResetCycle').mockResolvedValue(null);
    vi.spyOn(Repository.prototype, 'hasRecentTrustedResetPlan').mockResolvedValue(false);
    vi.spyOn(Repository.prototype, 'getProviderUsage').mockResolvedValue(null);
    vi.spyOn(Repository.prototype, 'getSetting').mockResolvedValue(null);
    vi.spyOn(Repository.prototype, 'setSetting').mockResolvedValue(undefined);
    vi.spyOn(Repository.prototype, 'recordProviderStatus').mockImplementation(async (_provider, status) => {
      statuses.push(status);
    });
    vi.spyOn(Repository.prototype, 'recordClassificationDecision').mockResolvedValue(undefined);
    vi.spyOn(Repository.prototype, 'getUnclassifiedPosts').mockImplementation(async () => (
      state.pending ? [pendingPost(state)] : []
    ));
    vi.spyOn(Repository.prototype, 'getDirectPostsWithoutEvents').mockImplementation(async () => (
      state.pending ? [pendingPost(state)] : []
    ));
    vi.spyOn(Repository.prototype, 'updateClassificationRetry').mockImplementation(async (_id, at, _code, kind) => {
      state.pending = true;
      state.attempts += 1;
      state.lastAttempt = at;
      state.failureKind = kind;
    });
    vi.spyOn(Repository.prototype, 'markClassified').mockImplementation(async () => {
      state.pending = false;
      state.attempts += 1;
      state.failureKind = null;
    });
    vi.spyOn(Repository.prototype, 'insertEvent').mockImplementation(async () => {
      if (state.eventCount > 0) return null;
      state.eventCount += 1;
      return 205;
    });
    vi.spyOn(Repository.prototype, 'getEventById').mockResolvedValue({
      id: 205,
      source_post_id: 205,
      category: 'CODEX_UPDATE',
    } as any);
    vi.spyOn(Repository.prototype, 'handleResetEvent').mockResolvedValue(undefined);

    const classifier = {
      classify: vi.fn()
        .mockResolvedValueOnce({
          status: 'ERROR' as const,
          error: 'HTTP_400',
          errorCode: 'HTTP_400',
          failureKind: 'PERMANENT_OR_CONFIGURATION_ERROR' as const,
          category: 'ERROR' as const,
        })
        .mockResolvedValueOnce(success()),
    };
    const env = { DB: {} } as unknown as Env;

    const first = await executeCron(env, null, classifier, {
      now: new Date('2026-09-09T00:00:00.000Z'),
    });
    expect(first.status).toBe('completed');
    expect(first.eventsCreated).toBe(0);
    expect(first.errorMessage).toContain('PERMANENT_OR_CONFIGURATION_ERROR:HTTP_400');
    expect(state).toMatchObject({ pending: true, attempts: 1, eventCount: 0 });

    const recovered = await executeCron(env, null, classifier, {
      now: new Date('2026-09-09T00:16:00.000Z'),
    });
    expect(recovered.status).toBe('completed');
    expect(recovered.eventsCreated).toBe(1);
    expect(state).toMatchObject({ pending: false, eventCount: 1 });

    const quiet = await executeCron(env, null, classifier, {
      now: new Date('2026-09-09T00:31:00.000Z'),
    });
    expect(quiet.status).toBe('completed');
    expect(quiet.eventsCreated).toBe(0);
    expect(state.eventCount).toBe(1);
    expect(classifier.classify).toHaveBeenCalledTimes(2);
    expect(statuses).toContain('degraded');
    expect(statuses).toContain('ok');
  });
});
