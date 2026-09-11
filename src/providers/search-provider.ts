// ============================================================
// Tibo Monitor - Web Search discovery provider
// ============================================================
//
// The provider supports, in order of preference: Tavily's Search API
// (free monthly credits, no card required), Brave's Web Search API, and a
// Google Custom Search JSON API compatibility path for existing customers
// (that API is closed to new customers and scheduled for discontinuation).
// It deliberately does not call a social mirror or scrape HTML: a search hit
// is indexed evidence only.
//
import type { Env, SourcePost } from '../types';
import type { SearchQuery, SearchResult, SocialSourceProvider, WebSearchProvider } from './types';
import { Repository } from '../db/repository';
import { beijingDateParts, providerUsageDate } from '../utils/schedule';
import { getWebSearchDailyLimit, getWebSearchActiveModeDailyLimit, getWebSearchSupplementDailyLimit, getWebSearchIntervalHours } from '../utils/search-schedule';
import type { WebSearchMode } from '../utils/search-schedule';

const MAX_DEFAULT_RESULTS = 10;
const X_EPOCH_MS = 1288834974657n;
export const WEB_SEARCH_PROVIDER_KEY = 'web_search';
/**
 * The reply-supplement channel reserves on its own small daily pool so quiet
 * NORMAL periods cannot consume the discovery budget (see search-schedule.ts).
 */
export const WEB_SEARCH_SUPPLEMENT_PROVIDER_KEY = 'web_search_supplement';
export { DEFAULT_WEB_SEARCH_DAILY_LIMIT, getWebSearchDailyLimit } from '../utils/search-schedule';

interface GoogleSearchItem {
    title?: string;
    link?: string;
    snippet?: string;
    pagemap?: {
      metatags?: Array<Record<string, string>>;
    };
}

interface GoogleSearchResponse {
  items?: GoogleSearchItem[];
  error?: { code?: number; message?: string };
}

interface BraveSearchResponse {
  web?: {
    results?: Array<{
      title?: string;
      url?: string;
      description?: string;
      page_age?: string;
      profile?: { long_name?: string; name?: string };
    }>;
  };
  query?: { more_results_available?: boolean };
}

interface TavilySearchResponse {
  results?: Array<{
    title?: string;
    url?: string;
    content?: string;
    published_date?: string;
  }>;
}

export class ProviderBudgetExceededError extends Error {
  readonly provider = WEB_SEARCH_PROVIDER_KEY;
  constructor(message = 'Web search daily budget exhausted') {
    super(message);
    this.name = 'ProviderBudgetExceededError';
  }
}

export function canUseSearchProvider(env: Env): boolean {
  return env.WEB_SEARCH_ENABLED !== 'false'
    && (
      !!env.TAVILY_API_KEY?.trim()
      || !!env.BRAVE_SEARCH_API_KEY?.trim()
      || (!!env.GOOGLE_API_KEY?.trim() && !!env.GOOGLE_CSE_ID?.trim())
    );
}

export function monitoredAccounts(env: Env): string[] {
  return (env.MONITORED_ACCOUNTS || 'thsottiaux')
    .split(',')
    .map(account => account.trim().toLowerCase())
    .filter(Boolean);
}

/** Compatibility helper for older callers; adaptive Cron uses one query per cycle. */
export function getDiscoveryQueries(accounts: string[], now: Date = new Date(), queriesPerRound = 1): SearchQuery[] {
  const safeAccounts = accounts.length > 0 ? accounts : ['thsottiaux'];
  const templates: Array<{ q: string; account?: string }> = [
    ...safeAccounts.flatMap(account => [
      { q: `site:x.com/${account}/status codex`, account },
      { q: `site:x.com/${account}/status (reset OR usage OR limit)`, account },
      { q: `"${account}" codex reset`, account },
    ]),
    { q: '"Tibo" "Codex" ("rate limit" OR quota)' },
  ];
  const hour = beijingDateParts(now).hour;
  const offset = (hour * queriesPerRound) % templates.length;
  const selected: SearchQuery[] = [];
  for (let i = 0; i < Math.min(queriesPerRound, templates.length); i++) {
    const item = templates[(offset + i) % templates.length];
    if (!selected.some(query => query.q === item.q)) {
      selected.push({ q: item.q, purpose: 'discovery', account: item.account, maxResults: MAX_DEFAULT_RESULTS });
    }
  }
  return selected;
}

function rotatingQuery(
  templates: Array<{ q: string; account?: string }>,
  now: Date,
  purpose: SearchQuery['purpose'],
  cycleHours = 1,
): SearchQuery[] {
  if (templates.length === 0) return [];
  // Rotate by search cycle, not by wall-clock hour. NORMAL mode runs every
  // four hours by default; using the raw hour would skip or repeat templates
  // when the interval changes.
  const safeCycleHours = Math.max(1, Math.floor(cycleHours));
  const cycleIndex = Math.floor(beijingDateParts(now).hour / safeCycleHours);
  const index = cycleIndex % templates.length;
  const item = templates[index];
  return [{ q: item.q, purpose, account: item.account, maxResults: MAX_DEFAULT_RESULTS }];
}

/** The adaptive planner returns one real API query per cycle by default. */
export function getAdaptiveSearchQueries(
  accounts: string[],
  now: Date,
  mode: WebSearchMode,
  intervalHours = 1,
): SearchQuery[] {
  if (mode === 'CONFIRMING_RESET') return getConfirmationQueries(now);
  const safeAccounts = (accounts.length > 0 ? accounts : ['thsottiaux'])
    .map(account => account.toLowerCase());

  // There is only one request in the normal search budget. Rotating a single
  // account across several narrow templates meant that each template was
  // revisited only every few hours, exactly when a fresh post mattered most.
  // Keep the production one-account path broad and stable so every search
  // cycle can see a newly indexed Codex/reset/limit post.
  if (safeAccounts.length === 1) {
    const account = safeAccounts[0];
    const keywords = mode === 'WATCHING_RESET'
      ? '(reset OR Codex OR usage OR limit OR quota OR "rate limit")'
      : '(Codex OR reset OR usage OR limit OR quota OR "rate limit")';
    return [{
      q: `site:x.com/${account}/status ${keywords}`,
      purpose: 'discovery',
      account,
      maxResults: MAX_DEFAULT_RESULTS,
    }];
  }

  if (mode === 'WATCHING_RESET') {
    return rotatingQuery(safeAccounts.flatMap(account => [
      { q: `site:x.com/${account}/status reset Codex`, account },
      { q: `"${account}" Codex reset`, account },
      { q: `site:x.com/${account}/status clarification Codex`, account },
    ]), now, 'discovery', intervalHours);
  }
  return rotatingQuery([
    ...safeAccounts.flatMap(account => [
      { q: `site:x.com/${account}/status Codex`, account },
      { q: `"${account}" Codex reset usage limit`, account },
    ]),
    // This is a shared query; adding it once avoids duplicate slots when
    // MONITORED_ACCOUNTS contains more than one account.
    { q: '"Tibo" "Codex" "rate limit"' },
  ], now, 'discovery', intervalHours);
}

export function getConfirmationQueries(now: Date = new Date()): SearchQuery[] {
  const templates = [
    'Codex reset usage restored today',
    'Codex quota reset',
    'Codex limit reset Tibo',
    'site:reddit.com Codex usage reset',
    'site:x.com Codex reset usage restored',
  ];
  const offset = beijingDateParts(now).hour % templates.length;
  return [{ q: templates[offset], purpose: 'confirmation', maxResults: MAX_DEFAULT_RESULTS }];
}

/**
 * Reply/thread-tail discovery queries for the supplemental search channel.
 * Web search engines do not honor X's native `from:`/`filter:replies`
 * operators, so these stay host-scoped and rotate between a broad keyword set
 * and a few narrow phrasings that replies are most likely to contain.
 */
export function getReplySupplementQueries(accounts: string[], now: Date = new Date()): SearchQuery[] {
  const safeAccounts = (accounts.length > 0 ? accounts : ['thsottiaux'])
    .map(account => account.toLowerCase());
  const templates: Array<{ q: string; account?: string }> = safeAccounts.flatMap(account => [
    { q: `site:x.com/${account}/status reset`, account },
    { q: `site:x.com/${account}/status (reset OR restored OR "limit" OR "quota")`, account },
    { q: `"${account}" "reset" ("everyone" OR "all users" OR "done")`, account },
  ]);
  const offset = beijingDateParts(now).hour % Math.max(1, templates.length);
  const item = templates[offset];
  return [{
    q: item.q,
    purpose: 'reply_supplement',
    account: item.account,
    maxResults: MAX_DEFAULT_RESULTS,
  }];
}

/** Strictly validate that a result is a status from the monitored account. */
export function extractCanonicalXPost(url: string, account: string): { platform: 'x'; postId: string; canonicalUrl: string } | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host !== 'x.com' && host !== 'twitter.com' && host !== 'www.x.com' && host !== 'www.twitter.com') return null;
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length < 3 || parts[1].toLowerCase() !== 'status') return null;
    if (parts[0].toLowerCase() !== account.toLowerCase()) return null;
    const postId = parts[2];
    if (!/^\d{5,30}$/.test(postId)) return null;
    return { platform: 'x', postId, canonicalUrl: `https://x.com/${account.toLowerCase()}/status/${postId}` };
  } catch {
    return null;
  }
}

function parsePublishedTime(item: GoogleSearchItem): string | null {
  const metatags = item.pagemap?.metatags ?? [];
  for (const tags of metatags) {
    const candidate = tags['article:published_time'] || tags['og:published_time'];
    if (!candidate) continue;
    const date = new Date(candidate);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return null;
}

/**
 * X status IDs are Snowflake IDs whose high bits encode the post creation
 * time. This is safer than trusting a search provider's page age or snippet
 * metadata, while still letting indexed X posts participate in real-time
 * ordering before an X API verification arrives.
 */
export function getXPostPublishedAt(postId: string): string | null {
  if (!/^\d{5,30}$/.test(postId)) return null;
  try {
    const timestampMs = Number((BigInt(postId) >> 22n) + X_EPOCH_MS);
    if (!Number.isSafeInteger(timestampMs)) return null;
    const date = new Date(timestampMs);
    const year = date.getUTCFullYear();
    if (Number.isNaN(date.getTime()) || year < 2010 || year > 2100) return null;
    return date.toISOString();
  } catch {
    return null;
  }
}

export function normalizeDiscoveryResult(result: SearchResult, account: string, fetchedAt: string): SourcePost | null {
  const canonical = extractCanonicalXPost(result.url, account);
  if (!canonical) return null;
  const text = [result.title, result.snippet].filter(Boolean).join('\n').trim();
  if (!text) return null;
  const publishedAt = getXPostPublishedAt(canonical.postId);
  return {
    source: WEB_SEARCH_PROVIDER_KEY,
    source_account: account,
    source_post_id: canonical.postId,
    source_url: canonical.canonicalUrl,
    text,
    published_at: publishedAt,
    fetched_at: fetchedAt,
    raw_json: JSON.stringify(result.raw ?? result),
    content_hash: contentHash(text, canonical.postId),
    classification_pending: true,
    canonical_platform: canonical.platform,
    canonical_post_id: canonical.postId,
    source_quality: 'INDEXED',
    first_discovered_via: 'web_search',
    last_verified_via: null,
    verified_at: null,
    indexed_at: result.indexedAt ?? fetchedAt,
    verification_status: 'INDEXED_ONLY',
  };
}

export function normalizeDiscoveryResults(results: SearchResult[], accounts: string[], fetchedAt: string): SourcePost[] {
  const posts: SourcePost[] = [];
  const seen = new Set<string>();
  for (const result of results) {
    for (const account of accounts) {
      const post = normalizeDiscoveryResult(result, account, fetchedAt);
      if (!post || !post.canonical_post_id || seen.has(post.canonical_post_id)) continue;
      seen.add(post.canonical_post_id);
      posts.push(post);
      break;
    }
  }
  return posts;
}

/** Web/Social search implementation with a persistent daily request cap. */
export class SearchProvider implements WebSearchProvider, SocialSourceProvider {
  readonly name: string;
  private readonly apiKey: string;
  private readonly cseId: string | null;
  private readonly braveApiKey: string | null;
  private readonly tavilyApiKey: string | null;
  private readonly repo?: Repository;
  private readonly env: Env;

  constructor(env: Env, repo?: Repository) {
    if (!canUseSearchProvider(env)) throw new Error('TAVILY_API_KEY, BRAVE_SEARCH_API_KEY or GOOGLE_API_KEY/GOOGLE_CSE_ID is required for SearchProvider');
    this.env = env;
    this.tavilyApiKey = env.TAVILY_API_KEY?.trim() || null;
    this.braveApiKey = env.BRAVE_SEARCH_API_KEY?.trim() || null;
    this.apiKey = env.GOOGLE_API_KEY?.trim() || '';
    this.cseId = env.GOOGLE_CSE_ID?.trim() || null;
    this.name = this.tavilyApiKey ? 'tavily-search' : (this.braveApiKey ? 'brave-search' : 'google-search');
    this.repo = repo;
  }

  async search(query: SearchQuery, now = new Date()): Promise<SearchResult[]> {
    const requestedAt = now.toISOString();
    const usageDate = providerUsageDate(now);
    const slot = `${usageDate}@${query.purpose}:${query.q}`;
    if (this.repo) {
      // Purpose-routed pools: reply-supplement searches draw on their own small
      // daily pool; discovery/confirmation draw on the discovery pool. The
      // provider reservation is a second hard guard and must accept the larger
      // active-mode pool, otherwise an admitted active-mode search would be
      // rejected here before any HTTP request.
      const isSupplement = query.purpose === 'reply_supplement';
      const poolKey = isSupplement ? WEB_SEARCH_SUPPLEMENT_PROVIDER_KEY : WEB_SEARCH_PROVIDER_KEY;
      const hardLimit = isSupplement
        ? getWebSearchSupplementDailyLimit(this.env)
        : Math.max(
          getWebSearchDailyLimit(this.env),
          getWebSearchActiveModeDailyLimit(this.env),
        );
      const reserved = await this.repo.reserveProviderUsage(poolKey, usageDate, hardLimit, requestedAt, slot);
      if (!reserved) throw new ProviderBudgetExceededError();
    }

    let response: Response;
    let results: SearchResult[];
    if (this.tavilyApiKey) {
      response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.tavilyApiKey}`,
        },
        body: JSON.stringify({
          query: query.q,
          search_depth: 'basic',
          max_results: Math.max(1, Math.min(10, query.maxResults ?? MAX_DEFAULT_RESULTS)),
          topic: 'general',
          include_answer: false,
        }),
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Tavily Search API error: ${response.status} ${body.substring(0, 200)}`);
      }
      const data = await response.json() as TavilySearchResponse;
      results = (data.results ?? []).flatMap(item => {
        if (!item.url) return [];
        const publishedAt = item.published_date ? new Date(item.published_date) : null;
        return [{
          title: item.title ?? '',
          snippet: item.content ?? '',
          url: item.url,
          indexedAt: null,
          // Tavily's published_date is provider-reported page metadata. It is
          // never used as the X post's published_at by normalizeDiscoveryResult.
          publishedAt: publishedAt && !Number.isNaN(publishedAt.getTime()) ? publishedAt.toISOString() : null,
          domain: safeHostname(item.url),
          raw: item,
        } satisfies SearchResult];
      });
    } else if (this.braveApiKey) {
      const url = new URL('https://api.search.brave.com/res/v1/web/search');
      url.searchParams.set('q', query.q);
      url.searchParams.set('count', String(Math.max(1, Math.min(20, query.maxResults ?? MAX_DEFAULT_RESULTS))));
      url.searchParams.set('search_lang', 'en');
      url.searchParams.set('result_filter', 'web');
      response = await fetch(url.toString(), {
        headers: {
          Accept: 'application/json',
          'X-Subscription-Token': this.braveApiKey,
        },
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Brave Search API error: ${response.status} ${body.substring(0, 200)}`);
      }
      const data = await response.json() as BraveSearchResponse;
      results = (data.web?.results ?? []).flatMap(item => {
        if (!item.url) return [];
        const pageAge = item.page_age ? new Date(item.page_age) : null;
        return [{
          title: item.title ?? '',
          snippet: item.description ?? '',
          url: item.url,
          indexedAt: null,
          // Brave's page_age is provider-reported page metadata. It is never
          // used as the X post's published_at by normalizeDiscoveryResult.
          publishedAt: pageAge && !Number.isNaN(pageAge.getTime()) ? pageAge.toISOString() : null,
          domain: safeHostname(item.url),
          raw: item,
        } satisfies SearchResult];
      });
    } else {
      const url = new URL('https://www.googleapis.com/customsearch/v1');
      url.searchParams.set('key', this.apiKey);
      url.searchParams.set('cx', this.cseId!);
      url.searchParams.set('q', query.q);
      url.searchParams.set('num', String(Math.max(1, Math.min(10, query.maxResults ?? MAX_DEFAULT_RESULTS))));
      url.searchParams.set('sort', 'date');
      response = await fetch(url.toString());
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Google Search API error: ${response.status} ${body.substring(0, 200)}`);
      }
      const data = await response.json() as GoogleSearchResponse;
      if (data.error) throw new Error(`Google Search API error: ${data.error.message || data.error.code || 'unknown error'}`);
      results = (data.items ?? []).flatMap(item => {
        if (!item.link) return [];
        return [{
          title: item.title ?? '',
          snippet: item.snippet ?? '',
          url: item.link,
          indexedAt: null,
          publishedAt: parsePublishedTime(item),
          domain: safeHostname(item.link),
          raw: item,
        } satisfies SearchResult];
      });
    }
    if (this.repo) await this.repo.recordProviderUsageSuccess(WEB_SEARCH_PROVIDER_KEY, usageDate, requestedAt);
    return results;
  }

  /** Compatibility adapter for older callers; Cron uses search() directly. */
  async fetchLatestPosts(): Promise<SourcePost[]> {
    return this.discoverPosts(new Date());
  }

  async discoverPosts(now: Date = new Date()): Promise<SourcePost[]> {
    const accounts = monitoredAccounts(this.env);
    const results: SearchResult[] = [];
    const intervalHours = getWebSearchIntervalHours('NORMAL', this.env);
    for (const query of getAdaptiveSearchQueries(accounts, now, 'NORMAL', intervalHours)) {
      results.push(...await this.search(query, now));
    }
    return normalizeDiscoveryResults(results, accounts, now.toISOString());
  }
}

function safeHostname(url: string): string | undefined {
  try { return new URL(url).hostname.toLowerCase(); } catch { return undefined; }
}

function contentHash(text: string, postId: string): string {
  let hash = 2166136261;
  for (const char of `${text}${postId}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
