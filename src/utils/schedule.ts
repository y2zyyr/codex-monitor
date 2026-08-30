// ============================================================
// Provider schedule and hard-budget helpers
// ============================================================
import type { Env } from '../types';

export const BEIJING_TIME_ZONE = 'Asia/Shanghai';
/**
 * This is an internal safety ceiling for sync attempts, not X's Post-read
 * billing quota. A successful since_id poll can still return zero Posts.
 */
export const MAX_X_API_FETCHES_PER_DAY = 96;
export const DEFAULT_X_API_DAILY_LIMIT = MAX_X_API_FETCHES_PER_DAY;
export const DEFAULT_X_API_POLL_INTERVAL_MINUTES = 15;
export const DEFAULT_X_API_STALE_AFTER_MINUTES = 30;

// Kept for compatibility with older callers/configuration. New scheduling is
// interval-based and does not use fixed Beijing hours.
export const DEFAULT_X_API_SYNC_HOURS = [9, 21] as const;

export interface UsageSnapshot {
  request_count: number;
  usedToday?: number;
  last_request_at?: string | null;
  last_request_slot?: string | null;
  rate_limit_remaining?: number | null;
  rate_limit_reset_at?: string | null;
}

export interface XApiUsageSnapshot {
  request_count?: number;
  usedToday?: number;
  last_request_at?: string | null;
  lastFetchAt?: string | null;
  rate_limit_remaining?: number | null;
  rate_limit_reset_at?: string | null;
}

export type XSyncSkipReason =
  | 'disabled'
  | 'interval_not_elapsed'
  | 'daily_budget_exhausted'
  | 'schedule_slot_already_used'
  | 'rate_limit_reset_pending'
  | 'lock_unavailable';

export interface XSyncDecision {
  allowed: boolean;
  reason: 'allowed' | XSyncSkipReason;
  usageDate: string;
  localHour: number;
  slot: string | null;
  dailyLimit: number;
  pollIntervalMinutes: number;
}

function numberFromEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
}

function rateLimitResetPending(now: Date, usage: UsageSnapshot | XApiUsageSnapshot | null | undefined): boolean {
  if (usage?.rate_limit_remaining !== 0 || !usage.rate_limit_reset_at) return false;
  const resetAt = new Date(usage.rate_limit_reset_at).getTime();
  return Number.isFinite(resetAt) && now.getTime() < resetAt;
}

/** Keep the internal safety ceiling bounded even if a deployment variable is invalid. */
export function getXApiDailyLimit(envOrValue?: Env | string): number {
  const value = typeof envOrValue === 'string' ? envOrValue : (
    envOrValue?.X_API_MAX_SYNC_ATTEMPTS_PER_DAY
      ?? envOrValue?.X_API_DAILY_LIMIT
  );
  return Math.max(0, Math.min(MAX_X_API_FETCHES_PER_DAY,
    numberFromEnv(value, DEFAULT_X_API_DAILY_LIMIT)));
}

export function getXApiPollIntervalMinutes(
  env: Env | { X_API_POLL_INTERVAL_MINUTES?: string },
): number {
  return Math.max(5, Math.min(60,
    numberFromEnv(env.X_API_POLL_INTERVAL_MINUTES, DEFAULT_X_API_POLL_INTERVAL_MINUTES)));
}

export function getXApiStaleAfterMinutes(
  env: Env | { X_API_STALE_AFTER_MINUTES?: string },
): number {
  return Math.max(15, Math.min(24 * 60,
    numberFromEnv(env.X_API_STALE_AFTER_MINUTES, DEFAULT_X_API_STALE_AFTER_MINUTES)));
}

export function parseSyncHours(value?: string, dailyLimit = DEFAULT_X_API_DAILY_LIMIT): number[] {
  if (dailyLimit <= 0) return [];

  const requested = (value || '')
    .split(',')
    .map(part => Number(part.trim()))
    .filter(hour => Number.isInteger(hour) && hour >= 0 && hour <= 23);

  const hours = (requested.length > 0 ? requested : [...DEFAULT_X_API_SYNC_HOURS]);
  return [...new Set(hours)].sort((a, b) => a - b).slice(0, dailyLimit);
}

export function getXApiSyncHours(env: Env | { X_API_DAILY_LIMIT?: string; X_API_SYNC_HOURS?: string }): number[] {
  const limit = getXApiDailyLimit(env as Env);
  return parseSyncHours(env.X_API_SYNC_HOURS, limit);
}

export function isXApiAutomaticSyncEnabled(
  env: Env | { X_API_AUTOMATIC_SYNC?: string },
): boolean {
  return env.X_API_AUTOMATIC_SYNC?.trim().toLowerCase() === 'true';
}

export function beijingDateParts(now: Date = new Date()): { date: string; hour: number; minute: number } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: BEIJING_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const value = (type: string) => parts.find(part => part.type === type)?.value ?? '';
  // Some runtimes format midnight as 24. Normalize it for slot comparisons.
  const rawHour = Number(value('hour'));
  const hour = rawHour === 24 ? 0 : rawHour;
  return {
    date: `${value('year')}-${value('month')}-${value('day')}`,
    hour,
    minute: Number(value('minute')),
  };
}

export function providerUsageDate(now: Date = new Date()): string {
  return beijingDateParts(now).date;
}

export function scheduledSlotFor(now: Date, syncHours: number[]): string | null {
  const local = beijingDateParts(now);
  if (!syncHours.includes(local.hour)) return null;
  return `${local.date}@${String(local.hour).padStart(2, '0')}`;
}

/** Return the UTC-aligned slot containing this instant. */
export function xApiSlotFor(
  now: Date,
  intervalMinutes = DEFAULT_X_API_POLL_INTERVAL_MINUTES,
): string {
  const intervalMs = Math.max(1, Math.floor(intervalMinutes)) * 60_000;
  const slotStart = Math.floor(now.getTime() / intervalMs) * intervalMs;
  return new Date(slotStart).toISOString();
}

/**
 * Time-window gating is advisory; the atomic D1 reservation is the final
 * guard. Keeping both checks means duplicate manual triggers in one slot are
 * skipped even when they race with the 15-minute Cron.
 */
export function shouldRunXApiSync(
  now: Date,
  usage: UsageSnapshot | null | undefined,
  env: Env | {
    X_API_DAILY_LIMIT?: string;
    X_API_MAX_SYNC_ATTEMPTS_PER_DAY?: string;
    X_API_POLL_INTERVAL_MINUTES?: string;
  },
): XSyncDecision {
  const dailyLimit = getXApiDailyLimit(env as Env);
  const pollIntervalMinutes = getXApiPollIntervalMinutes(env);
  const local = beijingDateParts(now);
  const slot = xApiSlotFor(now, pollIntervalMinutes);
  const base = { usageDate: local.date, localHour: local.hour, slot, dailyLimit, pollIntervalMinutes };

  if (dailyLimit <= 0) return { allowed: false, reason: 'disabled', ...base };
  if ((usage?.request_count ?? usage?.usedToday ?? 0) >= dailyLimit) {
    return { allowed: false, reason: 'daily_budget_exhausted', ...base };
  }
  if (rateLimitResetPending(now, usage)) {
    return { allowed: false, reason: 'rate_limit_reset_pending', ...base };
  }
  if (usage?.last_request_slot === slot) {
    return { allowed: false, reason: 'schedule_slot_already_used', ...base };
  }
  const lastRequestAt = usage?.last_request_at;
  if (lastRequestAt) {
    const last = new Date(lastRequestAt).getTime();
    if (!Number.isNaN(last) && now.getTime() < last + pollIntervalMinutes * 60_000) {
      return { allowed: false, reason: 'interval_not_elapsed', ...base };
    }
  }
  return { allowed: true, reason: 'allowed', ...base };
}

function dateAtBeijingHour(date: string, hour: number): Date {
  // Asia/Shanghai is UTC+08:00 and has no DST transitions.
  return new Date(`${date}T${String(hour).padStart(2, '0')}:00:00+08:00`);
}

export function nextScheduledXSyncAt(
  now: Date,
  env: Env | {
    X_API_DAILY_LIMIT?: string;
    X_API_MAX_SYNC_ATTEMPTS_PER_DAY?: string;
    X_API_POLL_INTERVAL_MINUTES?: string;
  },
  usage?: XApiUsageSnapshot | null,
): string | null {
  const dailyLimit = getXApiDailyLimit(env as Env);
  const intervalMinutes = getXApiPollIntervalMinutes(env);

  const budgetResetAt = (usage?.request_count ?? usage?.usedToday ?? 0) >= dailyLimit
    ? nextBeijingMidnightDate(now).getTime()
    : null;
  const rateResetAt = rateLimitResetPending(now, usage)
    ? new Date(usage!.rate_limit_reset_at!).getTime()
    : null;
  if (budgetResetAt !== null || rateResetAt !== null) {
    return new Date(Math.max(budgetResetAt ?? 0, rateResetAt ?? 0)).toISOString();
  }

  const intervalMs = intervalMinutes * 60_000;
  let next = new Date((Math.floor(now.getTime() / intervalMs) + 1) * intervalMs);
  const lastRequestAt = usage?.last_request_at ?? usage?.lastFetchAt;
  if (lastRequestAt) {
    const last = new Date(lastRequestAt);
    if (!Number.isNaN(last.getTime())) {
      const afterLast = new Date(last.getTime() + intervalMs);
      if (afterLast.getTime() > next.getTime()) next = afterLast;
    }
  }
  return next.toISOString();
}

function nextBeijingMidnightDate(now: Date): Date {
  const local = beijingDateParts(now);
  const todayMidnight = new Date(`${local.date}T00:00:00+08:00`);
  return new Date(todayMidnight.getTime() + 86400000);
}

/**
 * Health uses the same polling interval as the Cron. A sync is overdue only
 * after the configured stale window has passed without a successful fetch.
 */
export function isXApiSyncOverdue(
  now: Date,
  lastSuccessAt: string | null | undefined,
  env: Env | {
    X_API_DAILY_LIMIT?: string;
    X_API_MAX_SYNC_ATTEMPTS_PER_DAY?: string;
    X_API_STALE_AFTER_MINUTES?: string;
  },
  usage?: XApiUsageSnapshot | null,
): boolean {
  if (getXApiDailyLimit(env as Env) <= 0) return false;
  if (rateLimitResetPending(now, usage)) return false;
  if (!lastSuccessAt) return true;
  // Once the daily budget is used after at least one successful fetch, the
  // following Beijing day is the next legal opportunity, not a health error.
  if ((usage?.request_count ?? usage?.usedToday ?? 0) >= getXApiDailyLimit(env as Env)) return false;
  const last = new Date(lastSuccessAt).getTime();
  if (Number.isNaN(last)) return true;
  return now.getTime() - last > getXApiStaleAfterMinutes(env) * 60_000;
}
