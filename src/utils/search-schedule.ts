// ============================================================
// Adaptive Web Search cadence, budget and cost projection helpers
// ============================================================
import type { Env } from '../types';
import { beijingDateParts } from './schedule';

export const DEFAULT_NORMAL_SEARCH_INTERVAL_HOURS = 4;
export const DEFAULT_WEB_SEARCH_DAILY_LIMIT = 6;
// Active reset modes search hourly (see getWebSearchIntervalHours). A six-request
// daily budget would be exhausted after six hours of watching, exactly when the
// monitor needs the most confirmation/discovery headroom. Active modes therefore
// draw on a separate, larger budget pool; NORMAL keeps the conservative default.
export const DEFAULT_WEB_SEARCH_ACTIVE_MODE_DAILY_LIMIT = 24;
// Supplemental searches are a backstop for reply/thread posts that the direct X
// timeline used to exclude. They draw on their own small daily pool (separate
// from the discovery/confirmation pool) so a healthy direct source or a NORMAL
// quiet period cannot burn the 6/day discovery budget. NORMAL therefore stays
// at 6/day discovery + up to 2/day reply supplement (7-8 total), fail closed.
export const DEFAULT_WEB_SEARCH_SUPPLEMENT_DAILY_LIMIT = 2;
// Never run twice within this window.
export const DEFAULT_WEB_SEARCH_SUPPLEMENT_INTERVAL_HOURS = 1;
// In NORMAL mode the supplement also fires when the last regular discovery
// search is this old: a reset announced as a bare reply with no prior plan
// must not wait for the next 4-hour discovery slot.
export const DEFAULT_WEB_SEARCH_SUPPLEMENT_NORMAL_STALE_HOURS = 2;
export const DEFAULT_BRAVE_SEARCH_PRICE_PER_1000_USD = 5;
export const DEFAULT_BRAVE_MONTHLY_CREDIT_USD = 5;
export const DEFAULT_WEB_SEARCH_FALLBACK_BACKOFF_MINUTES = 30;
// A plan without an explicit timestamp is expected to be fulfilled shortly.
// Beyond this window it must not keep the monitor in reset-watching mode.
export const APPROXIMATE_RESET_MAX_AGE_HOURS = 48;

export type WebSearchMode = 'NORMAL' | 'WATCHING_RESET' | 'CONFIRMING_RESET';

export interface ResetCycleSnapshot {
  status?: string | null;
  expected_reset_at?: string | null;
}

export interface WebSearchUsageSnapshot {
  request_count?: number;
  usedToday?: number;
  last_request_at?: string | null;
  last_request_slot?: string | null;
}

export function isStaleApproximateReset(
  expectedResetAt: string | null | undefined,
  publishedAt: string | null | undefined,
  createdAt: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (expectedResetAt) return false;
  const reference = publishedAt || createdAt;
  if (!reference) return false;
  const referenceMs = new Date(reference).getTime();
  if (Number.isNaN(referenceMs)) return false;
  return now.getTime() - referenceMs > APPROXIMATE_RESET_MAX_AGE_HOURS * 3600000;
}

export type WebSearchSkipReason =
  | 'disabled'
  | 'daily_budget_exhausted'
  | 'interval_not_elapsed'
  | 'no_trigger';

export interface WebSearchDecision {
  allowed: boolean;
  reason: 'allowed' | WebSearchSkipReason;
  mode: WebSearchMode;
  intervalHours: number;
  dailyLimit: number;
  nextSearchAt: string | null;
}

function integerFromEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
}

function numberFromEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function usageCount(usage: WebSearchUsageSnapshot | null | undefined): number {
  return usage?.request_count ?? usage?.usedToday ?? 0;
}

export function getWebSearchDailyLimit(env: Env | { MAX_WEB_SEARCH_REQUESTS_PER_DAY?: string }): number {
  return Math.max(0, integerFromEnv(env.MAX_WEB_SEARCH_REQUESTS_PER_DAY, DEFAULT_WEB_SEARCH_DAILY_LIMIT));
}

/** Active reset modes get a larger, separately configurable daily budget. */
export function getWebSearchActiveModeDailyLimit(env: Env | { WEB_SEARCH_ACTIVE_MODE_DAILY_LIMIT?: string }): number {
  return Math.max(0, integerFromEnv(env.WEB_SEARCH_ACTIVE_MODE_DAILY_LIMIT, DEFAULT_WEB_SEARCH_ACTIVE_MODE_DAILY_LIMIT));
}

/** The reply-supplement channel has its own small daily pool (default 2/day). */
export function getWebSearchSupplementDailyLimit(env: Env | { WEB_SEARCH_SUPPLEMENT_DAILY_LIMIT?: string }): number {
  return Math.max(0, integerFromEnv(env.WEB_SEARCH_SUPPLEMENT_DAILY_LIMIT, DEFAULT_WEB_SEARCH_SUPPLEMENT_DAILY_LIMIT));
}

/** NORMAL stale-trigger window between the last regular search and a supplement. */
export function getWebSearchSupplementNormalStaleHours(env: Env | { WEB_SEARCH_SUPPLEMENT_NORMAL_STALE_HOURS?: string }): number {
  return Math.max(1, Math.min(24,
    integerFromEnv(env.WEB_SEARCH_SUPPLEMENT_NORMAL_STALE_HOURS, DEFAULT_WEB_SEARCH_SUPPLEMENT_NORMAL_STALE_HOURS)));
}

/**
 * The mode-aware daily limit. NORMAL stays conservative; WATCHING/CONFIRMING
 * draw on the active-mode pool so hourly confirmation searches do not exhaust
 * the budget after a few hours. Fail closed on zero.
 */
export function getWebSearchDailyLimitForMode(
  mode: WebSearchMode,
  env: Env | { MAX_WEB_SEARCH_REQUESTS_PER_DAY?: string; WEB_SEARCH_ACTIVE_MODE_DAILY_LIMIT?: string },
): number {
  return mode === 'NORMAL' ? getWebSearchDailyLimit(env) : getWebSearchActiveModeDailyLimit(env);
}

/** NORMAL is configurable, while active reset modes keep a one-hour cadence. */
export function getNormalSearchIntervalHours(env: Env | { NORMAL_SEARCH_INTERVAL_HOURS?: string }): number {
  return Math.max(1, Math.min(24,
    integerFromEnv(env.NORMAL_SEARCH_INTERVAL_HOURS, DEFAULT_NORMAL_SEARCH_INTERVAL_HOURS)));
}

export function getWebSearchIntervalHours(
  mode: WebSearchMode,
  env: Env | { NORMAL_SEARCH_INTERVAL_HOURS?: string },
): number {
  return mode === 'NORMAL' ? getNormalSearchIntervalHours(env) : 1;
}

/**
 * When the authoritative source is stale, search is a temporary safety net.
 * Repeated failures back off at 30m, 1h, 2h, then 4h to avoid burning the
 * entire daily search budget while X is unavailable.
 */
export function getWebSearchFallbackBackoffMinutes(failureCount = 0): number {
  const exponent = Math.max(0, Math.min(3, Math.floor(failureCount)));
  return DEFAULT_WEB_SEARCH_FALLBACK_BACKOFF_MINUTES * (2 ** exponent);
}

/**
 * Classify the current reset state without relying solely on a stale DB
 * status. A scheduled reset whose expected time has passed is confirming even
 * if the worker has not yet persisted the DUE transition.
 */
export function getWebSearchMode(
  cycle: ResetCycleSnapshot | null | undefined,
  now: Date = new Date(),
): WebSearchMode {
  if (!cycle) return 'NORMAL';

  const status = cycle.status ?? '';
  if (status === 'CONFIRMED' || status === 'CANCELLED' || status === 'NONE' || status === 'EXPIRED_UNCONFIRMED') return 'NORMAL';
  if (status === 'DUE' || status === 'CONFIRMING') {
    return 'CONFIRMING_RESET';
  }

  if (cycle.expected_reset_at) {
    const expected = new Date(cycle.expected_reset_at).getTime();
    if (!Number.isNaN(expected) && expected <= now.getTime()) return 'CONFIRMING_RESET';
  }

  // TIME_CHANGED and SCHEDULED are both watched. Keeping an approximate
  // schedule in WATCHING mode is safer than dropping clarification searches.
  if (status === 'SCHEDULED' || status === 'TIME_CHANGED' || cycle.expected_reset_at) {
    return 'WATCHING_RESET';
  }
  return 'NORMAL';
}

function nextBeijingMidnight(now: Date): string {
  const local = beijingDateParts(now);
  const todayMidnight = new Date(`${local.date}T00:00:00+08:00`);
  return new Date(todayMidnight.getTime() + 86400000).toISOString();
}

export function nextWebSearchAt(
  now: Date,
  mode: WebSearchMode,
  lastAttemptAt: string | null | undefined,
  usage: WebSearchUsageSnapshot | null | undefined,
  env: Env | { NORMAL_SEARCH_INTERVAL_HOURS?: string; MAX_WEB_SEARCH_REQUESTS_PER_DAY?: string; WEB_SEARCH_ACTIVE_MODE_DAILY_LIMIT?: string },
): string | null {
  const dailyLimit = getWebSearchDailyLimitForMode(mode, env);
  if (dailyLimit <= 0) return null;
  if (usageCount(usage) >= dailyLimit) return nextBeijingMidnight(now);
  if (!lastAttemptAt) return now.toISOString();

  const last = new Date(lastAttemptAt);
  if (Number.isNaN(last.getTime())) return now.toISOString();
  const candidate = new Date(last.getTime() + getWebSearchIntervalHours(mode, env) * 3600000);
  return candidate.getTime() <= now.getTime() ? now.toISOString() : candidate.toISOString();
}

export function shouldRunWebSearch(
  now: Date,
  mode: WebSearchMode,
  lastAttemptAt: string | null | undefined,
  usage: WebSearchUsageSnapshot | null | undefined,
  env: Env | { NORMAL_SEARCH_INTERVAL_HOURS?: string; MAX_WEB_SEARCH_REQUESTS_PER_DAY?: string; WEB_SEARCH_ACTIVE_MODE_DAILY_LIMIT?: string },
): WebSearchDecision {
  const dailyLimit = getWebSearchDailyLimitForMode(mode, env);
  const intervalHours = getWebSearchIntervalHours(mode, env);
  const nextSearchAt = nextWebSearchAt(now, mode, lastAttemptAt, usage, env);
  const base = { mode, intervalHours, dailyLimit, nextSearchAt };

  if (dailyLimit <= 0) return { allowed: false, reason: 'disabled', ...base };
  if (usageCount(usage) >= dailyLimit) {
    return { allowed: false, reason: 'daily_budget_exhausted', ...base };
  }
  if (lastAttemptAt) {
    const last = new Date(lastAttemptAt).getTime();
    if (!Number.isNaN(last) && now.getTime() < last + intervalHours * 3600000) {
      return { allowed: false, reason: 'interval_not_elapsed', ...base };
    }
  }
  return { allowed: true, reason: 'allowed', ...base };
}

/**
 * Supplemental search trigger: the direct X timeline is healthy and up to date,
 * but replies/thread tails may have been missed before replies were re-enabled,
 * and web indexes are slower than the API. The trigger set is intentionally
 * wider than the old active-mode-only gate so a bare “Reset done.” reply with
 * no prior plan cannot sit unseen for the whole 4-hour NORMAL discovery window:
 *
 *  - active reset mode (WATCHING/CONFIRMING); or
 *  - NORMAL and the last regular discovery search is older than
 *    WEB_SEARCH_SUPPLEMENT_NORMAL_STALE_HOURS (default 2h); or
 *  - a direct X post containing reset-family language was ingested in the last
 *    24h without producing an event (recentResetWithoutEvent).
 *
 * The channel draws on its OWN small daily pool (WEB_SEARCH_SUPPLEMENT_DAILY_LIMIT,
 * default 2/day), never the discovery pool, so NORMAL goes from 6/day to at most
 * 8/day. It never runs twice within the cooldown interval, and it fails closed
 * on disabled/exhausted budgets. With no trigger active it returns no_trigger.
 */
export interface WebSearchSupplementDecision {
  allowed: boolean;
  reason: 'allowed' | WebSearchSkipReason;
  trigger: 'active_mode' | 'normal_stale' | 'recent_reset_signal' | null;
  intervalHours: number;
  dailyLimit: number;
  nextSupplementalAt: string | null;
}

export function getWebSearchSupplementIntervalHours(
  env: Env | { WEB_SEARCH_SUPPLEMENT_INTERVAL_HOURS?: string },
): number {
  return Math.max(0.25, Math.min(24,
    numberFromEnv(env.WEB_SEARCH_SUPPLEMENT_INTERVAL_HOURS, DEFAULT_WEB_SEARCH_SUPPLEMENT_INTERVAL_HOURS)));
}

export interface SupplementalTriggerContext {
  /** Last regular (discovery/confirmation) search attempt, for the NORMAL stale window. */
  lastMainSearchAt?: string | null;
  /** True when a direct X post with reset language was ingested recently without an event. */
  recentResetWithoutEvent?: boolean;
}

export function shouldRunSupplementalWebSearch(
  now: Date,
  mode: WebSearchMode,
  lastSupplementalAt: string | null | undefined,
  usage: WebSearchUsageSnapshot | null | undefined,
  env: Env | {
    WEB_SEARCH_SUPPLEMENT_INTERVAL_HOURS?: string;
    WEB_SEARCH_SUPPLEMENT_DAILY_LIMIT?: string;
    WEB_SEARCH_SUPPLEMENT_NORMAL_STALE_HOURS?: string;
  },
  triggerContext: SupplementalTriggerContext = {},
): WebSearchSupplementDecision {
  // Fail closed first: the supplement pool is the hard ceiling for this channel.
  const dailyLimit = getWebSearchSupplementDailyLimit(env);
  const intervalHours = getWebSearchSupplementIntervalHours(env);
  const nextSupplementalAt = (() => {
    if (dailyLimit <= 0) return null;
    if (usageCount(usage) >= dailyLimit) return nextBeijingMidnight(now);
    if (!lastSupplementalAt) return now.toISOString();
    const last = new Date(lastSupplementalAt);
    if (Number.isNaN(last.getTime())) return now.toISOString();
    const candidate = new Date(last.getTime() + intervalHours * 3600000);
    return candidate.getTime() <= now.getTime() ? now.toISOString() : candidate.toISOString();
  })();
  const base = { intervalHours, dailyLimit, nextSupplementalAt };

  if (dailyLimit <= 0) return { allowed: false, reason: 'disabled', trigger: null, ...base };
  if (usageCount(usage) >= dailyLimit) {
    return { allowed: false, reason: 'daily_budget_exhausted', trigger: null, ...base };
  }
  if (lastSupplementalAt) {
    const last = new Date(lastSupplementalAt).getTime();
    if (!Number.isNaN(last) && now.getTime() < last + intervalHours * 3600000) {
      return { allowed: false, reason: 'interval_not_elapsed', trigger: null, ...base };
    }
  }

  // Trigger selection. Active reset modes always qualify; NORMAL needs a stale
  // regular search or a fresh direct reset signal without an event.
  let trigger: WebSearchSupplementDecision['trigger'] = null;
  if (mode !== 'NORMAL') {
    trigger = 'active_mode';
  } else if (triggerContext.recentResetWithoutEvent === true) {
    trigger = 'recent_reset_signal';
  } else if (triggerContext.lastMainSearchAt) {
    const lastMain = new Date(triggerContext.lastMainSearchAt).getTime();
    if (!Number.isNaN(lastMain)
      && now.getTime() >= lastMain + getWebSearchSupplementNormalStaleHours(env) * 3600000) {
      trigger = 'normal_stale';
    }
  }

  if (trigger === null) return { allowed: false, reason: 'no_trigger', trigger: null, ...base };
  return { allowed: true, reason: 'allowed', trigger, ...base };
}

/** Health must use the last successful cycle, not the last attempt. */
export function isWebSearchOverdue(
  now: Date,
  lastSuccessAt: string | null | undefined,
  mode: WebSearchMode,
  env: Env | { NORMAL_SEARCH_INTERVAL_HOURS?: string; MAX_WEB_SEARCH_REQUESTS_PER_DAY?: string; WEB_SEARCH_ACTIVE_MODE_DAILY_LIMIT?: string },
  usage?: WebSearchUsageSnapshot | null,
): boolean {
  if (getWebSearchDailyLimitForMode(mode, env) <= 0) return false;
  if (usageCount(usage) >= getWebSearchDailyLimitForMode(mode, env)) return false;
  if (!lastSuccessAt) return true;
  const last = new Date(lastSuccessAt).getTime();
  if (Number.isNaN(last)) return true;
  // At the exact eligibility boundary the next scheduled Cron is due, so do not
  // report stale before that scheduled opportunity has had a chance to run.
  return now.getTime() > last + getWebSearchIntervalHours(mode, env) * 3600000;
}

/** One query per cycle is the default; active modes rotate focused queries. */
export function getEstimatedMonthlyRequests(
  mode: WebSearchMode,
  env: Env | { NORMAL_SEARCH_INTERVAL_HOURS?: string; MAX_WEB_SEARCH_REQUESTS_PER_DAY?: string; WEB_SEARCH_ACTIVE_MODE_DAILY_LIMIT?: string },
  queriesPerCycle = 1,
  days = 30,
): number {
  const cyclesPerDay = 24 / getWebSearchIntervalHours(mode, env);
  const requestsPerCycle = Math.max(1, Math.floor(queriesPerCycle));
  const dailyLimit = getWebSearchDailyLimitForMode(mode, env);
  return Math.ceil(Math.min(cyclesPerDay * requestsPerCycle, dailyLimit) * days);
}

export function getBraveSearchPricePer1000Usd(env: Env | { BRAVE_SEARCH_PRICE_PER_1000_USD?: string }): number {
  return Math.max(0, numberFromEnv(env.BRAVE_SEARCH_PRICE_PER_1000_USD, DEFAULT_BRAVE_SEARCH_PRICE_PER_1000_USD));
}

export function getBraveMonthlyCreditUsd(env: Env | { BRAVE_MONTHLY_CREDIT_USD?: string }): number {
  return Math.max(0, numberFromEnv(env.BRAVE_MONTHLY_CREDIT_USD, DEFAULT_BRAVE_MONTHLY_CREDIT_USD));
}

export function getEstimatedMonthlyGrossCostUsd(
  mode: WebSearchMode,
  env: Env | { NORMAL_SEARCH_INTERVAL_HOURS?: string; MAX_WEB_SEARCH_REQUESTS_PER_DAY?: string; BRAVE_SEARCH_PRICE_PER_1000_USD?: string },
  queriesPerCycle = 1,
  days = 30,
): number {
  const requests = getEstimatedMonthlyRequests(mode, env, queriesPerCycle, days);
  return Math.round((requests / 1000) * getBraveSearchPricePer1000Usd(env) * 100) / 100;
}
