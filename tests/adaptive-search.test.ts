import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/types';
import {
  getAdaptiveSearchQueries,
  ProviderBudgetExceededError,
  SearchProvider,
} from '../src/providers/search-provider';
import {
  getBraveMonthlyCreditUsd,
  getEstimatedMonthlyGrossCostUsd,
  getEstimatedMonthlyRequests,
  getWebSearchFallbackBackoffMinutes,
  getNormalSearchIntervalHours,
  getWebSearchMode,
  isStaleApproximateReset,
  isWebSearchOverdue,
  nextWebSearchAt,
  shouldRunWebSearch,
} from '../src/utils/search-schedule';
import { shouldRunXApiSync } from '../src/utils/schedule';

function env(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as D1Database,
    ASSETS: {} as Fetcher,
    WEB_SEARCH_ENABLED: 'true',
    MAX_WEB_SEARCH_REQUESTS_PER_DAY: '6',
    NORMAL_SEARCH_INTERVAL_HOURS: '4',
    BRAVE_SEARCH_PRICE_PER_1000_USD: '5',
    BRAVE_MONTHLY_CREDIT_USD: '5',
    ...overrides,
  };
}

describe('Adaptive Web Search modes and cadence', () => {
  it('backs off the fallback path at 30m, 1h, 2h and 4h', () => {
    expect(getWebSearchFallbackBackoffMinutes(0)).toBe(30);
    expect(getWebSearchFallbackBackoffMinutes(1)).toBe(60);
    expect(getWebSearchFallbackBackoffMinutes(2)).toBe(120);
    expect(getWebSearchFallbackBackoffMinutes(20)).toBe(240);
  });

  it('transitions NORMAL -> WATCHING_RESET -> CONFIRMING_RESET and returns to NORMAL', () => {
    const now = new Date('2026-08-26T01:00:00.000Z');
    expect(getWebSearchMode(null, now)).toBe('NORMAL');
    expect(getWebSearchMode({ status: 'SCHEDULED', expected_reset_at: '2026-08-26T04:00:00.000Z' }, now)).toBe('WATCHING_RESET');
    expect(getWebSearchMode({ status: 'DUE', expected_reset_at: '2026-08-26T04:00:00.000Z' }, now)).toBe('CONFIRMING_RESET');
    expect(getWebSearchMode({ status: 'SCHEDULED', expected_reset_at: '2026-08-26T00:00:00.000Z' }, now)).toBe('CONFIRMING_RESET');
    expect(getWebSearchMode({ status: 'CONFIRMED', expected_reset_at: '2026-08-26T00:00:00.000Z' }, now)).toBe('NORMAL');
  });

  it('uses 4 hours in NORMAL and 1 hour in active reset modes', () => {
    const e = env();
    const last = '2026-08-26T00:00:00.000Z';
    const usage = { request_count: 1 };
    expect(getNormalSearchIntervalHours(e)).toBe(4);
    expect(shouldRunWebSearch(new Date('2026-08-26T00:30:00.000Z'), 'NORMAL', last, usage, e).reason)
      .toBe('interval_not_elapsed');
    expect(shouldRunWebSearch(new Date('2026-08-26T04:00:00.000Z'), 'NORMAL', last, usage, e).allowed).toBe(true);
    expect(shouldRunWebSearch(new Date('2026-08-26T01:00:00.000Z'), 'WATCHING_RESET', last, usage, e).allowed).toBe(true);
    expect(shouldRunWebSearch(new Date('2026-08-26T01:00:00.000Z'), 'CONFIRMING_RESET', last, usage, e).allowed).toBe(true);
  });

  it('keeps the single-account discovery query broad on every cycle', () => {
    const accounts = ['thsottiaux'];
    const normalA = getAdaptiveSearchQueries(accounts, new Date('2026-08-26T00:00:00.000Z'), 'NORMAL');
    const normalB = getAdaptiveSearchQueries(accounts, new Date('2026-08-26T01:00:00.000Z'), 'NORMAL');
    const watching = getAdaptiveSearchQueries(accounts, new Date('2026-08-26T01:00:00.000Z'), 'WATCHING_RESET');
    const confirming = getAdaptiveSearchQueries(accounts, new Date('2026-08-26T01:00:00.000Z'), 'CONFIRMING_RESET');

    expect(normalA).toHaveLength(1);
    expect(normalB).toHaveLength(1);
    expect(normalA[0].q).toBe(normalB[0].q);
    expect(normalA[0].q).toContain('Codex');
    expect(normalA[0].q).toContain('reset');
    expect(normalA[0].q).toContain('limit');
    expect(watching).toHaveLength(1);
    expect(watching[0].q.toLowerCase()).toContain('reset');
    expect(confirming).toHaveLength(1);
    expect(confirming[0].purpose).toBe('confirmation');
  });

  it('rotates every configured account template across the actual two-hour cadence', () => {
    const queries = [0, 2, 4, 6, 8, 10].map(hour => getAdaptiveSearchQueries(
      ['first', 'second'],
      new Date(Date.UTC(2026, 7, 26, hour, 0, 0)),
      'NORMAL',
      2,
    )[0].q);
    expect(new Set(queries).size).toBe(5);
  });

  it('does not count a skipped hourly tick and calculates the next eligible time', () => {
    const e = env();
    const last = '2026-08-26T00:00:00.000Z';
    const usage = { request_count: 1 };
    const skipped = shouldRunWebSearch(new Date('2026-08-26T00:30:00.000Z'), 'NORMAL', last, usage, e);
    expect(skipped.allowed).toBe(false);
    expect(nextWebSearchAt(new Date('2026-08-26T00:30:00.000Z'), 'NORMAL', last, usage, e))
      .toBe('2026-08-26T04:00:00.000Z');
    expect(nextWebSearchAt(new Date('2026-08-26T13:00:00.000Z'), 'NORMAL', last, { request_count: 6 }, e))
      .toBe('2026-08-26T16:00:00.000Z');
  });

  it('keeps a normal 24-hour simulation near 12 requests', () => {
    const e = env();
    let lastAttempt: string | null = null;
    let requests = 0;
    for (let hour = 0; hour < 24; hour++) {
      const now = new Date(Date.UTC(2026, 7, 26, hour, 0, 0));
      const decision = shouldRunWebSearch(now, 'NORMAL', lastAttempt, { request_count: requests }, e);
      if (decision.allowed) {
        requests++;
        lastAttempt = now.toISOString();
      }
    }
    expect(requests).toBe(6);
  });

  it('keeps an all-day reset simulation within the 24-request hard limit', () => {
    const e = env();
    let lastAttempt: string | null = null;
    let requests = 0;
    for (let hour = 0; hour < 24; hour++) {
      const now = new Date(Date.UTC(2026, 7, 26, hour, 0, 0));
      const decision = shouldRunWebSearch(now, 'WATCHING_RESET', lastAttempt, { request_count: requests }, e);
      if (decision.allowed) {
        requests++;
        lastAttempt = now.toISOString();
      }
    }
    expect(requests).toBe(6);
    expect(shouldRunWebSearch(new Date('2026-08-26T23:00:00.000Z'), 'CONFIRMING_RESET', lastAttempt, { request_count: requests }, e).reason)
      .toBe('daily_budget_exhausted');
  });

  it('does not mark a normal four-hour skip as stale, but does mark an overdue success', () => {
    const e = env();
    const last = '2026-08-26T00:00:00.000Z';
    expect(isWebSearchOverdue(new Date('2026-08-26T04:00:00.000Z'), last, 'NORMAL', e, { request_count: 1 })).toBe(false);
    expect(isWebSearchOverdue(new Date('2026-08-26T04:01:00.000Z'), last, 'NORMAL', e, { request_count: 1 })).toBe(true);
    expect(isWebSearchOverdue(new Date('2026-08-26T23:00:00.000Z'), last, 'WATCHING_RESET', e, { request_count: 24 })).toBe(false);
  });

  it('expires approximate reset plans after the freshness window', () => {
    const now = new Date('2026-08-26T12:00:00.000Z');
    expect(isStaleApproximateReset(null, '2026-08-24T11:59:59.000Z', null, now)).toBe(true);
    expect(isStaleApproximateReset(null, '2026-08-26T11:00:00.000Z', null, now)).toBe(false);
    expect(isStaleApproximateReset('2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z', null, now)).toBe(false);
  });

  it('allows an X poll in every aligned 15-minute slot', () => {
    const decision = shouldRunXApiSync(
      new Date('2026-08-26T02:00:00.000Z'),
      null,
      { X_API_BEARER_TOKEN: 'configured', X_API_MAX_SYNC_ATTEMPTS_PER_DAY: '96', X_API_POLL_INTERVAL_MINUTES: '15' } as Env,
    );
    expect(decision.allowed).toBe(true);
  });

  it('projects normal cost below 1000 requests/month at the default cadence', () => {
    const e = env();
    expect(getEstimatedMonthlyRequests('NORMAL', e)).toBe(180);
    expect(getEstimatedMonthlyGrossCostUsd('NORMAL', e)).toBe(0.9);
    expect(getBraveMonthlyCreditUsd(e)).toBe(5);
    expect(getEstimatedMonthlyRequests('WATCHING_RESET', e)).toBe(180);
  });
});

describe('Brave request budget accounting', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('counts each actual provider request and rejects the third before HTTP', async () => {
    let reserved = 0;
    const repo = {
      async reserveProviderUsage(_provider: string, _date: string, limit: number) {
        if (reserved >= limit) return false;
        reserved++;
        return true;
      },
      async recordProviderUsageSuccess() {},
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ web: { results: [] } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const provider = new SearchProvider(env({ BRAVE_SEARCH_API_KEY: 'test', MAX_WEB_SEARCH_REQUESTS_PER_DAY: '2' }), repo as any);

    await provider.search({ q: 'one', purpose: 'discovery' });
    await provider.search({ q: 'two', purpose: 'discovery' });
    await expect(provider.search({ q: 'three', purpose: 'discovery' })).rejects.toBeInstanceOf(ProviderBudgetExceededError);

    expect(reserved).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
