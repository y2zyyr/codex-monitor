// ============================================================
// Tibo Codex Monitor - residual miss-risk regression tests
// ============================================================
// Covers the second repair round:
//  R1   reply-supplement search in NORMAL mode (stale main search / recent
//       reset signal) on a SEPARATE small daily pool
//  R2   backfill budget metering (pagesFetched/reservationsUsed, default 5
//       pages, far-past `since` refused without force)
//  R3/M1  ingestion-completeness probe (gates, counts, settings, health-visible)
//  R4/R5  NEEDS_REVIEW adjudication queue for trusted short reset replies
//  M2   rejection-reason breakdown for monitorGap
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  backfillHistoricalXTimeline,
  classifyAndCreateEvent,
  DEFAULT_X_BACKFILL_MAX_PAGES,
  executeCron,
  getXIngestionProbeMaxPages,
  isXIngestionProbeEnabled,
  probeXIngestionCompleteness,
  shouldRunXIngestionProbe,
} from '../src/cron';
import { Repository } from '../src/db/repository';
import {
  SearchProvider,
  WEB_SEARCH_PROVIDER_KEY,
  WEB_SEARCH_SUPPLEMENT_PROVIDER_KEY,
} from '../src/providers/search-provider';
import { isNeedsReviewStrongResetSignal } from '../src/classifier/types';
import type { ClassificationOutcome, Env, SourcePost } from '../src/types';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function timelineEnv(overrides: Record<string, string> = {}): Env {
  return {
    DB: {} as D1Database,
    ASSETS: {} as Fetcher,
    X_API_BEARER_TOKEN: 'token',
    X_API_USER_ID: '123',
    MONITORED_ACCOUNTS: 'thsottiaux',
    X_API_MAX_RESULTS_PER_PAGE: '100',
    X_API_AUTOMATIC_SYNC: 'true',
    MAX_WEB_SEARCH_REQUESTS_PER_DAY: '6',
    WEB_SEARCH_ACTIVE_MODE_DAILY_LIMIT: '24',
    WEB_SEARCH_SUPPLEMENT_INTERVAL_HOURS: '1',
    WEB_SEARCH_SUPPLEMENT_DAILY_LIMIT: '2',
    NORMAL_SEARCH_INTERVAL_HOURS: '4',
    ...overrides,
  } as unknown as Env;
}

function directPost(overrides: Partial<SourcePost> = {}): SourcePost {
  return {
    id: 900,
    source: 'x_api',
    source_account: 'thsottiaux',
    source_post_id: '2097837455569846272',
    source_url: 'https://x.com/thsottiaux/status/2097837455569846272',
    text: 'Limits lifted for everyone.',
    published_at: '2026-09-10T00:00:00.000Z',
    fetched_at: '2026-09-10T00:05:00.000Z',
    raw_json: '{}',
    content_hash: 'review-fixture',
    classification_pending: true,
    canonical_platform: 'x',
    canonical_post_id: '2097837455569846272',
    source_quality: 'DIRECT',
    verification_status: 'DIRECT_VERIFIED',
    ...overrides,
  };
}

function successResult(outcome: Partial<ClassificationOutcome> = {}): ClassificationOutcome {
  return {
    status: 'SUCCESS',
    result: {
      relevant: true,
      category: 'RESET_COMPLETED',
      product_scope: 'CODEX',
      statement_nature: 'FACT',
      confidence: 0.7,
      title_en: 'reset',
      title_zh: '重置',
      summary_en: 'The reply reads like a completed reset announcement.',
      summary_zh: '该回复像是重置完成的声明。',
      effective_time: null,
      reset_time: null,
      reason: 'model-only',
    },
    ...outcome,
  } as ClassificationOutcome;
}

function mockRepoForCron(settings: Map<string, string>) {
  vi.spyOn(Repository.prototype, 'insertRun').mockResolvedValue(1);
  vi.spyOn(Repository.prototype, 'updateRun').mockResolvedValue(undefined);
  vi.spyOn(Repository.prototype, 'advanceResetCycleState').mockResolvedValue(undefined);
  vi.spyOn(Repository.prototype, 'hasRecentTrustedResetPlan').mockResolvedValue(false);
  vi.spyOn(Repository.prototype, 'getProviderUsage').mockResolvedValue(null);
  vi.spyOn(Repository.prototype, 'getSetting').mockImplementation(async (key: string) => settings.get(key) ?? null);
  vi.spyOn(Repository.prototype, 'setSetting').mockImplementation(async (key: string, value: string) => settings.set(key, value));
  vi.spyOn(Repository.prototype, 'recordProviderStatus').mockResolvedValue(undefined);
  vi.spyOn(Repository.prototype, 'recordProviderUsageSuccess').mockResolvedValue(undefined);
  vi.spyOn(Repository.prototype, 'recordClassificationDecision').mockResolvedValue(undefined);
  vi.spyOn(Repository.prototype, 'acquireLock').mockResolvedValue('lock-1');
  vi.spyOn(Repository.prototype, 'releaseLock').mockResolvedValue(undefined);
  vi.spyOn(Repository.prototype, 'reserveProviderUsage').mockResolvedValue(true);
  vi.spyOn(Repository.prototype, 'upsertSourcePost').mockResolvedValue({ id: 1, isNew: false, upgraded: false });
  vi.spyOn(Repository.prototype, 'advanceXApiCursor').mockResolvedValue(true);
  vi.spyOn(Repository.prototype, 'getUnclassifiedPosts').mockResolvedValue([]);
  vi.spyOn(Repository.prototype, 'getDirectPostsWithoutEvents').mockResolvedValue([]);
  vi.spyOn(Repository.prototype, 'hasRecentDirectResetSignalWithoutEvent').mockResolvedValue(false);
}

describe('R1 reply-supplement search in NORMAL mode', () => {
  it('runs a reply supplement in NORMAL when the last regular search is stale', async () => {
    const settings = new Map<string, string>([
      ['x_api_user_id:thsottiaux', '123'],
      ['x_api_since_id:thsottiaux', '100'],
      ['x_api_last_success_at', '2026-09-10T00:00:00.000Z'],
      ['x_api_consecutive_failures', '0'],
      // Main search ran at 00:00; at 02:15 it is not due yet (4h cadence) but
      // the NORMAL stale window (2h default) has elapsed -> supplement fires.
      ['web_search_last_attempt', '2026-09-10T00:00:00.000Z'],
    ]);
    mockRepoForCron(settings);
    vi.spyOn(Repository.prototype, 'getActiveResetCycle').mockResolvedValue(null);

    const xApiProvider = {
      fetchIncremental: vi.fn(async () => ({
        accounts: [{ account: 'thsottiaux', posts: [], newestId: null, complete: true, error: null, rateLimit: {} }],
        fetchedAt: '2026-09-10T02:15:00.000Z',
      })),
    } as any;
    const searchProvider = {
      name: 'web_search',
      search: vi.fn(async () => []),
    } as any;

    const result = await executeCron(timelineEnv(), null, { classify: vi.fn(async () => successResult()) }, {
      xApiProvider,
      searchProvider,
      now: new Date('2026-09-10T02:15:00.000Z'),
    });
    expect(searchProvider.search).toHaveBeenCalledTimes(1);
    expect(searchProvider.search).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'reply_supplement' }), expect.any(Date));
    expect(result.webSearchCalls).toBe(1);
  });

  it('runs a reply supplement in NORMAL when a direct reset signal has no event', async () => {
    const settings = new Map<string, string>([
      ['x_api_user_id:thsottiaux', '123'],
      ['x_api_since_id:thsottiaux', '100'],
      ['x_api_last_success_at', '2026-09-10T00:00:00.000Z'],
      ['x_api_consecutive_failures', '0'],
      ['web_search_last_attempt', '2026-09-10T00:10:00.000Z'], // fresh -> stale trigger off
    ]);
    mockRepoForCron(settings);
    vi.spyOn(Repository.prototype, 'getActiveResetCycle').mockResolvedValue(null);
    vi.spyOn(Repository.prototype, 'hasRecentDirectResetSignalWithoutEvent').mockResolvedValue(true);

    const xApiProvider = {
      fetchIncremental: vi.fn(async () => ({
        accounts: [{ account: 'thsottiaux', posts: [], newestId: null, complete: true, error: null, rateLimit: {} }],
        fetchedAt: '2026-09-10T00:15:00.000Z',
      })),
    } as any;
    const searchProvider = {
      name: 'web_search',
      search: vi.fn(async () => []),
    } as any;

    await executeCron(timelineEnv(), null, { classify: vi.fn(async () => successResult()) }, {
      xApiProvider,
      searchProvider,
      now: new Date('2026-09-10T00:15:00.000Z'),
    });
    expect(searchProvider.search).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'reply_supplement' }), expect.any(Date));
  });

  it('keeps NORMAL quiet (no supplement) when the main search is fresh and no reset signal exists', async () => {
    const settings = new Map<string, string>([
      ['x_api_user_id:thsottiaux', '123'],
      ['x_api_since_id:thsottiaux', '100'],
      ['x_api_last_success_at', '2026-09-10T00:00:00.000Z'],
      ['x_api_consecutive_failures', '0'],
      ['web_search_last_attempt', '2026-09-10T00:10:00.000Z'],
    ]);
    mockRepoForCron(settings);
    vi.spyOn(Repository.prototype, 'getActiveResetCycle').mockResolvedValue(null);

    const xApiProvider = {
      fetchIncremental: vi.fn(async () => ({
        accounts: [{ account: 'thsottiaux', posts: [], newestId: null, complete: true, error: null, rateLimit: {} }],
        fetchedAt: '2026-09-10T00:15:00.000Z',
      })),
    } as any;
    const searchProvider = {
      name: 'web_search',
      search: vi.fn(async () => []),
    } as any;

    await executeCron(timelineEnv(), null, { classify: vi.fn(async () => successResult()) }, {
      xApiProvider,
      searchProvider,
      now: new Date('2026-09-10T00:15:00.000Z'),
    });
    expect(searchProvider.search).not.toHaveBeenCalled();
  });
});

describe('R1 separate supplement pool at the provider hard gate', () => {
  it('reserves discovery searches on the main pool and reply supplements on their own pool', async () => {
    const reservedPools: string[] = [];
    const repo = {
      async reserveProviderUsage(provider: string, _date: string, _limit: number) {
        reservedPools.push(provider);
        return true;
      },
      async recordProviderUsageSuccess() {},
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ web: { results: [] } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const provider = new SearchProvider(timelineEnv({ BRAVE_SEARCH_API_KEY: 'test' }), repo as any);
    await provider.search({ q: 'main-1', purpose: 'discovery' });
    await provider.search({ q: 'supp-1', purpose: 'reply_supplement' });
    expect(reservedPools).toEqual([WEB_SEARCH_PROVIDER_KEY, WEB_SEARCH_SUPPLEMENT_PROVIDER_KEY]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fails closed on the supplement pool without touching the discovery budget', async () => {
    let reserved: Record<string, number> = { web_search: 0, web_search_supplement: 0 };
    const limits: Record<string, number> = { web_search: 6, web_search_supplement: 2 };
    const repo = {
      async reserveProviderUsage(provider: string, _date: string, limit: number) {
        if (reserved[provider] >= limit) return false;
        reserved[provider]++;
        return true;
      },
      async recordProviderUsageSuccess() {},
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ web: { results: [] } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const provider = new SearchProvider(timelineEnv({ BRAVE_SEARCH_API_KEY: 'test' }), repo as any);
    await provider.search({ q: 'supp-1', purpose: 'reply_supplement' });
    await provider.search({ q: 'supp-2', purpose: 'reply_supplement' });
    await expect(provider.search({ q: 'supp-3', purpose: 'reply_supplement' }))
      .rejects.toThrow('Web search daily budget exhausted');
    expect(reserved.web_search).toBe(0);
    expect(reserved.web_search_supplement).toBe(2);
    expect(limits.web_search).toBe(6);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('R2 backfill budget metering', () => {
  beforeEach(() => { vi.spyOn(Repository.prototype, 'recordProviderStatus').mockResolvedValue(undefined); });
  it('defaults to 5 pages and reports pagesFetched and reservationsUsed', async () => {
    const SEPT_8 = '2097112679838646272';
    const SEPT_9 = '2097475067704246272';
    let timelineCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === '/2/users/123/tweets') {
        timelineCalls++;
        expect(url.searchParams.get('since_id')).toBe(SEPT_8);
        return new Response(JSON.stringify({
          data: [{ id: SEPT_9, text: 'Codex resets applied', created_at: '2026-09-09T00:00:00.000Z', author_id: '123' }],
          meta: { newest_id: SEPT_9, next_token: timelineCalls < 2 ? 'tok' : undefined },
        }), { status: 200 });
      }
      throw new Error(`unexpected request ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(Repository.prototype, 'getOldestDirectXSourcePostId').mockResolvedValue(SEPT_8);
    vi.spyOn(Repository.prototype, 'getSetting').mockResolvedValue('123');
    vi.spyOn(Repository.prototype, 'setSetting').mockResolvedValue(undefined);
    vi.spyOn(Repository.prototype, 'reserveProviderUsage').mockResolvedValue(true);
    vi.spyOn(Repository.prototype, 'recordProviderUsageSuccess').mockResolvedValue(undefined);
    vi.spyOn(Repository.prototype, 'upsertSourcePost').mockResolvedValue({ id: 1, isNew: true, upgraded: false });

    // No maxPages plus no env override -> default 5 page budget; the mock stops
    // paginating after the second page, so pagesFetched reflects actual fetches.
    const result = await backfillHistoricalXTimeline(timelineEnv(), {
      now: new Date('2026-09-10T01:00:00.000Z'),
    });
    expect(DEFAULT_X_BACKFILL_MAX_PAGES).toBe(5);
    expect(result.reservationsUsed).toBe(1);
    expect(result.pagesFetched).toBe(2);
    expect(timelineCalls).toBe(2);
    expect(result.cursorAdvanced).toBe(false);
  });

  it('refuses a far-past explicit since bound and requires force=true', async () => {
    const AUGUST_10 = '2086603431736246272'; // 2026-08-10, 31 days before the run
    vi.spyOn(Repository.prototype, 'getSetting').mockResolvedValue('123');
    vi.spyOn(Repository.prototype, 'setSetting').mockResolvedValue(undefined);
    vi.spyOn(Repository.prototype, 'reserveProviderUsage').mockResolvedValue(true);

    await expect(backfillHistoricalXTimeline(timelineEnv(), {
      sinceId: AUGUST_10,
      now: new Date('2026-09-10T01:00:00.000Z'),
    })).rejects.toThrow(/BACKFILL_SINCE_TOO_OLD/);

    // force=true bypasses the guard and proceeds (fetch is stubbed above).
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [], meta: {} }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(Repository.prototype, 'upsertSourcePost').mockResolvedValue({ id: 1, isNew: true, upgraded: false });
    const forced = await backfillHistoricalXTimeline(timelineEnv(), {
      sinceId: AUGUST_10,
      force: true,
      maxPages: 1,
      now: new Date('2026-09-10T01:00:00.000Z'),
    });
    expect(forced.cursorAdvanced).toBe(false);
    expect(fetchMock).toHaveBeenCalled();
  });
});

describe('R3/M1 ingestion-completeness probe', () => {
  it('is disabled unless X_INGESTION_PROBE_ENABLED=true and gates by interval/retry', () => {
    const now = new Date('2026-09-10T00:00:00.000Z');
    expect(isXIngestionProbeEnabled(timelineEnv())).toBe(false);
    expect(shouldRunXIngestionProbe(now, null, null, timelineEnv())).toMatchObject({ allowed: false, reason: 'probe_disabled' });

    const enabled = timelineEnv({ X_INGESTION_PROBE_ENABLED: 'true' });
    expect(shouldRunXIngestionProbe(now, null, null, enabled)).toMatchObject({ allowed: true });
    expect(shouldRunXIngestionProbe(
      new Date('2026-09-10T12:00:00.000Z'),
      '2026-09-10T00:00:00.000Z',
      '2026-09-10T00:00:00.000Z',
      enabled,
    )).toMatchObject({ allowed: false, reason: 'interval_not_elapsed' });
    // Failure retry backoff (4h default) blocks a rapid retry even past interval.
    expect(shouldRunXIngestionProbe(
      new Date('2026-09-11T00:15:00.000Z'),
      '2026-09-10T00:00:00.000Z',
      '2026-09-11T00:00:00.000Z',
      enabled,
    )).toMatchObject({ allowed: false, reason: 'retry_backoff' });
    expect(getXIngestionProbeMaxPages(enabled)).toBe(2);
  });

  it('compares the raw timeline with stored posts, computes missedCount, and never writes source_posts', async () => {
    const now = new Date('2026-09-10T00:15:00.000Z');
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === '/2/users/123/tweets') {
        expect(url.searchParams.get('start_time')).toBe('2026-09-09T00:15:00.000Z');
        expect(url.searchParams.get('since_id')).toBeNull();
        return new Response(JSON.stringify({
          data: [
            { id: '2097837455569846272', text: 'Limits lifted for everyone', created_at: '2026-09-10T00:00:00.000Z', author_id: '123' },
            { id: '2097475067704246272', text: 'New workflow for Codex', created_at: '2026-09-09T12:00:00.000Z', author_id: '123' },
            { id: '2097112679838646272', text: 'Old post outside window', created_at: '2026-09-08T00:00:00.000Z', author_id: '123' },
          ],
          meta: { newest_id: '2097837455569846272' },
        }), { status: 200 });
      }
      throw new Error(`unexpected request ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(Repository.prototype, 'getOldestDirectXSourcePostId').mockResolvedValue(null);
    vi.spyOn(Repository.prototype, 'getSetting').mockResolvedValue(null);
    const settings = new Map<string, string>();
    vi.spyOn(Repository.prototype, 'setSetting').mockImplementation(async (key: string, value: string) => settings.set(key, value));
    vi.spyOn(Repository.prototype, 'reserveProviderUsage').mockResolvedValue(true);
    vi.spyOn(Repository.prototype, 'recordProviderUsageSuccess').mockResolvedValue(undefined);
    // One of the two in-window timeline posts is missing from storage.
    vi.spyOn(Repository.prototype, 'countIngestedDirectXPostsWithin').mockResolvedValue(1);
    // Spy so we can assert the probe itself never writes a source post.
    vi.spyOn(Repository.prototype, 'upsertSourcePost').mockResolvedValue({ id: 1, isNew: false, upgraded: false });

    const result = await probeXIngestionCompleteness(timelineEnv({ X_INGESTION_PROBE_ENABLED: 'true' }), { now });

    expect(result.probeRun).toBe(true);
    expect(result.timelineCount).toBe(2);
    expect(result.storedCount).toBe(1);
    expect(result.missedCount).toBe(1);
    expect(result.reservationsUsed).toBe(1);
    expect(result.pagesFetched).toBe(1);
    expect(settings.get('x_ingestion_probe_timeline_count')).toBe('2');
    expect(settings.get('x_ingestion_probe_missed_count')).toBe('1');
    expect(settings.get('x_ingestion_probe_last_at')).toBe('2026-09-10T00:15:00.000Z');
    // No source post was written by the probe itself.
    expect(Repository.prototype.upsertSourcePost).not.toHaveBeenCalled();
  });

  it('fails closed when disabled: no fetch, no reservation, probeRun=false', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(Repository.prototype, 'getSetting').mockResolvedValue(null);
    vi.spyOn(Repository.prototype, 'setSetting').mockResolvedValue(undefined);
    vi.spyOn(Repository.prototype, 'reserveProviderUsage').mockResolvedValue(true);

    const result = await probeXIngestionCompleteness(timelineEnv(), { now: new Date('2026-09-10T00:15:00.000Z') });
    expect(result.probeRun).toBe(false);
    expect(result.skippedReason).toBe('probe_disabled');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('R4/R5 NEEDS_REVIEW queue', () => {
  function reviewRepo() {
    return {
      recordProviderStatus: vi.fn(async () => undefined),
      updateClassificationRetry: vi.fn(async () => undefined),
      markClassified: vi.fn(async () => undefined),
      insertEvent: vi.fn(async () => null),
      getEventById: vi.fn(async () => null),
      handleResetEvent: vi.fn(async () => undefined),
      recordClassificationDecision: vi.fn(async () => undefined),
    };
  }

  it('isNeedsReviewStrongResetSignal accepts trusted broad short completions and rejects noise', () => {
    expect(isNeedsReviewStrongResetSignal(directPost())).toBe(true); // "Limits lifted for everyone."
    expect(isNeedsReviewStrongResetSignal(directPost({ text: 'Done. Everyone should be good now.' }))).toBe(true);
    expect(isNeedsReviewStrongResetSignal(directPost({ text: 'We just pushed the reset for all users.' }))).toBe(true);
    // Untrusted account: never even flagged for review.
    expect(isNeedsReviewStrongResetSignal(directPost({ source_account: 'codexfan' }))).toBe(false);
    // No audience: bare "Reset done." stays rejected as today.
    expect(isNeedsReviewStrongResetSignal(directPost({ text: 'Reset done.' }))).toBe(false);
    // Explicit non-Codex product language wins.
    expect(isNeedsReviewStrongResetSignal(directPost({ text: 'Claude sessions restored for everyone.' }))).toBe(false);
    // Negated language never.
    expect(isNeedsReviewStrongResetSignal(directPost({ text: 'Not reset for everyone, sorry.' }))).toBe(false);
  });

  it('flags a trusted no-anchor completion as REVIEW instead of dropping or publishing it', async () => {
    const repo = reviewRepo();
    const classifier = { classify: vi.fn(async () => successResult()) }; // CODEX-scoped, but text has no Codex noun
    const outcome = await classifyAndCreateEvent(
      repo as any,
      classifier as any,
      directPost(),
      new Date('2026-09-10T00:10:00.000Z'),
    );
    expect(outcome.created).toBe(false);
    expect(repo.insertEvent).not.toHaveBeenCalled();
    expect(repo.recordClassificationDecision).toHaveBeenCalledWith(expect.any(Number), expect.objectContaining({
      classification_decision: 'REVIEW',
      classification_reason_code: 'NEEDS_REVIEW',
      classification_event_created: false,
    }));
    expect(repo.markClassified).toHaveBeenCalled();
  });

  it('flags an OBSERVATION completion for review but still never publishes it', async () => {
    const repo = reviewRepo();
    const classifier = {
      classify: vi.fn(async () => successResult({
        result: {
          ...successResult().result,
          statement_nature: 'OBSERVATION' as const,
        },
      })),
    };
    const outcome = await classifyAndCreateEvent(
      repo as any,
      classifier as any,
      directPost(),
      new Date('2026-09-10T00:10:00.000Z'),
    );
    expect(outcome.created).toBe(false);
    expect(repo.insertEvent).not.toHaveBeenCalled();
    expect(repo.recordClassificationDecision).toHaveBeenCalledWith(expect.any(Number), expect.objectContaining({
      classification_decision: 'REVIEW',
      classification_reason_code: 'NEEDS_REVIEW',
    }));
  });

  it('never flags untrusted or non-matching posts for review', async () => {
    const repo = reviewRepo();
    const classifier = { classify: vi.fn(async () => successResult()) };
    await classifyAndCreateEvent(
      repo as any,
      classifier as any,
      directPost({ source_account: 'codexfan', source_post_id: '1', source_url: 'https://x.com/codexfan/status/1', canonical_post_id: '1' }),
      new Date('2026-09-10T00:10:00.000Z'),
    );
    expect(repo.recordClassificationDecision).toHaveBeenCalledWith(expect.any(Number), expect.objectContaining({
      classification_decision: 'NO_EVENT',
    }));
    expect(repo.recordClassificationDecision.mock.calls.some(call => call[1].classification_reason_code === 'NEEDS_REVIEW')).toBe(false);

    const noAudience = reviewRepo();
    await classifyAndCreateEvent(
      noAudience as any,
      { classify: vi.fn(async () => successResult()) } as any,
      directPost({ text: 'Reset done.' }),
      new Date('2026-09-10T00:10:00.000Z'),
    );
    expect(noAudience.recordClassificationDecision.mock.calls.some(call => call[1].classification_reason_code === 'NEEDS_REVIEW')).toBe(false);
    expect(noAudience.insertEvent).not.toHaveBeenCalled();
  });

  it('exposes the review backlog through the repository queue', async () => {
    const rows = [{
      id: 7,
      source: 'x_api',
      source_account: 'thsottiaux',
      source_post_id: '2097837455569846272',
      source_url: 'https://x.com/thsottiaux/status/2097837455569846272',
      text: 'Limits lifted for everyone.',
      published_at: '2026-09-10T00:00:00.000Z',
      fetched_at: '2026-09-10T00:05:00.000Z',
      raw_json: '{}',
      content_hash: 'h',
      classification_pending: 0,
      classification_decision: 'REVIEW',
      classification_reason_code: 'NEEDS_REVIEW',
      classification_event_created: 0,
    }];
    const statement = { bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: rows }) };
    const db = { prepare: vi.fn().mockReturnValue(statement) } as unknown as D1Database;
    const posts = await new Repository(db).getPostsNeedingReview(50);
    expect(posts).toHaveLength(1);
    expect(posts[0].source_post_id).toBe('2097837455569846272');
    expect(statement.bind).toHaveBeenCalledWith(50);
  });
});

describe('M2 rejection-reason breakdown', () => {
  it('aggregates event-less posts by classification_reason_code over the window', async () => {
    const rows = [
      { code: 'MISSING_PRODUCT_CONTEXT', count: 4 },
      { code: 'OBSERVATION_NOT_ADMITTED', count: 2 },
      { code: 'IRRELEVANT', count: 1 },
    ];
    const statement = { bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: rows }) };
    const db = { prepare: vi.fn().mockReturnValue(statement) } as unknown as D1Database;
    const breakdown = await new Repository(db).countRejectionReasonsWithoutEventsWithin(7, new Date('2026-09-10T00:00:00.000Z'));
    expect(breakdown).toEqual({
      MISSING_PRODUCT_CONTEXT: 4,
      OBSERVATION_NOT_ADMITTED: 2,
      IRRELEVANT: 1,
    });
    expect(statement.bind).toHaveBeenCalledWith('2026-09-10T00:00:00.000Z', '-7 days');
  });
});