// ============================================================
// Tibo Monitor - Low-frequency authoritative X API provider
// ============================================================
import type { Env, SourcePost } from '../types';
import type { SocialSourceProvider } from './types';
import { Repository } from '../db/repository';
import {
  getXApiDailyLimit,
  getXApiPollIntervalMinutes,
  providerUsageDate,
  xApiSlotFor,
  MAX_X_API_FETCHES_PER_DAY,
} from '../utils/schedule';

export const X_API_PROVIDER_KEY = 'x_api';
export const MAX_X_PAGES_PER_SYNC = 3;
export const MAX_X_BACKFILL_PAGES = 20;
/**
 * Single source of truth for the timeline `exclude` filter. Kept at
 * 'retweets' (replies retained) so /api/health can report the actual value
 * instead of a hardcoded flag that drifts when the filter is reverted.
 */
export const X_TIMELINE_EXCLUDE = 'retweets';

interface TwitterUserResponse {
  data?: { id: string; name: string; username: string };
  errors?: Array<{ detail?: string }>;
}

interface TwitterTweet {
  id: string;
  text: string;
  created_at?: string;
  author_id?: string;
  edit_history_tweet_ids?: string[];
}

interface TwitterTimelineResponse {
  data?: TwitterTweet[];
  meta?: { next_token?: string; result_count?: number; newest_id?: string; oldest_id?: string };
  errors?: Array<{ detail?: string; title?: string }>;
}

interface TimelinePage {
  tweets: TwitterTweet[];
  nextToken: string | null;
  newestId: string | null;
  rateLimit: XApiRateLimit;
}

export interface XApiRateLimit {
  limit: number | null;
  remaining: number | null;
  resetAt: string | null;
}

export interface XApiAccountBatch {
  account: string;
  posts: SourcePost[];
  newestId: string | null;
  complete: boolean;
  error?: string | null;
  rateLimit: XApiRateLimit;
  /** How many timeline HTTP page requests were made for this account. */
  pagesFetched: number;
}

export interface XApiFetchBatch {
  accounts: XApiAccountBatch[];
  fetchedAt: string;
}

export interface XApiReservation {
  usageDate: string;
  requestSlot: string;
  requestedAt: string;
}

/** Returned with posts so Cron can keep good account data during a partial sync. */
export class XApiPartialFailureError extends Error {
  readonly posts: SourcePost[];
  readonly accounts: XApiAccountBatch[];

  constructor(message: string, accounts: XApiAccountBatch[]) {
    super(message);
    this.name = 'XApiPartialFailureError';
    this.accounts = accounts;
    this.posts = accounts.flatMap(batch => batch.posts);
  }
}

/** Carries rate-limit headers through a failed HTTP response. */
export class XApiRequestError extends Error {
  readonly status: number;
  readonly rateLimit: XApiRateLimit;

  constructor(message: string, status: number, rateLimit: XApiRateLimit) {
    super(message);
    this.name = 'XApiRequestError';
    this.status = status;
    this.rateLimit = rateLimit;
  }
}

export function canUseXApi(env: Env): boolean {
  return !!env.X_API_BEARER_TOKEN?.trim();
}

/** Reserve one logical authoritative sync, not one HTTP subrequest. */
export async function reserveXApiFetch(repo: Repository, env: Env, now = new Date()): Promise<XApiReservation | null> {
  const remaining = await repo.getSetting('x_api_rate_limit_remaining');
  const resetAt = await repo.getSetting('x_api_rate_limit_reset_at');
  if (remaining === '0' && (!resetAt || Date.parse(resetAt) > now.getTime() || !Number.isFinite(Date.parse(resetAt)))) return null;
  const requestedAt = now.toISOString();
  const usageDate = providerUsageDate(now);
  const requestSlot = xApiSlotFor(now, getXApiPollIntervalMinutes(env));
  const limit = Math.min(MAX_X_API_FETCHES_PER_DAY, getXApiDailyLimit(env));
  const reserved = await repo.reserveProviderUsage(X_API_PROVIDER_KEY, usageDate, limit, requestedAt, requestSlot);
  return reserved ? { usageDate, requestSlot, requestedAt } : null;
}

export interface XApiFetchOptions {
  reservationAlreadyHeld?: boolean;
  reservation?: XApiReservation;
  /** Compatibility override for callers that need one shared cursor. */
  sinceId?: string;
  /**
   * Historical backfill: ignore the durable since_id cursor so old posts
   * (including replies that were once excluded) can be re-fetched. The cursor
   * is never advanced by the provider, so forward incremental syncs remain
   * unchanged. `sinceId` still applies when explicitly provided.
   */
  ignoreStoredCursor?: boolean;
  /** Backfill page depth override; capped at MAX_X_BACKFILL_PAGES. */
  backfillMaxPages?: number;
  /**
   * Absolute lower bound for a windowed fetch (X API `start_time`). Used by
   * the ingestion-completeness probe to bound the timeline window; never
   * combined with since_id by the provider.
   */
  startTime?: string;
  now?: Date;
}

/**
 * Fetch incremental batches without mutating the durable since_id cursor.
 * Cron owns cursor commits so D1 ingestion is guaranteed to happen first.
 */
export class XApiProvider implements SocialSourceProvider {
  readonly name = X_API_PROVIDER_KEY;
  private readonly bearerToken: string;
  private readonly accounts: string[];
  private readonly baseUrl = 'https://api.twitter.com/2';
  private readonly maxResults: number;
  private readonly maxPages: number;
  private readonly repo?: Repository;
  private readonly env: Env;
  httpRequestsUsed = 0;
  timelineRequestsUsed = 0;

  constructor(env: Env, repo?: Repository) {
    if (!env.X_API_BEARER_TOKEN?.trim()) throw new Error('X_API_BEARER_TOKEN is required for XApiProvider');
    this.env = env;
    this.bearerToken = env.X_API_BEARER_TOKEN.trim();
    this.accounts = (env.MONITORED_ACCOUNTS || 'thsottiaux')
      .split(',').map(account => account.trim().toLowerCase()).filter(Boolean);
    const configuredResults = Number(env.X_API_MAX_RESULTS_PER_PAGE ?? '20');
    this.maxResults = Math.max(5, Math.min(100, Number.isFinite(configuredResults) ? Math.floor(configuredResults) : 20));
    const configuredPages = Number(env.X_API_MAX_PAGES_PER_SYNC ?? String(MAX_X_PAGES_PER_SYNC));
    this.maxPages = Math.max(1, Math.min(MAX_X_PAGES_PER_SYNC, Number.isFinite(configuredPages) ? Math.floor(configuredPages) : MAX_X_PAGES_PER_SYNC));
    this.repo = repo;
  }

  async fetchLatestPosts(sinceId?: string, options: XApiFetchOptions = {}): Promise<SourcePost[]> {
    const batch = await this.fetchIncremental({ ...options, sinceId });
    return batch.accounts.flatMap(account => account.posts);
  }

  async fetchIncremental(options: XApiFetchOptions = {}): Promise<XApiFetchBatch> {
    this.httpRequestsUsed = 0;
    this.timelineRequestsUsed = 0;
    let reservation = options.reservation;
    if (this.repo && !options.reservationAlreadyHeld) {
      reservation = await reserveXApiFetch(this.repo, this.env, options.now ?? new Date()) ?? undefined;
      if (!reservation) throw new Error('X API daily budget or schedule slot is exhausted');
    }

    const fetchedAt = (options.now ?? new Date()).toISOString();
    const batches: XApiAccountBatch[] = [];
    const errors: string[] = [];

    for (const account of this.accounts) {
      const timelineRequestsBefore = this.timelineRequestsUsed;
      let posts: SourcePost[] = [];
      let rateLimit = emptyRateLimit();
      let pagesFetched = 0;
      try {
        let userId = await this.getOrResolveUserId(account);
        const storedSinceId = this.repo ? await this.repo.getSetting(`x_api_since_id:${account}`) : null;
        const accountSinceId = options.sinceId
          ?? (options.ignoreStoredCursor || options.startTime ? undefined : (storedSinceId || undefined));
        const effectiveMaxPages = options.backfillMaxPages !== undefined
          ? Math.max(1, Math.min(MAX_X_BACKFILL_PAGES, Math.floor(options.backfillMaxPages)))
          : this.maxPages;
        let timeline: IncrementalTimeline;
        try {
          timeline = await this.fetchIncrementalTimeline(account, userId, accountSinceId, effectiveMaxPages, options.startTime);
        } catch (error) {
          rateLimit = mergeRateLimits(rateLimit, rateLimitFromError(error));
          if (!this.repo || !(error instanceof Error) || !error.message.includes('timeline user not found')) throw error;
          await this.repo.setSetting(`x_api_user_id:${account}`, '');
          userId = await this.getOrResolveUserId(account);
          timeline = await this.fetchIncrementalTimeline(account, userId, accountSinceId, effectiveMaxPages, options.startTime);
        }
        rateLimit = mergeRateLimits(rateLimit, timeline.rateLimit);
        pagesFetched = timeline.pagesFetched;
        posts = [];
        for (const tweet of timeline.tweets) posts.push(await this.normalizeTweet(tweet, account, fetchedAt));
        batches.push({
          account,
          posts,
          newestId: timeline.newestId,
          complete: timeline.complete,
          error: timeline.complete ? null : 'pagination_limit_reached',
          rateLimit,
          pagesFetched,
        });
        if (!timeline.complete) errors.push(`${account}: pagination limit reached before the incremental batch completed`);
      } catch (err) {
        rateLimit = mergeRateLimits(rateLimit, rateLimitFromError(err));
        const message = err instanceof Error ? err.message : String(err);
        batches.push({ account, posts, newestId: newestPostId(posts), complete: false, error: message, rateLimit, pagesFetched: this.timelineRequestsUsed - timelineRequestsBefore });
        errors.push(`${account}: ${message}`);
        if (err instanceof XApiRequestError && err.status === 429) break;
      }
    }

    // The reservation remains consumed: an attempted authoritative sync is
    // retained as a safety accounting event. Usage success is recorded by
    // Cron only after raw D1 ingestion succeeds.
    void reservation;
    if (errors.length > 0) throw new XApiPartialFailureError(errors.join('; '), batches);
    return { accounts: batches, fetchedAt };
  }

  private async getOrResolveUserId(username: string): Promise<string> {
    const settingKey = `x_api_user_id:${username}`;
    const configured = this.env.X_API_USER_ID?.trim();
    const cached = this.repo ? await this.repo.getSetting(settingKey) : null;
    if (cached) return cached;
    if (configured && this.accounts.length === 1) {
      if (this.repo) await this.repo.setSetting(settingKey, configured);
      return configured;
    }

    const resolved = await this.resolveUserId(username);
    if (!resolved) throw new Error(`Could not resolve X user @${username}`);
    if (this.repo) await this.repo.setSetting(settingKey, resolved);
    return resolved;
  }

  private async resolveUserId(username: string): Promise<string | null> {
    const response = await this.request(`${this.baseUrl}/users/by/username/${encodeURIComponent(username)}`);
    if (!response.ok) {
      const body = await response.text();
      throw new XApiRequestError(
        `resolve user failed: ${response.status} ${body.substring(0, 180)}`,
        response.status,
        parseRateLimit(response.headers),
      );
    }
    const data = await response.json() as TwitterUserResponse;
    return data.data?.id ?? null;
  }

  private async fetchIncrementalTimeline(account: string, userId: string, sinceId?: string, maxPages = this.maxPages, startTime?: string): Promise<IncrementalTimeline> {
    let pages = 0;
    let nextToken: string | undefined;
    const allTweets: TwitterTweet[] = [];
    let rateLimit = emptyRateLimit();
    let pageHasNextToken = false;

    while (pages < maxPages) {
      const page = await this.fetchUserTimeline(userId, sinceId, nextToken, startTime);
      pages++;
      rateLimit = mergeRateLimits(rateLimit, page.rateLimit);
      for (const tweet of page.tweets) {
        if (tweet.author_id && tweet.author_id !== userId) {
          throw new Error(`author mismatch for @${account}`);
        }
        allTweets.push(tweet);
      }
      if (!page.nextToken) {
        pageHasNextToken = false;
        break;
      }
      pageHasNextToken = true;
      nextToken = page.nextToken;
      if (page.rateLimit.remaining === 0 && pages < maxPages) throw new XApiRequestError('X_RATE_LIMIT_EXHAUSTED', 429, page.rateLimit);
    }

    const newestId = allTweets
      .map(tweet => tweet.id)
      .sort(compareSnowflakeIds)[0] ?? null;
    return {
      tweets: allTweets,
      newestId,
      complete: !pageHasNextToken,
      rateLimit,
      pagesFetched: pages,
    };
  }

  private async fetchUserTimeline(userId: string, sinceId?: string, paginationToken?: string, startTime?: string): Promise<TimelinePage> {
    const url = new URL(`${this.baseUrl}/users/${encodeURIComponent(userId)}/tweets`);
    url.searchParams.set('max_results', String(this.maxResults));
    url.searchParams.set('tweet.fields', 'created_at,author_id,edit_history_tweet_ids');
    // Replies are kept deliberately: many reset announcements are replies to
    // others or later posts in a thread. Noise is filtered at classification,
    // not dropped at ingestion. Retweets are still excluded as pure noise.
    url.searchParams.set('exclude', X_TIMELINE_EXCLUDE);
    if (sinceId) url.searchParams.set('since_id', sinceId);
    if (startTime) url.searchParams.set('start_time', new Date(startTime).toISOString());
    if (paginationToken) url.searchParams.set('pagination_token', paginationToken);

    let response = await this.request(url.toString());
    if (response.status === 404 && this.repo) {
      // A deleted/changed user ID is the one case where a fresh resolution is
      // appropriate. Normal runs still use the cached ID.
      const body = await response.text();
      throw new XApiRequestError(
        `timeline user not found: ${body.substring(0, 180)}`,
        response.status,
        parseRateLimit(response.headers),
      );
    }
    if (!response.ok) {
      const body = await response.text();
      throw new XApiRequestError(
        `fetch timeline failed: ${response.status} ${body.substring(0, 180)}`,
        response.status,
        parseRateLimit(response.headers),
      );
    }
    const data = await response.json() as TwitterTimelineResponse;
    if (data.errors?.length && !data.data) throw new Error(data.errors.map(error => error.detail || error.title || 'X API error').join('; '));
    return {
      tweets: data.data ?? [],
      nextToken: data.meta?.next_token ?? null,
      newestId: data.meta?.newest_id ?? null,
      rateLimit: parseRateLimit(response.headers),
    };
  }

  private async request(url: string): Promise<Response> {
    this.httpRequestsUsed++;
    if (new URL(url).pathname.endsWith('/tweets')) this.timelineRequestsUsed++;
    return fetch(url, {
      signal: AbortSignal.timeout(20_000),
      headers: {
        Authorization: `Bearer ${this.bearerToken}`,
        'Content-Type': 'application/json',
      },
    });
  }

  private async normalizeTweet(tweet: TwitterTweet, account: string, fetchedAt: string): Promise<SourcePost> {
    const postId = tweet.id;
    const text = tweet.text;
    return {
      source: X_API_PROVIDER_KEY,
      source_account: account,
      source_post_id: postId,
      source_url: `https://x.com/${account}/status/${postId}`,
      text,
      published_at: tweet.created_at ? new Date(tweet.created_at).toISOString() : null,
      fetched_at: fetchedAt,
      raw_json: JSON.stringify(tweet),
      content_hash: await this.computeHash(text, postId),
      classification_pending: true,
      canonical_platform: 'x',
      canonical_post_id: postId,
      source_quality: 'DIRECT',
      first_discovered_via: 'x_api',
      last_verified_via: 'x_api',
      verified_at: fetchedAt,
      indexed_at: null,
      verification_status: 'DIRECT_VERIFIED',
    };
  }

  private async computeHash(text: string, postId: string): Promise<string> {
    const data = new TextEncoder().encode(text + postId);
    const buffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buffer)).map(byte => byte.toString(16).padStart(2, '0')).join('');
  }
}

function compareSnowflakeIds(a: string, b: string): number {
  if (a.length !== b.length) return b.length - a.length;
  return b.localeCompare(a);
}

interface IncrementalTimeline {
  tweets: TwitterTweet[];
  newestId: string | null;
  complete: boolean;
  rateLimit: XApiRateLimit;
  pagesFetched: number;
}

function emptyRateLimit(): XApiRateLimit {
  return { limit: null, remaining: null, resetAt: null };
}

function parseRateLimit(headers: Headers): XApiRateLimit {
  const limit = parseIntegerHeader(headers.get('x-rate-limit-limit'));
  const remaining = parseIntegerHeader(headers.get('x-rate-limit-remaining'));
  const resetSeconds = parseIntegerHeader(headers.get('x-rate-limit-reset'));
  return {
    limit,
    remaining,
    resetAt: resetSeconds === null ? null : new Date(resetSeconds * 1000).toISOString(),
  };
}

function parseIntegerHeader(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function mergeRateLimits(current: XApiRateLimit, incoming: XApiRateLimit): XApiRateLimit {
  return {
    limit: incoming.limit ?? current.limit,
    remaining: incoming.remaining ?? current.remaining,
    resetAt: incoming.resetAt ?? current.resetAt,
  };
}

function rateLimitFromError(error: unknown): XApiRateLimit {
  return error instanceof XApiRequestError ? error.rateLimit : emptyRateLimit();
}

function newestPostId(posts: SourcePost[]): string | null {
  return posts.map(post => post.source_post_id).sort(compareSnowflakeIds)[0] ?? null;
}
