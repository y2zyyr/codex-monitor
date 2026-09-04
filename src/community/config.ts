import type { Env } from '../types';
import { SITE_LOCALES, type SiteLocale } from '../i18n';

const DEFAULT_MAX_CONTENT_LENGTH = 2000;
const DEFAULT_MAX_NICKNAME_LENGTH = 32;
const DEFAULT_RATE_MINUTE = 1;
const DEFAULT_RATE_HOUR = 5;
const DEFAULT_RATE_DAY = 15;
const DEFAULT_GITHUB_CACHE_TTL_HOURS = 24;
const DEFAULT_AGENT_MAX_PER_RUN = 3;
const DEFAULT_AGENT_MAX_PER_DAY = 8;
// A single agent run is expected to finish well inside this window. The
// per-run bucket only exists so a stuck or replayed run cannot publish
// forever; it is not a rate limit on its own.
const AGENT_RUN_WINDOW_MS = 6 * 60 * 60 * 1000;
const AGENT_DAY_WINDOW_MS = 24 * 60 * 60 * 1000;
// The existing LLM endpoint can legitimately take several seconds to return,
// especially for a cold request. Four seconds caused valid translations to be
// aborted before the provider had a chance to answer.
const DEFAULT_TRANSLATION_TIMEOUT_MS = 15000;
const DEFAULT_TRANSLATION_MAX_TOKENS = 2400;

function booleanFromEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  return value.trim().toLowerCase() !== 'false';
}

function integerFromEnv(value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export interface CommunityConfig {
  postingFlag: boolean;
  postingEnabled: boolean;
  translationFlag: boolean;
  translationEnabled: boolean;
  githubCardEnabled: boolean;
  maxContentLength: number;
  maxNicknameLength: number;
  ratePerMinute: number;
  ratePerHour: number;
  ratePerDay: number;
  githubCacheTtlMs: number;
  translationTimeoutMs: number;
  translationMaxTokens: number;
  translationLocales: SiteLocale[];
  turnstileSiteKey: string | null;
  turnstileSecretKey: string | null;
  abuseHashSecret: string | null;
  adminToken: string | null;
  agentSecret: string | null;
  agentPostingFlag: boolean;
  agentPostingEnabled: boolean;
  agentMaxPerRun: number;
  agentMaxPerDay: number;
  agentRunWindowMs: number;
  agentDayWindowMs: number;
  githubToken: string | null;
  translationApiKey: string | null;
  translationBaseUrl: string;
  translationModel: string;
  siteUrl: string;
}

function translationLocalesFromEnv(value: string | undefined): SiteLocale[] {
  const requested = (value || SITE_LOCALES.join(','))
    .split(',')
    .map(item => item.trim().toLowerCase())
    .filter((item): item is SiteLocale => (SITE_LOCALES as readonly string[]).includes(item));
  const locales = SITE_LOCALES.filter(locale => requested.includes(locale));
  // English and Chinese remain required for backwards-compatible API fields
  // and for the existing two public site versions.
  return SITE_LOCALES.filter(locale => locales.includes(locale) || locale === 'en' || locale === 'zh');
}

/**
 * Read Community configuration in one place. The posting switch is fail
 * closed when the two server-side anti-abuse prerequisites or the public
 * Turnstile site key are absent; reading the feed remains available.
 */
export function getCommunityConfig(env: Env): CommunityConfig {
  const postingFlag = booleanFromEnv(env.COMMUNITY_POSTING_ENABLED, true);
  const translationFlag = booleanFromEnv(env.TRANSLATION_ENABLED, true);
  const githubCardEnabled = booleanFromEnv(env.GITHUB_CARD_ENABLED, true);
  const turnstileSiteKey = env.TURNSTILE_SITE_KEY?.trim() || null;
  const turnstileSecretKey = env.TURNSTILE_SECRET_KEY?.trim() || null;
  const abuseHashSecret = (env.ABUSE_HASH_SECRET || '').trim() || null;
  const adminToken = env.COMMUNITY_ADMIN_TOKEN?.trim() || null;
  const agentSecret = (env.COMMUNITY_AGENT_SECRET || '').trim() || null;
  const agentPostingFlag = booleanFromEnv(env.COMMUNITY_AGENT_ENABLED, true);
  const githubToken = env.GITHUB_TOKEN?.trim() || null;
  const translationApiKey = (env.TRANSLATION_API_KEY || env.LLM_API_KEY || '').trim() || null;

  return {
    postingFlag,
    postingEnabled: postingFlag && Boolean(turnstileSiteKey && turnstileSecretKey && abuseHashSecret),
    translationFlag,
    translationEnabled: translationFlag && Boolean(translationApiKey),
    githubCardEnabled,
    maxContentLength: integerFromEnv(env.COMMUNITY_MAX_CONTENT_LENGTH, DEFAULT_MAX_CONTENT_LENGTH, 100, 10000),
    maxNicknameLength: integerFromEnv(env.COMMUNITY_MAX_NICKNAME_LENGTH, DEFAULT_MAX_NICKNAME_LENGTH, 1, 128),
    ratePerMinute: integerFromEnv(env.COMMUNITY_RATE_MINUTE, DEFAULT_RATE_MINUTE, 1, 100),
    ratePerHour: integerFromEnv(env.COMMUNITY_RATE_HOUR, DEFAULT_RATE_HOUR, 1, 1000),
    ratePerDay: integerFromEnv(env.COMMUNITY_RATE_DAY, DEFAULT_RATE_DAY, 1, 10000),
    githubCacheTtlMs: integerFromEnv(env.COMMUNITY_GITHUB_CACHE_TTL_HOURS, DEFAULT_GITHUB_CACHE_TTL_HOURS, 1, 168) * 60 * 60 * 1000,
    translationTimeoutMs: integerFromEnv(env.TRANSLATION_TIMEOUT_MS, DEFAULT_TRANSLATION_TIMEOUT_MS, 1000, 15000),
    translationMaxTokens: integerFromEnv(env.TRANSLATION_MAX_TOKENS, DEFAULT_TRANSLATION_MAX_TOKENS, 200, 8000),
    translationLocales: translationLocalesFromEnv(env.COMMUNITY_TRANSLATION_LOCALES),
    turnstileSiteKey,
    turnstileSecretKey,
    abuseHashSecret,
    adminToken,
    agentSecret,
    agentPostingFlag,
    // Agent publishing is a separate trust domain from browser publishing: it
    // is gated on the server-side secret, never on a Turnstile widget.
    agentPostingEnabled: postingFlag && agentPostingFlag && Boolean(agentSecret && abuseHashSecret),
    agentMaxPerRun: integerFromEnv(env.COMMUNITY_AGENT_MAX_PER_RUN, DEFAULT_AGENT_MAX_PER_RUN, 1, 10),
    agentMaxPerDay: integerFromEnv(env.COMMUNITY_AGENT_MAX_PER_DAY, DEFAULT_AGENT_MAX_PER_DAY, 1, 50),
    agentRunWindowMs: AGENT_RUN_WINDOW_MS,
    agentDayWindowMs: AGENT_DAY_WINDOW_MS,
    githubToken,
    translationApiKey,
    translationBaseUrl: (env.TRANSLATION_BASE_URL || env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
    translationModel: env.TRANSLATION_MODEL?.trim() || env.LLM_MODEL?.trim() || 'gpt-4o-mini',
    siteUrl: (env.SITE_URL?.trim() || 'https://tibo.modelyard.dev').replace(/\/+$/, ''),
  };
}
