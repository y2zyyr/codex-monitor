import type { Env } from '../types';
import { Repository } from '../db/repository';
import { canUseXApi } from '../providers/x-api';
import {
  getXApiDailyLimit,
  getXApiPollIntervalMinutes,
  isXApiAutomaticSyncEnabled,
  isXApiSyncOverdue,
  nextScheduledXSyncAt,
  providerUsageDate,
} from './schedule';

export interface XApiStatusSnapshot {
  name: 'x_api';
  configured: boolean;
  automaticSync: boolean;
  status: string;
  sourceRole: 'primary';
  dailyLimit: number;
  usedToday: number;
  pollIntervalMinutes: number;
  lastFetchAt: string | null;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastNewPostAt: string | null;
  nextPollAt: string | null;
  nextScheduledSync: string | null;
  rateLimitRemaining: number | null;
  rateLimitResetAt: string | null;
  observedPostsToday: number;
}

export async function getXApiStatusSnapshot(
  repo: Repository,
  env: Env,
  now = new Date(),
): Promise<XApiStatusSnapshot> {
  const configured = canUseXApi(env);
  const automaticSync = configured && isXApiAutomaticSyncEnabled(env);
  const usageDate = providerUsageDate(now);
  const [usage, providerStatus, lastAttemptSetting, lastSuccessSetting, lastNewPostAt, rateLimitRemaining, rateLimitResetAt, observedPostsToday] = await Promise.all([
    repo.getProviderUsageSummary('x_api', usageDate),
    repo.getProviderStatus('x_api'),
    repo.getSetting('x_api_last_attempt_at'),
    repo.getSetting('x_api_last_success_at'),
    repo.getSetting('x_api_last_new_post_at'),
    repo.getSetting('x_api_rate_limit_remaining'),
    repo.getSetting('x_api_rate_limit_reset_at'),
    repo.getSourcePostCountForDate('x_api', usageDate),
  ]);

  const lastAttemptAt = lastAttemptSetting ?? usage.lastFetchAt;
  const lastSuccessAt = lastSuccessSetting ?? usage.lastSuccessAt;
  const parsedRemaining = rateLimitRemaining && /^\d+$/.test(rateLimitRemaining)
    ? Number(rateLimitRemaining)
    : null;
  const stale = automaticSync && isXApiSyncOverdue(now, lastSuccessAt, env, {
    usedToday: usage.usedToday,
    last_request_at: usage.lastRequestAt,
    rate_limit_remaining: parsedRemaining,
    rate_limit_reset_at: rateLimitResetAt,
  });
  const status = !configured
    ? 'not_configured'
    : !automaticSync
      ? 'disabled'
      : providerStatus?.status === 'down' || providerStatus?.status === 'degraded'
        ? providerStatus.status
        : stale
          ? 'stale'
          : (providerStatus?.status ?? (lastSuccessAt ? 'ok' : 'unknown'));
  const nextPollAt = automaticSync
    ? nextScheduledXSyncAt(now, env, {
      usedToday: usage.usedToday,
      last_request_at: usage.lastRequestAt,
      rate_limit_remaining: parsedRemaining,
      rate_limit_reset_at: rateLimitResetAt,
    })
    : null;

  return {
    name: 'x_api',
    configured,
    automaticSync,
    status,
    sourceRole: 'primary',
    dailyLimit: getXApiDailyLimit(env),
    usedToday: usage.usedToday,
    pollIntervalMinutes: getXApiPollIntervalMinutes(env),
    lastFetchAt: usage.lastFetchAt,
    lastAttemptAt,
    lastSuccessAt,
    lastNewPostAt,
    nextPollAt,
    nextScheduledSync: nextPollAt,
    rateLimitRemaining: parsedRemaining,
    rateLimitResetAt: rateLimitResetAt ?? null,
    observedPostsToday,
  };
}
