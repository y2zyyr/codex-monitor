import { describe, expect, it } from 'vitest';
import type { Env } from '../src/types';
import { reserveXApiFetch } from '../src/providers/x-api';
import {
  DEFAULT_X_API_POLL_INTERVAL_MINUTES,
  MAX_X_API_FETCHES_PER_DAY,
  getXApiDailyLimit,
  getXApiPollIntervalMinutes,
  isXApiAutomaticSyncEnabled,
  isXApiSyncOverdue,
  nextScheduledXSyncAt,
  providerUsageDate,
  shouldRunXApiSync,
  xApiSlotFor,
} from '../src/utils/schedule';

function env(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as D1Database,
    ASSETS: {} as Fetcher,
    X_API_BEARER_TOKEN: 'test-token',
    X_API_MAX_SYNC_ATTEMPTS_PER_DAY: '96',
    X_API_POLL_INTERVAL_MINUTES: '15',
    X_API_STALE_AFTER_MINUTES: '30',
    ...overrides,
  };
}

function fakeRepo() {
  const rows = new Map<string, { request_count: number; last_request_slot: string | null }>();
  return {
    rows,
    async reserveProviderUsage(provider: string, usageDate: string, limit: number, _at: string, slot: string) {
      const key = `${provider}:${usageDate}`;
      const row = rows.get(key) ?? { request_count: 0, last_request_slot: null };
      if (row.request_count >= limit || row.last_request_slot === slot) return false;
      row.request_count++;
      row.last_request_slot = slot;
      rows.set(key, row);
      return true;
    },
  };
}

describe('X API incremental polling schedule and safety budget', () => {
  it('uses 15 minutes by default and caps internal attempts at 96/day', () => {
    expect(DEFAULT_X_API_POLL_INTERVAL_MINUTES).toBe(15);
    expect(MAX_X_API_FETCHES_PER_DAY).toBe(96);
    expect(getXApiPollIntervalMinutes(env())).toBe(15);
    expect(getXApiDailyLimit(env({ X_API_MAX_SYNC_ATTEMPTS_PER_DAY: '999' }))).toBe(96);
  });

  it('keeps automatic X sync off unless explicitly enabled', () => {
    expect(isXApiAutomaticSyncEnabled(env())).toBe(false);
    expect(isXApiAutomaticSyncEnabled(env({ X_API_AUTOMATIC_SYNC: 'TRUE' }))).toBe(true);

    const now = new Date('2026-08-27T06:00:00.000Z');
    expect(nextScheduledXSyncAt(now, env(), { usedToday: 96 }))
      .toBe('2026-08-27T16:00:00.000Z');
    expect(isXApiSyncOverdue(now, null, env(), { usedToday: 96 })).toBe(true);
  });

  it('uses aligned 15-minute slots and rejects a duplicate slot', async () => {
    const repo = fakeRepo();
    const e = env({ X_API_MAX_SYNC_ATTEMPTS_PER_DAY: '2' });
    const first = await reserveXApiFetch(repo as any, e, new Date('2026-08-26T01:00:00.000Z'));
    const duplicateSlot = await reserveXApiFetch(repo as any, e, new Date('2026-08-26T01:05:00.000Z'));
    const second = await reserveXApiFetch(repo as any, e, new Date('2026-08-26T01:15:00.000Z'));
    const third = await reserveXApiFetch(repo as any, e, new Date('2026-08-26T01:30:00.000Z'));

    expect(xApiSlotFor(new Date('2026-08-26T01:05:00.000Z'))).toBe('2026-08-26T01:00:00.000Z');
    expect(first).not.toBeNull();
    expect(duplicateSlot).toBeNull();
    expect(second).not.toBeNull();
    expect(third).toBeNull();
    expect(repo.rows.get('x_api:2026-08-26')?.request_count).toBe(2);
  });

  it('uses the daily attempt cap rather than fixed Beijing hours', () => {
    const e = env({ X_API_MAX_SYNC_ATTEMPTS_PER_DAY: '1' });
    const atNineBeijing = shouldRunXApiSync(new Date('2026-08-26T01:00:00.000Z'), null, e);
    const afterOneAttempt = shouldRunXApiSync(
      new Date('2026-08-26T01:15:00.000Z'),
      { request_count: 1, last_request_slot: xApiSlotFor(new Date('2026-08-26T01:00:00.000Z')) },
      e,
    );
    expect(atNineBeijing.allowed).toBe(true);
    expect(afterOneAttempt.reason).toBe('daily_budget_exhausted');
  });

  it('manual or duplicate Cron triggers cannot bypass the used slot or budget', () => {
    const e = env();
    const slot = xApiSlotFor(new Date('2026-08-26T01:00:00.000Z'));
    const usage = { request_count: 1, last_request_slot: slot, last_request_at: '2026-08-26T01:00:00.000Z' };
    const duplicate = shouldRunXApiSync(new Date('2026-08-26T01:05:00.000Z'), usage, e);
    const exhausted = shouldRunXApiSync(new Date('2026-08-26T13:00:00.000Z'), { ...usage, request_count: 96 }, e);
    expect(duplicate.reason).toBe('schedule_slot_already_used');
    expect(exhausted.reason).toBe('daily_budget_exhausted');
  });

  it('resets the internal cap by Beijing calendar date', async () => {
    const repo = fakeRepo();
    const e = env({ X_API_MAX_SYNC_ATTEMPTS_PER_DAY: '1' });
    await reserveXApiFetch(repo as any, e, new Date('2026-08-26T13:00:00.000Z'));
    const nextDay = await reserveXApiFetch(repo as any, e, new Date('2026-08-27T01:00:00.000Z'));
    expect(providerUsageDate(new Date('2026-08-27T01:00:00.000Z'))).toBe('2026-08-27');
    expect(nextDay).not.toBeNull();
  });

  it('allows up to 96 aligned attempts in one Beijing day', async () => {
    const repo = fakeRepo();
    const e = env();
    let logicalXSyncs = 0;

    // 16:00 UTC through 15:45 UTC is exactly one Beijing calendar day.
    for (let slot = 0; slot < 96; slot++) {
      const now = new Date(Date.UTC(2026, 7, 26, 16, slot * 15, 0));
      const usageDate = providerUsageDate(now);
      const usage = repo.rows.get(`x_api:${usageDate}`) ?? null;
      const decision = shouldRunXApiSync(now, usage, e);
      if (!decision.allowed) continue;
      const reservation = await reserveXApiFetch(repo as any, e, now);
      if (reservation) logicalXSyncs++;
    }

    expect(logicalXSyncs).toBe(96);
    expect(repo.rows.get('x_api:2026-08-27')?.request_count).toBe(96);
  });

  it('marks the source stale after 30 minutes without a successful sync', () => {
    const e = env();
    const lastSuccess = '2026-08-27T05:00:00.000Z';
    expect(isXApiSyncOverdue(new Date('2026-08-27T05:30:00.000Z'), lastSuccess, e, { usedToday: 1 })).toBe(false);
    expect(isXApiSyncOverdue(new Date('2026-08-27T05:31:00.000Z'), lastSuccess, e, { usedToday: 1 })).toBe(true);
  });

  it('backs off until the X rate-limit reset when remaining is zero', () => {
    const e = env();
    const now = new Date('2026-08-27T05:00:00.000Z');
    const resetAt = '2026-08-27T05:10:00.000Z';
    const usage = {
      request_count: 1,
      last_request_at: '2026-08-27T04:45:00.000Z',
      last_request_slot: xApiSlotFor(new Date('2026-08-27T04:45:00.000Z')),
      rate_limit_remaining: 0,
      rate_limit_reset_at: resetAt,
    };

    expect(shouldRunXApiSync(now, usage, e).reason).toBe('rate_limit_reset_pending');
    expect(nextScheduledXSyncAt(now, e, usage)).toBe(resetAt);
    expect(isXApiSyncOverdue(now, '2026-08-27T04:00:00.000Z', e, usage)).toBe(false);
  });

  it('keeps a no-success source stale even after the internal attempt cap', () => {
    const e = env();
    expect(isXApiSyncOverdue(
      new Date('2026-08-27T05:00:00.000Z'),
      null,
      e,
      { usedToday: 96 },
    )).toBe(true);
  });
});
