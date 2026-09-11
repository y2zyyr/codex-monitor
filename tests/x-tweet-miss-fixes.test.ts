// ============================================================
// Tibo Codex Monitor - X tweet miss repair regression tests
// ============================================================
// Covers:
//  P0-1  replies retained in the X timeline fetch (exclude=retweets only)
//  P0-2  reply-supplement search runs when the direct source is healthy
//  P0-3  historical backfill (ignore cursor, never advance it, dedup-safe)
//  P1-2  per-run classifier budget default/override + reset-hint priority
//  P1-4  missed-detection counters (direct posts without events)
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_X_BACKFILL_PAGES,
  XApiProvider,
} from '../src/providers/x-api';
import {
  backfillHistoricalXTimeline,
  executeCron,
  persistXAccountBatches,
} from '../src/cron';
import { Repository } from '../src/db/repository';
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
    NORMAL_SEARCH_INTERVAL_HOURS: '4',
    ...overrides,
  } as unknown as Env;
}

function directPost(overrides: Partial<SourcePost> = {}): SourcePost {
  return {
    source: 'x_api',
    source_account: 'thsottiaux',
    source_post_id: '2097000000000000123',
    source_url: 'https://x.com/thsottiaux/status/2097000000000000123',
    text: 'All reset for everyone.',
    published_at: '2026-09-10T00:00:00.000Z',
    fetched_at: '2026-09-10T00:05:00.000Z',
    raw_json: '{}',
    content_hash: 'reply-supplement-fixture',
    classification_pending: true,
    canonical_platform: 'x',
    canonical_post_id: '2097000000000000123',
    source_quality: 'DIRECT',
    verification_status: 'DIRECT_VERIFIED',
    ...overrides,
  };
}

function successIrrelevant(): ClassificationOutcome {
  return {
    status: 'SUCCESS',
    result: {
      relevant: false,
      category: 'IRRELEVANT',
      product_scope: 'OTHER',
      statement_nature: 'FACT',
      confidence: 0.1,
      title_en: '',
      title_zh: '',
      summary_en: '',
      summary_zh: '',
      effective_time: null,
      reset_time: null,
      reason: 'Not a monitorable signal.',
    },
  };
}

describe('P0-1 replies retained in the X timeline fetch', () => {
  it('requests exclude=retweets only, keeping replies', async () => {
    const settings = new Map<string, string>([['x_api_user_id:thsottiaux', '123']]);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === '/2/users/123/tweets') {
        expect(url.searchParams.get('exclude')).toBe('retweets');
        // A reply tweet (author matches the user) is returned and must not be
        // dropped by the provider.
        return new Response(JSON.stringify({
          data: [{ id: '101', text: 'Codex resets applied for everyone', created_at: '2026-09-10T00:00:00.000Z', author_id: '123', in_reply_to_user_id: '555' }],
          meta: { newest_id: '101' },
        }), { status: 200 });
      }
      throw new Error(`unexpected request ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new XApiProvider(timelineEnv(), {
      getSetting: async (key: string) => settings.get(key) ?? null,
      setSetting: async (key: string, value: string) => settings.set(key, value),
    } as any);

    const posts = await provider.fetchLatestPosts(undefined, { reservationAlreadyHeld: true });
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      source: 'x_api',
      source_post_id: '101',
      source_quality: 'DIRECT',
      verification_status: 'DIRECT_VERIFIED',
      verified_at: expect.any(String),
    });
    expect(fetchMock).toHaveBeenCalled();
  });
});

describe('P0-3 historical backfill', () => {
  beforeEach(() => { vi.spyOn(Repository.prototype, 'recordProviderStatus').mockResolvedValue(undefined); });
  // Realistic recent snowflake IDs (2026-09-08/09/10) so the far-past `since`
  // guard in backfillHistoricalXTimeline does not refuse the fixtures.
  const SEPT_8 = '2097112679838646272';
  const SEPT_9 = '2097475067704246272';
  const SEPT_10 = '2097837455569846272';

  it('fetches without the stored cursor, ingests through dedup, and never advances the cursor', async () => {
    const seen: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === '/2/users/by/username/thsottiaux') {
        return new Response(JSON.stringify({ data: { id: '123', name: 'T', username: 'thsottiaux' } }), { status: 200 });
      }
      if (url.pathname === '/2/users/123/tweets') {
        // The forward cursor (999) must be ignored. The lower bound is the
        // oldest stored direct post id (SEPT_8), which bounds the backfill window.
        expect(url.searchParams.get('since_id')).toBe(SEPT_8);
        expect(url.searchParams.get('exclude')).toBe('retweets');
        return new Response(JSON.stringify({
          data: [
            { id: SEPT_9, text: 'Codex resets applied', created_at: '2026-09-09T00:00:00.000Z', author_id: '123' },
            { id: SEPT_8, text: 'New workflow for Codex', created_at: '2026-09-08T00:00:00.000Z', author_id: '123' },
          ],
          meta: { newest_id: SEPT_9 },
        }), { status: 200 });
      }
      throw new Error(`unexpected request ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    // Existing storage: the cursor is far ahead and both tweets are dedup hits.
    vi.spyOn(Repository.prototype, 'getOldestDirectXSourcePostId').mockResolvedValue(SEPT_8);
    vi.spyOn(Repository.prototype, 'getSetting').mockImplementation(async (key: string) => {
      if (key === 'x_api_since_id:thsottiaux') return '9999999999999999999';
      if (key === 'x_api_user_id:thsottiaux') return '123';
      return null;
    });
    vi.spyOn(Repository.prototype, 'setSetting').mockResolvedValue(undefined);
    vi.spyOn(Repository.prototype, 'reserveProviderUsage').mockResolvedValue(true);
    vi.spyOn(Repository.prototype, 'recordProviderUsageSuccess').mockResolvedValue(undefined);
    vi.spyOn(Repository.prototype, 'upsertSourcePost').mockImplementation(async (post: SourcePost) => {
      seen.push(post.source_post_id);
      return { id: Number(post.source_post_id) % 100000, isNew: !seen.slice(0, -1).includes(post.source_post_id), upgraded: false };
    });
    const advanceXApiCursor = vi.spyOn(Repository.prototype, 'advanceXApiCursor').mockResolvedValue(true);

    const result = await backfillHistoricalXTimeline(timelineEnv({ X_API_BACKFILL_MAX_PAGES: '1' }), {
      now: new Date('2026-09-10T01:00:00.000Z'),
    });

    expect(result.postsChecked).toBe(2);
    expect(result.newPosts).toBe(2);
    expect(result.cursorAdvanced).toBe(false);
    expect(advanceXApiCursor).not.toHaveBeenCalled();
    expect(seen).toEqual([SEPT_9, SEPT_8]);
  });

  it('falls back to the most recent window when no direct post is stored', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === '/2/users/by/username/thsottiaux') {
        return new Response(JSON.stringify({ data: { id: '123', name: 'T', username: 'thsottiaux' } }), { status: 200 });
      }
      if (url.pathname === '/2/users/123/tweets') {
        expect(url.searchParams.get('since_id')).toBeNull();
        return new Response(JSON.stringify({
          data: [{ id: '101', text: 'Codex resets applied', created_at: '2026-09-09T00:00:00.000Z', author_id: '123' }],
          meta: { newest_id: '101' },
        }), { status: 200 });
      }
      throw new Error(`unexpected request ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    vi.spyOn(Repository.prototype, 'getOldestDirectXSourcePostId').mockResolvedValue(null);
    vi.spyOn(Repository.prototype, 'getSetting').mockImplementation(async (key: string) => {
      if (key === 'x_api_user_id:thsottiaux') return '123';
      if (key === 'x_api_since_id:thsottiaux') return '999';
      return null;
    });
    vi.spyOn(Repository.prototype, 'setSetting').mockResolvedValue(undefined);
    vi.spyOn(Repository.prototype, 'reserveProviderUsage').mockResolvedValue(true);
    vi.spyOn(Repository.prototype, 'recordProviderUsageSuccess').mockResolvedValue(undefined);
    vi.spyOn(Repository.prototype, 'upsertSourcePost').mockResolvedValue({ id: 101, isNew: true, upgraded: false });
    vi.spyOn(Repository.prototype, 'advanceXApiCursor').mockResolvedValue(true);

    const result = await backfillHistoricalXTimeline(timelineEnv({ X_API_BACKFILL_MAX_PAGES: '1' }), {
      now: new Date('2026-09-10T01:00:00.000Z'),
    });
    expect(result.newPosts).toBe(1);
    expect(result.cursorAdvanced).toBe(false);
  });

  it('honors an explicit sinceId lower bound and still never advances the cursor', async () => {
    const SEPT_8 = '2097112679838646272';
    const SEPT_9 = '2097475067704246272';
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === '/2/users/by/username/thsottiaux') {
        return new Response(JSON.stringify({ data: { id: '123', name: 'T', username: 'thsottiaux' } }), { status: 200 });
      }
      if (url.pathname === '/2/users/123/tweets') {
        expect(url.searchParams.get('since_id')).toBe(SEPT_8);
        return new Response(JSON.stringify({
          data: [{ id: SEPT_9, text: 'Codex resets applied', created_at: '2026-09-09T00:00:00.000Z', author_id: '123' }],
          meta: { newest_id: SEPT_9 },
        }), { status: 200 });
      }
      throw new Error(`unexpected request ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    vi.spyOn(Repository.prototype, 'getOldestDirectXSourcePostId').mockResolvedValue('0');
    vi.spyOn(Repository.prototype, 'getSetting').mockImplementation(async (key: string) => {
      if (key === 'x_api_user_id:thsottiaux') return '123';
      return null;
    });
    vi.spyOn(Repository.prototype, 'setSetting').mockResolvedValue(undefined);
    vi.spyOn(Repository.prototype, 'reserveProviderUsage').mockResolvedValue(true);
    vi.spyOn(Repository.prototype, 'recordProviderUsageSuccess').mockResolvedValue(undefined);
    vi.spyOn(Repository.prototype, 'upsertSourcePost').mockResolvedValue({ id: 101, isNew: true, upgraded: false });
    const advanceXApiCursor = vi.spyOn(Repository.prototype, 'advanceXApiCursor').mockResolvedValue(true);

    const result = await backfillHistoricalXTimeline(timelineEnv(), {
      sinceId: SEPT_8,
      maxPages: 1,
      now: new Date('2026-09-10T01:00:00.000Z'),
    });

    expect(result.postsChecked).toBe(1);
    expect(result.newPosts).toBe(1);
    expect(result.cursorAdvanced).toBe(false);
    expect(advanceXApiCursor).not.toHaveBeenCalled();
    expect(MAX_X_BACKFILL_PAGES).toBeGreaterThanOrEqual(1);
  });
});

describe('P0-2 reply-supplement search on a healthy direct source', () => {
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

  it('runs one reply-supplement search when the direct sync is healthy and an active reset is watched', async () => {
    const settings = new Map<string, string>([
      ['x_api_user_id:thsottiaux', '123'],
      ['x_api_since_id:thsottiaux', '100'],
      ['x_api_last_success_at', '2026-09-10T00:00:00.000Z'],
      ['x_api_consecutive_failures', '0'],
      ['web_search_last_attempt', '2026-09-10T00:00:00.000Z'],
    ]);
    mockRepoForCron(settings);
    vi.spyOn(Repository.prototype, 'getActiveResetCycle').mockResolvedValue({
      id: 1,
      status: 'SCHEDULED',
      expected_reset_at: '2026-09-10T04:00:00.000Z',
      verification_status: 'DIRECT_VERIFIED',
      planned_event_id: 10,
    } as any);

    const xApiProvider = {
      fetchIncremental: vi.fn(async () => ({
        accounts: [{
          account: 'thsottiaux',
          posts: [directPost()],
          newestId: '2097000000000000123',
          complete: true,
          error: null,
          rateLimit: { limit: 900, remaining: 899, resetAt: null },
        }],
        fetchedAt: '2026-09-10T00:15:00.000Z',
      })),
    } as any;
    const searchProvider = {
      name: 'web_search',
      search: vi.fn(async () => []),
    } as any;
    const classifier = { classify: vi.fn(async () => successIrrelevant()) };

    const result = await executeCron(timelineEnv(), null, classifier, {
      xApiProvider,
      searchProvider,
      now: new Date('2026-09-10T00:15:00.000Z'),
    });

    expect(xApiProvider.fetchIncremental).toHaveBeenCalled();
    expect(searchProvider.search).toHaveBeenCalledTimes(1);
    expect(searchProvider.search).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'reply_supplement' }), expect.any(Date));
    expect(result.webSearchCalls).toBe(1);
    expect(result.search.status).toBe('ok');
    // The normal cadence search did not run this tick (cooldown), but the
    // supplemental channel did.
    expect(result.search.reason).toBeNull();
    expect(settings.get('web_search_supplemental_last_attempt')).toBe('2026-09-10T00:15:00.000Z');
  });

  it('never runs the reply supplement in NORMAL mode or when the budget is exhausted', async () => {
    const settings = new Map<string, string>([
      ['x_api_user_id:thsottiaux', '123'],
      ['x_api_since_id:thsottiaux', '100'],
      ['x_api_last_success_at', '2026-09-10T00:00:00.000Z'],
      ['x_api_consecutive_failures', '0'],
      ['web_search_last_attempt', '2026-09-10T00:00:00.000Z'],
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

    const normalResult = await executeCron(timelineEnv(), null, { classify: vi.fn(async () => successIrrelevant()) }, {
      xApiProvider,
      searchProvider,
      now: new Date('2026-09-10T00:15:00.000Z'),
    });
    expect(searchProvider.search).not.toHaveBeenCalled();
    expect(normalResult.search.skipped).toBe(true);

    // Budget exhausted: supplemental fails closed even in an active mode.
    searchProvider.search.mockClear();
    vi.spyOn(Repository.prototype, 'getProviderUsage').mockResolvedValue({ request_count: 24, usedToday: 24 } as any);
    vi.spyOn(Repository.prototype, 'getActiveResetCycle').mockResolvedValue({
      id: 2,
      status: 'SCHEDULED',
      expected_reset_at: '2026-09-10T04:00:00.000Z',
      verification_status: 'DIRECT_VERIFIED',
      planned_event_id: 11,
    } as any);
    await executeCron(timelineEnv(), null, { classify: vi.fn(async () => successIrrelevant()) }, {
      xApiProvider,
      searchProvider,
      now: new Date('2026-09-10T00:15:00.000Z'),
    });
    expect(searchProvider.search).not.toHaveBeenCalled();
  });
});

describe('P1-2 classification budget and reset-hint priority', () => {
  function pending(postOverrides: Partial<SourcePost>, id: number): SourcePost {
    return directPost({
      id,
      source_post_id: String(2097000000000000000 + id),
      canonical_post_id: String(2097000000000000000 + id),
      source_url: `https://x.com/thsottiaux/status/${2097000000000000000 + id}`,
      classification_pending: true,
      classification_attempts: 0,
      last_classification_attempt_at: null,
      ...postOverrides,
    });
  }

  it('honors the default per-run classifier budget and the env override', async () => {
    vi.spyOn(Repository.prototype, 'insertRun').mockResolvedValue(1);
    vi.spyOn(Repository.prototype, 'updateRun').mockResolvedValue(undefined);
    vi.spyOn(Repository.prototype, 'advanceResetCycleState').mockResolvedValue(undefined);
    vi.spyOn(Repository.prototype, 'getActiveResetCycle').mockResolvedValue(null);
    vi.spyOn(Repository.prototype, 'hasRecentTrustedResetPlan').mockResolvedValue(false);
    vi.spyOn(Repository.prototype, 'getProviderUsage').mockResolvedValue(null);
    vi.spyOn(Repository.prototype, 'getSetting').mockResolvedValue(null);
    vi.spyOn(Repository.prototype, 'setSetting').mockResolvedValue(undefined);
    vi.spyOn(Repository.prototype, 'recordProviderStatus').mockResolvedValue(undefined);
    vi.spyOn(Repository.prototype, 'recordClassificationDecision').mockResolvedValue(undefined);
    vi.spyOn(Repository.prototype, 'recordProviderUsageSuccess').mockResolvedValue(undefined);
    vi.spyOn(Repository.prototype, 'markClassified').mockResolvedValue(undefined);

    const posts = [
      pending({ text: 'New workflow for Codex' }, 1),
      pending({ text: 'Codex usage reset happening tomorrow' }, 2),
      pending({ text: 'Ships this week for the CLI' }, 3),
    ];
    vi.spyOn(Repository.prototype, 'getUnclassifiedPosts').mockResolvedValue(posts);
    vi.spyOn(Repository.prototype, 'getDirectPostsWithoutEvents').mockResolvedValue([]);

    const defaultClassifier = { classify: vi.fn(async () => successIrrelevant()) };
    const defaultResult = await executeCron(timelineEnv(), null, defaultClassifier, {
      now: new Date('2026-09-10T00:15:00.000Z'),
    });
    expect(defaultClassifier.classify).toHaveBeenCalledTimes(3);

    const cappedClassifier = { classify: vi.fn(async () => successIrrelevant()) };
    await executeCron(timelineEnv({ CLASSIFICATIONS_PER_RUN: '2' }), null, cappedClassifier, {
      now: new Date('2026-09-10T00:15:00.000Z'),
    });
    expect(cappedClassifier.classify).toHaveBeenCalledTimes(2);
  });

  it('orders candidate batches with deterministic reset hints ahead of ordinary posts', async () => {
    const repo = {
      upsertSourcePost: vi.fn(async (post: SourcePost) => {
        // All posts are new; ids mirror the input order.
        return { id: Number(post.source_post_id) % 1000, isNew: true, upgraded: false };
      }),
      advanceXApiCursor: vi.fn(async () => true),
    } as any;
    const batch = {
      account: 'thsottiaux',
      newestId: '999',
      complete: true,
      error: null,
      rateLimit: {},
      posts: [
        directPost({ source_post_id: '1001', text: 'Codex ships a new CLI' }), // keyword only
        directPost({ source_post_id: '1002', text: 'Random life update' }), // ordinary
        directPost({ source_post_id: '1003', text: 'Codex resets applied for everyone' }), // deterministic hint
      ],
    };
    const persisted = await persistXAccountBatches(repo, [batch], new Date('2026-09-10T00:15:00.000Z'));
    expect(persisted.newCandidates.map(post => post.source_post_id)).toEqual(['1003', '1001', '1002']);
  });
});

describe('P1-4 missed-detection monitor helpers', () => {
  it('counts direct X posts without events within the window and finds the oldest direct post id', async () => {
    const rows = {
      count: 3,
    };
    const oldestRow = { source_post_id: '2096035437299237298' };
    const statement = {
      bind: vi.fn().mockReturnThis(),
      first: vi.fn()
        .mockResolvedValueOnce(rows)
        .mockResolvedValueOnce(oldestRow),
    };
    const db = { prepare: vi.fn().mockReturnValue(statement) } as unknown as D1Database;
    const repo = new Repository(db);

    const now = new Date('2026-09-10T00:00:00.000Z');
    await expect(repo.countDirectPostsWithoutEventsWithin(7, now)).resolves.toBe(3);
    await expect(repo.getOldestDirectXSourcePostId()).resolves.toBe('2096035437299237298');
    expect(statement.bind).toHaveBeenCalledWith('2026-09-10T00:00:00.000Z', '-7 days');
  });
});