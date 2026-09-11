// ============================================================
// Codex Usage Monitor - Cloudflare Worker Entry Point
// Includes SSR for SEO, dynamic sitemap, and API noindex
// ============================================================
import { Hono } from 'hono';
import type { Env, MonitorEvent } from './types';
import { CLASSIFICATION_REASON_CODES } from './types';
import api from './routes/api';
import { resolveReview, ReviewError } from './review';
import { backfillHistoricalXTimeline, executeCron, probeXIngestionCompleteness } from './cron';
import { backfillMonitorEventTranslations } from './event-translations';
import { Repository } from './db/repository';
import { CommunityRepository } from './community/repository';
import { getCommunityConfig } from './community/config';
import { readCommunityFilters } from './community/filters';
import { handleTelegramWebhook } from './telegram';
import { toPublicManualResetReport } from './manual-reset';
import { canUseXApi, XApiProvider } from './providers/x-api';
import { SearchProvider, canUseSearchProvider, monitoredAccounts, WEB_SEARCH_PROVIDER_KEY } from './providers/search-provider';
import type { WebSearchProvider } from './providers/types';
import { LLMClassifier, missingClassifierConfiguration } from './classifier/llm';
import type { ClassificationProvider, ClassificationOutcome } from './types';
import { isXApiAutomaticSyncEnabled } from './utils/schedule';
import { isEventIndexEligible } from './utils/index-policy';
import { effectiveManualResetReport } from './utils/reset-source';
import { localeFromPath, SITE_LOCALES, type SiteLocale } from './i18n';
import { isVersionedStaticAsset } from './assets';
import { GambitRepository } from './open-gambit/repository';
import { runGambitDiscovery } from './open-gambit/service';
import { renderAiDisclosurePage, renderOpenGambitAdminPage, renderOpenGambitArticle, renderOpenGambitLanding } from './open-gambit/renderer';
import { OpenGambitAnalysisWorkflow } from './open-gambit/workflow-entrypoint';
import type { GambitPublicArticle } from './open-gambit/types';
import { AI_DISCLOSURE_PATHS, OPEN_GAMBIT_PATHS, RSS_PATHS } from './site-shell';
import {
  renderHomepage,
  renderEventPage,
  renderLandingPage,
  renderCommunityPage,
  renderAdminCommunityPage,
  render404,
  renderRssFeed,
  renderSitemap,
  type LandingPageKey,
  type SiteIntegrations,
  type SitemapLandingPage,
  type GambitSitemapArticle,
} from './renderer';

const app = new Hono<{ Bindings: Env }>();

const RESET_HISTORY_CATEGORIES = ['RESET_PLANNED', 'RESET_COMPLETED', 'RESET_TIME_CHANGED'];
const RATE_LIMIT_CATEGORIES = ['POLICY_CHANGE', 'RESET_TIME_CHANGED'];

// Baseline browser hardening shared by HTML, API, and static asset responses.
// The site currently uses inline JSON-LD/bootstrap scripts and third-party
// fonts/analytics, so CSP is intentionally left to a separate audited change.
app.use('*', async (c, next) => {
  await next();
  c.res.headers.set('X-Content-Type-Options', 'nosniff');
  c.res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.res.headers.set('X-Frame-Options', 'DENY');
  c.res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
});

function siteIntegrations(env: Env): SiteIntegrations {
  return {
    siteUrl: env.SITE_URL,
    googleAnalyticsId: env.GOOGLE_ANALYTICS_ID,
    googleSiteVerification: env.GOOGLE_SITE_VERIFICATION,
  };
}

async function getAllEvents(repo: Repository, options: { categories?: string[] } = {}): Promise<MonitorEvent[]> {
  const all: MonitorEvent[] = [];
  let cursor: { sortValue: string; id: number } | null = null;
  let pageCount = 0;
  do {
    const page = await repo.getEvents({ limit: 100, cursor, categories: options.categories });
    all.push(...page.data);
    cursor = page.nextCursor ? Repository.decodeEventCursor(page.nextCursor) : null;
    pageCount += 1;
  } while (cursor && pageCount < 500);
  return all;
}

async function getPageFreshness(repo: Repository, env: Env): Promise<{
  lastCheckedAt: string | null;
  sourceLastFetchedAt: string | null;
  sourceLastNewPostAt: string | null;
  sourceMode: 'x_direct' | 'web_indexed' | null;
}> {
  const directEnabled = canUseXApi(env) && isXApiAutomaticSyncEnabled(env);
  const indexedEnabled = canUseSearchProvider(env);
  const [successfulRun, xLastSuccessAt, xLastNewPostAt, webLastSuccessAt] = await Promise.all([
    repo.getLatestSuccessfulRun(),
    repo.getSetting('x_api_last_success_at'),
    repo.getSetting('x_api_last_new_post_at'),
    repo.getSetting('web_search_last_success'),
  ]);
  return {
    lastCheckedAt: successfulRun?.finished_at ?? null,
    sourceLastFetchedAt: directEnabled ? xLastSuccessAt : webLastSuccessAt,
    sourceLastNewPostAt: directEnabled ? xLastNewPostAt : null,
    sourceMode: directEnabled ? 'x_direct' : indexedEnabled ? 'web_indexed' : null,
  };
}

async function buildLandingResponse(env: Env, page: LandingPageKey, lang: SiteLocale): Promise<Response> {
  const repo = new Repository(env.DB);
  const freshness = await getPageFreshness(repo, env);
  let events: MonitorEvent[] = [];
  if (page === 'latest') {
    events = (await repo.getEvents({ limit: 5 })).data;
  } else if (page === 'reset-history') {
    events = await getAllEvents(repo, { categories: RESET_HISTORY_CATEGORIES });
  } else if (page === 'rate-limit-updates') {
    events = await getAllEvents(repo, { categories: RATE_LIMIT_CATEGORIES });
  }
  const html = renderLandingPage({
    page,
    events,
    latestEvent: events[0] ?? null,
    ...freshness,
  }, lang, siteIntegrations(env));
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=60',
    },
  });
}

async function buildCommunityResponse(env: Env, lang: SiteLocale, url: URL): Promise<Response> {
  const config = getCommunityConfig(env);
  const repository = new CommunityRepository(env.DB);
  const { filters } = readCommunityFilters(url);
  let data;
  try {
    const result = await repository.getPublicPosts({ limit: 20, cursor: null, filters });
    data = {
      posts: result.data,
      nextCursor: result.nextCursor,
      total: result.total,
      postingEnabled: config.postingEnabled,
      turnstileSiteKey: config.postingEnabled ? config.turnstileSiteKey : null,
      maxNicknameLength: config.maxNicknameLength,
      maxContentLength: config.maxContentLength,
      filters,
    };
  } catch (error) {
    console.error('[SSR Community] feed_failed', { error: error instanceof Error ? error.message.slice(0, 160) : 'unknown' });
    data = {
      posts: [],
      nextCursor: null,
      total: 0,
      postingEnabled: config.postingEnabled,
      turnstileSiteKey: config.postingEnabled ? config.turnstileSiteKey : null,
      maxNicknameLength: config.maxNicknameLength,
      maxContentLength: config.maxContentLength,
      filters,
      feedError: true,
    };
  }
  const html = renderCommunityPage(data, lang, siteIntegrations(env));
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=0, s-maxage=30, stale-while-revalidate=60',
    },
  });
}

async function getPublishedGambits(env: Env, limit = 10): Promise<GambitPublicArticle[]> {
  try {
    return await new GambitRepository(env.DB).listPublished(limit);
  } catch (error) {
    // The existing Tibo site remains available before the additive Gambit
    // migration is applied locally or in staging.
    console.error('[Open Gambit] public_read_unavailable', { error: error instanceof Error ? error.message.slice(0, 160) : 'unknown' });
    return [];
  }
}

async function buildOpenGambitLandingResponse(env: Env, lang: SiteLocale): Promise<Response> {
  const html = renderOpenGambitLanding(await getPublishedGambits(env, 10), lang, env.SITE_URL);
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=60',
    },
  });
}

async function buildOpenGambitArticleResponse(env: Env, slug: string, lang: SiteLocale): Promise<Response> {
  if (!/^[a-z0-9][a-z0-9-]{0,95}$/u.test(slug)) {
    return new Response(render404(lang, siteIntegrations(env)), { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
  try {
    const article = await new GambitRepository(env.DB).getArticleBySlug(slug);
    if (!article || article.status !== 'PUBLISHED' || article.politicalTopic) {
      return new Response(render404(lang, siteIntegrations(env)), { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
    return new Response(renderOpenGambitArticle(article, lang, env.SITE_URL), {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=60',
      },
    });
  } catch (error) {
    console.error('[Open Gambit] article_read_failed', { error: error instanceof Error ? error.message.slice(0, 160) : 'unknown' });
    return new Response(render404(lang, siteIntegrations(env)), { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}

function buildAiDisclosureResponse(env: Env, lang: SiteLocale): Response {
  return new Response(renderAiDisclosurePage(lang, env.SITE_URL), {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  });
}

// ── Old Domain Redirect Middleware ──
// codex.modelyard.dev -> tibo.modelyard.dev for browser routes
app.use('/*', async (c, next) => {
  const host = c.req.header('host') || '';
  if (host === 'codex.modelyard.dev' || host === 'codex.modelyard.pages.dev') {
    const url = new URL(c.req.url);
    // API routes: pass through (don't redirect)
    if (!url.pathname.startsWith('/api/')) {
      // Browser routes: 301 redirect with no-cache
      url.host = 'tibo.modelyard.dev';
      return c.redirect(url.toString(), 301);
    }
    // For API routes from old domain, allow through with cache bypass
    c.header('Cache-Control', 'no-store, no-cache, must-revalidate');
  }
  await next();
});

// ── API Routes (with noindex header) ──
app.use('/api/*', async (c, next) => {
  await next();
  c.res.headers.set('X-Robots-Tag', 'noindex, nofollow');
});

app.route('/api', api);

// ── Cron Trigger ──
app.post('/__cron/trigger', async (c) => {
  const secret = c.env.CRON_SECRET;
  if (!secret) {
    return c.json({ error: 'Cron trigger not configured - set CRON_SECRET env var' }, 503);
  }
  const providedSecret = c.req.header('Authorization')?.replace(/^Bearer /, '') || c.req.query('secret') || (c.req.header('Content-Type')?.includes('form') ? (await c.req.formData()).get('secret') : null);
  if (providedSecret !== secret) {
    return c.json({ error: 'Unauthorized - invalid or missing secret' }, 401);
  }
  return handleCron(c.env);
});

// ── One-shot X historical backfill ──
// Re-fetches the recent X timeline window without the stored since_id cursor so
// posts that predate the reply-retention fix can be ingested. The cursor is
// never advanced and ingestion goes through the normal dedup/upgrade path; new
// posts enter the classifier queue as classification_pending. Like the cron
// trigger, it is gated by CRON_SECRET. Budget metering: the whole run counts
// as one X daily reservation (up to `maxPages` HTTP page requests under it);
// a `since` bound older than the default 14-day lookback is refused unless
// force=true. Running it against production is a production mutation and
// requires explicit operator authorization (AGENTS.md).
app.post('/__cron/backfill-x', async (c) => {
  const secret = c.env.CRON_SECRET;
  if (!secret) {
    return c.json({ error: 'Cron trigger not configured - set CRON_SECRET env var' }, 503);
  }
  const providedSecret = c.req.header('Authorization')?.replace(/^Bearer /, '') || c.req.query('secret') || (c.req.header('Content-Type')?.includes('form') ? (await c.req.formData()).get('secret') : null);
  if (providedSecret !== secret) {
    return c.json({ error: 'Unauthorized - invalid or missing secret' }, 401);
  }
  const sinceId = c.req.query('since')?.trim() || undefined;
  const maxPages = Number(c.req.query('maxPages'));
  const force = c.req.query('force') === 'true' || c.req.query('force') === '1';
  try {
    const result = await backfillHistoricalXTimeline(c.env, {
      sinceId,
      maxPages: Number.isFinite(maxPages) && maxPages > 0 ? maxPages : undefined,
      force,
    });
    return c.json({ ok: result.errors.length === 0, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ ok: false, error: message }, 500);
  }
});

// ── Ingestion-completeness probe (manual trigger) ──
// Runs the read-only timeline-vs-stored comparison once (respecting the same
// gates as the scheduled path unless force=true bypasses the interval gates;
// the probe must still be enabled via X_INGESTION_PROBE_ENABLED). Consumes one
// X reservation, never writes source_posts, never advances any cursor.
app.post('/__cron/x-ingestion-probe', async (c) => {
  const secret = c.env.CRON_SECRET;
  if (!secret) {
    return c.json({ error: 'Cron trigger not configured - set CRON_SECRET env var' }, 503);
  }
  const providedSecret = c.req.header('Authorization')?.replace(/^Bearer /, '') || c.req.query('secret') || (c.req.header('Content-Type')?.includes('form') ? (await c.req.formData()).get('secret') : null);
  if (providedSecret !== secret) {
    return c.json({ error: 'Unauthorized - invalid or missing secret' }, 401);
  }
  const force = c.req.query('force') === 'true' || c.req.query('force') === '1';
  try {
    const result = await probeXIngestionCompleteness(c.env, { force });
    return c.json({ ok: result.probeRun, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ ok: false, error: message }, 500);
  }
});

// ── NEEDS_REVIEW adjudication backlog ──
// Operator-facing queue of trusted direct posts that read like a completed
// Codex reset but lacked the explicit Codex anchor. They are never public
// events; this endpoint only lists them for manual adjudication.
app.get('/__cron/review-queue', async (c) => {
  c.header('Cache-Control', 'no-store');
  const secret = c.env.CRON_SECRET;
  if (!secret) {
    return c.json({ error: 'Cron trigger not configured - set CRON_SECRET env var' }, 503);
  }
  const providedSecret = c.req.header('Authorization')?.replace(/^Bearer /, '') || c.req.query('secret') || (c.req.header('Content-Type')?.includes('form') ? (await c.req.formData()).get('secret') : null);
  if (providedSecret !== secret) {
    return c.json({ error: 'Unauthorized - invalid or missing secret' }, 401);
  }
  try {
    const repo = new Repository(c.env.DB);
    const limit = Math.max(1, Math.min(200, Number(c.req.query('limit')) || 50));
    const posts = await repo.getPostsNeedingReview(limit);
    return c.json({
      ok: true,
      count: posts.length,
      queue: await repo.getReviewQueueStats(),
      alert: await repo.getSetting('review_queue_alert'),
      posts: posts.map(post => ({
        id: post.id,
        source_account: post.source_account,
        source_post_id: post.source_post_id,
        source_url: post.source_url,
        published_at: post.published_at,
        fetched_at: post.fetched_at,
        text: post.text,
        classification_label: post.classification_label,
        classification_source_context: post.classification_source_context,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ ok: false, error: message }, 500);
  }
});

app.get('/__cron/rejection-samples', async (c) => {
  c.header('Cache-Control', 'no-store');
  if (!c.env.CRON_SECRET) return c.json({ error: 'NOT_CONFIGURED' }, 503);
  if ((c.req.header('Authorization')?.replace(/^Bearer /, '') || c.req.query('secret')) !== c.env.CRON_SECRET) return c.json({ error: 'UNAUTHORIZED' }, 401);
  const reason = c.req.query('reason') ?? '';
  if (!(CLASSIFICATION_REASON_CODES as readonly string[]).includes(reason)) return c.json({ error: 'INVALID_REASON_CODE' }, 400);
  return c.json({ reason, samples: await new Repository(c.env.DB).getRejectionSamples(reason) });
});

app.post('/__cron/review-resolve', async (c) => {
  c.header('Cache-Control', 'no-store');
  if (!c.env.CRON_SECRET) return c.json({ error: 'NOT_CONFIGURED' }, 503);
  const secret = c.req.header('Authorization')?.replace(/^Bearer /, '') || c.req.query('secret');
  if (secret !== c.env.CRON_SECRET) return c.json({ error: 'UNAUTHORIZED' }, 401);
  if (Number(c.req.header('Content-Length') ?? 0) > 4096) return c.json({ error: 'REQUEST_TOO_LARGE' }, 400);
  let body: unknown;
  try { const text = await c.req.text(); if (text.length > 4096) return c.json({ error: 'REQUEST_TOO_LARGE' }, 400); body = JSON.parse(text); }
  catch { return c.json({ error: 'INVALID_JSON' }, 400); }
  try { return c.json({ ok: true, ...await resolveReview(new Repository(c.env.DB), { classify: post => new LLMClassifier(c.env).classify(post) }, body) }); }
  catch (error) { return error instanceof ReviewError ? c.json({ error: error.code }, error.status) : c.json({ error: 'REVIEW_RESOLVE_FAILED' }, 500); }
});

// ── Telegram operator webhook ──
// This endpoint only accepts updates signed with the configured Telegram
// webhook secret and then applies the single-user whitelist in telegram.ts.
// It never invokes X API or the classifier.
app.post('/telegram/webhook', async (c) => handleTelegramWebhook(c.req.raw, c.env));

// Add noindex to __cron routes
app.use('/__cron/*', async (c, next) => {
  await next();
  c.res.headers.set('X-Robots-Tag', 'noindex, nofollow');
});

// ── Dynamic Sitemap ──
app.get('/sitemap.xml', async (c) => {
  try {
    const repo = new Repository(c.env.DB);
    const [events, freshness, gambitArticles] = await Promise.all([
      getAllEvents(repo),
      getPageFreshness(repo, c.env),
      getPublishedGambits(c.env, 100),
    ]);
    const latestEvent = events[0];
    const lastmod = latestEvent
      ? (latestEvent.updated_at || latestEvent.created_at || null)
      : freshness.lastCheckedAt;
    const landingPages: SitemapLandingPage[] = [
      // /latest/ renders only the five newest records, so its sitemap
      // eligibility must use the same window as the page itself.
      { page: 'latest', indexable: events.slice(0, 5).some(isEventIndexEligible), lastmod },
      { page: 'reset-history', indexable: events.some(event => RESET_HISTORY_CATEGORIES.includes(event.category) && isEventIndexEligible(event)), lastmod },
      { page: 'rate-limit-updates', indexable: events.some(event => RATE_LIMIT_CATEGORIES.includes(event.category) && isEventIndexEligible(event)), lastmod },
      { page: 'faq', indexable: true, lastmod },
      { page: 'methodology', indexable: true, lastmod },
    ];

    const xml = renderSitemap(events, lastmod, landingPages, gambitArticles.map(article => ({ slug: article.slug, modifiedAt: article.modifiedAt })) as GambitSitemapArticle[], c.env.SITE_URL);
    return c.newResponse(xml, 200, {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Sitemap] Error:', msg);
    return c.env.ASSETS.fetch(new Request('https://fakehost/sitemap.xml'));
  }
});

// ── RSS Feed ──
async function buildRssResponse(env: Env, lang: SiteLocale): Promise<Response> {
  try {
    const repo = new Repository(env.DB);
    const [eventsResult, manualReset, latestDirectReset] = await Promise.all([
      repo.getEvents({ limit: 20 }),
      repo.getLatestManualResetReport(),
      repo.getLatestDirectResetEvent(),
    ]);
    const visibleManualReset = effectiveManualResetReport(manualReset, latestDirectReset);
    return new Response(renderRssFeed(eventsResult.data, lang, toPublicManualResetReport(visibleManualReset), env.SITE_URL), {
      status: 200,
      headers: {
        'Content-Type': 'application/rss+xml; charset=utf-8',
        'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=60',
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[RSS] Error:', msg);
    return new Response(renderRssFeed([], lang, null, env.SITE_URL), {
      status: 500,
      headers: {
        'Content-Type': 'application/rss+xml; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  }
}

app.get(RSS_PATHS.en, (c) => buildRssResponse(c.env, 'en'));
for (const locale of SITE_LOCALES.filter(candidate => candidate !== 'en')) {
  app.get(RSS_PATHS[locale], (c) => buildRssResponse(c.env, locale));
}

// ── Dynamic robots.txt ──
app.get('/robots.txt', async (c) => {
  const robots = [
    'User-agent: OAI-SearchBot',
    'Allow: /',
    'Disallow: /admin/',
    'Disallow: /api/',
    'Disallow: /__cron/',
    'Disallow: /*.json',
    '',
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin/',
    'Disallow: /api/',
    'Disallow: /__cron/',
    'Disallow: /*.json',
    '',
    'Sitemap: ' + (c.env.SITE_URL?.replace(/\/+$/u, '') || 'https://tibo.modelyard.dev') + '/sitemap.xml',
    '',
  ].join('\n');

  return c.newResponse(robots, 200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'public, max-age=86400, s-maxage=86400',
  });
});

// ── Core search landing pages ──
// Keep stable trailing-slash URLs so canonical and hreflang values do not
// depend on the request spelling.
app.get('/latest', (c) => c.redirect('/latest/', 301));
app.get('/reset-history', (c) => c.redirect('/reset-history/', 301));
app.get('/rate-limit-updates', (c) => c.redirect('/rate-limit-updates/', 301));
app.get('/faq', (c) => c.redirect('/faq/', 301));
app.get('/methodology', (c) => c.redirect('/methodology/', 301));
for (const locale of SITE_LOCALES.filter(candidate => candidate !== 'en')) {
  app.get(`/${locale}/latest`, (c) => c.redirect(`/${locale}/latest/`, 301));
  app.get(`/${locale}/reset-history`, (c) => c.redirect(`/${locale}/reset-history/`, 301));
  app.get(`/${locale}/rate-limit-updates`, (c) => c.redirect(`/${locale}/rate-limit-updates/`, 301));
  app.get(`/${locale}/faq`, (c) => c.redirect(`/${locale}/faq/`, 301));
  app.get(`/${locale}/methodology`, (c) => c.redirect(`/${locale}/methodology/`, 301));
}

app.get('/latest/', (c) => buildLandingResponse(c.env, 'latest', 'en'));
app.get('/reset-history/', (c) => buildLandingResponse(c.env, 'reset-history', 'en'));
app.get('/rate-limit-updates/', (c) => buildLandingResponse(c.env, 'rate-limit-updates', 'en'));
app.get('/faq/', (c) => buildLandingResponse(c.env, 'faq', 'en'));
app.get('/methodology/', (c) => buildLandingResponse(c.env, 'methodology', 'en'));
for (const locale of SITE_LOCALES.filter(candidate => candidate !== 'en')) {
  app.get(`/${locale}/latest/`, (c) => buildLandingResponse(c.env, 'latest', locale));
  app.get(`/${locale}/reset-history/`, (c) => buildLandingResponse(c.env, 'reset-history', locale));
  app.get(`/${locale}/rate-limit-updates/`, (c) => buildLandingResponse(c.env, 'rate-limit-updates', locale));
  app.get(`/${locale}/faq/`, (c) => buildLandingResponse(c.env, 'faq', locale));
  app.get(`/${locale}/methodology/`, (c) => buildLandingResponse(c.env, 'methodology', locale));
}

// ── Community ──
app.get('/community', (c) => c.redirect('/community/', 301));
app.get('/community/', (c) => buildCommunityResponse(c.env, 'en', new URL(c.req.url)));
for (const locale of SITE_LOCALES.filter(candidate => candidate !== 'en')) {
  app.get(`/${locale}/community`, (c) => c.redirect(`/${locale}/community/`, 301));
  app.get(`/${locale}/community/`, (c) => buildCommunityResponse(c.env, locale, new URL(c.req.url)));
}

// The moderation console is intentionally a single noindex route. Its API
// still requires the server-side COMMUNITY_ADMIN_TOKEN on every request.
app.get('/admin/community', (c) => c.redirect('/admin/community/', 301));
app.get('/admin/community/', (c) => new Response(renderAdminCommunityPage(siteIntegrations(c.env)), {
  status: 200,
  headers: {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  },
}));

app.get('/admin/open-gambit', (c) => c.redirect('/admin/open-gambit/', 301));
app.get('/admin/open-gambit/', (c) => new Response(renderOpenGambitAdminPage(), {
  status: 200,
  headers: {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow',
  },
}));

for (const locale of SITE_LOCALES) {
  const gambitPath = OPEN_GAMBIT_PATHS[locale];
  const disclosurePath = AI_DISCLOSURE_PATHS[locale];
  app.get(gambitPath.slice(0, -1), (c) => c.redirect(gambitPath, 301));
  app.get(gambitPath, (c) => buildOpenGambitLandingResponse(c.env, locale));
  app.get(`${gambitPath}:slug`, (c) => c.redirect(`${gambitPath}${encodeURIComponent(c.req.param('slug') || '')}/`, 301));
  app.get(`${gambitPath}:slug/`, (c) => buildOpenGambitArticleResponse(c.env, c.req.param('slug') || '', locale));
  app.get(disclosurePath.slice(0, -1), (c) => c.redirect(disclosurePath, 301));
  app.get(disclosurePath, (c) => buildAiDisclosureResponse(c.env, locale));
}

async function buildHomepageResponse(env: Env, lang: SiteLocale): Promise<Response> {
  try {
    const repo = new Repository(env.DB);
    const [eventsResult, latestEvent, lastReset, lastPolicy, manualReset, latestDirectReset, freshness, gambitArticles] = await Promise.all([
      repo.getEvents({ limit: 50 }),
      repo.getLatestEvent(),
      repo.getLatestResetEvent(),
      repo.getLatestPolicyEvent(),
      repo.getLatestManualResetReport(),
      repo.getLatestDirectResetEvent(),
      getPageFreshness(repo, env),
      getPublishedGambits(env, 3),
    ]);
    const visibleManualReset = effectiveManualResetReport(manualReset, latestDirectReset);
    const html = renderHomepage({
      events: eventsResult.data,
      latestEvent,
      lastReset,
      latestDirectReset,
      manualReset: toPublicManualResetReport(visibleManualReset),
      lastPolicy,
      lastCheckedAt: freshness.lastCheckedAt,
      sourceLastFetchedAt: freshness.sourceLastFetchedAt,
      sourceLastNewPostAt: freshness.sourceLastNewPostAt,
      sourceMode: freshness.sourceMode,
      totalEvents: eventsResult.total,
      accounts: monitoredAccounts(env),
      gambitArticles,
    }, lang, siteIntegrations(env));
    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=60',
      },
    });
  } catch (err) {
    console.error(`[SSR /${lang}/] Error:`, err instanceof Error ? err.message : String(err));
    return new Response('Internal Server Error', { status: 500 });
  }
}

for (const locale of SITE_LOCALES.filter(candidate => candidate !== 'en' && candidate !== 'zh')) {
  app.get(`/${locale}`, (c) => c.redirect(`/${locale}/`, 301));
  app.get(`/${locale}/`, (c) => buildHomepageResponse(c.env, locale));
}

// ── SSR: Homepage (English) ──
app.get('/', (c) => buildHomepageResponse(c.env, 'en'));

// ── SSR: Homepage (Chinese) ──
app.get('/zh', (c) => {
  const url = new URL(c.req.url);
  url.pathname = '/zh/';
  return c.redirect(url.toString(), 301);
});

app.get('/zh/', (c) => buildHomepageResponse(c.env, 'zh'));

async function buildLocalizedEventResponse(env: Env, idValue: string, lang: SiteLocale): Promise<Response> {
  const id = Number(idValue);
  if (Number.isNaN(id) || id <= 0) {
    return new Response(render404(lang, siteIntegrations(env)), { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
  try {
    const repo = new Repository(env.DB);
    const event = await repo.getEventById(id);
    if (!event || event.id === undefined) {
      return new Response(render404(lang, siteIntegrations(env)), { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
    const allEvents = await repo.getEvents({ limit: 100 });
    const eventIndex = allEvents.data.findIndex(candidate => candidate.id !== undefined && candidate.id === id);
    const prevEvent = eventIndex > 0 ? allEvents.data[eventIndex - 1] : null;
    const nextEvent = eventIndex >= 0 && eventIndex < allEvents.data.length - 1 ? allEvents.data[eventIndex + 1] : null;
    const relatedEvents = allEvents.data.filter(candidate => candidate.id !== id && candidate.category === event.category).slice(0, 5);
    const html = renderEventPage({ event, prevEvent, nextEvent, relatedEvents }, lang, siteIntegrations(env));
    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=60',
      },
    });
  } catch (err) {
    console.error(`[SSR /${lang}/events/:id] Error:`, err instanceof Error ? err.message : String(err));
    return new Response(render404(lang, siteIntegrations(env)), { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}

for (const locale of SITE_LOCALES) {
  const eventPath = locale === 'en' ? '/events/:id' : `/${locale}/events/:id`;
  app.get(eventPath, (c) => buildLocalizedEventResponse(c.env, c.req.param('id') || '', locale));
}

// ── Static Assets Fallback ──
app.get('/*', async (c) => {
  const requestUrl = new URL(c.req.url);
  const pathname = requestUrl.pathname;
  try {
    const res = await c.env.ASSETS.fetch(c.req.raw);
    if (res.status === 404 && !pathname.includes('.')) {
      const lang = localeFromPath(pathname);
      return new Response(render404(lang, siteIntegrations(c.env)), {
        status: 404,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      });
    }
    return withAssetCachePolicy(pathname, res, requestUrl.searchParams.get('v'));
  } catch {
    if (!pathname.includes('.')) {
      const lang = localeFromPath(pathname);
      return new Response(render404(lang, siteIntegrations(c.env)), {
        status: 404,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }
    return new Response('Not Found', { status: 404 });
  }
});

function withAssetCachePolicy(pathname: string, response: Response, version: string | null = null): Response {
  const headers = new Headers(response.headers);
  const fingerprinted = isVersionedStaticAsset(pathname, version)
    || /^\/assets\/.+\.[a-f0-9]{8,}\.(?:js|css|woff2?)$/i.test(pathname)
    || /^\/(?:app|style)\.[a-f0-9]{8,}\.(?:js|css)$/i.test(pathname);

  headers.set(
    'Cache-Control',
    fingerprinted
      ? 'public, max-age=31536000, immutable'
      : 'no-cache, max-age=0, must-revalidate'
  );

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// ── Cron Handler ──
async function handleCron(env: Env): Promise<Response> {
  const repo = new Repository(env.DB);
  const hasXApi = canUseXApi(env);
  const xApiAutomaticSync = hasXApi && isXApiAutomaticSyncEnabled(env);
  const hasSearchProvider = canUseSearchProvider(env);
  const searchProvider: WebSearchProvider | undefined = hasSearchProvider
    ? new SearchProvider(env, repo)
    : undefined;
  const xApiProvider = xApiAutomaticSync ? new XApiProvider(env, repo) : undefined;
  const hasLLM = missingClassifierConfiguration(env).length === 0;

  try {
    if (!hasSearchProvider) {
      await repo.recordProviderStatus(WEB_SEARCH_PROVIDER_KEY, 'not_configured', null, 'TAVILY_API_KEY, BRAVE_SEARCH_API_KEY or Google Search credentials not set');
    }
    if (!hasXApi) {
      await repo.recordProviderStatus('x_api', 'not_configured', null, 'X_API_BEARER_TOKEN not set');
    } else if (!xApiAutomaticSync) {
      await repo.recordProviderStatus('x_api', 'disabled', null, 'Automatic X API sync disabled; web search is the discovery source');
    }
    // Do not write a synthetic "ok" before any classification has succeeded:
    // that would erase a previous degraded state on every Cron start. The
    // configured/not-configured state is derived from the binding itself.
    if (!hasLLM) {
      await repo.recordProviderStatus('llm-classifier', 'not_configured', null, 'LLM_NOT_CONFIGURED');
    }
  } catch (e) {}

  let classifier: ClassificationProvider;
  try {
    classifier = new LLMClassifier(env);
  } catch {
    classifier = new UnavailableClassifier();
  }

  const result = await executeCron(env, null, classifier, { searchProvider, xApiProvider });

  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json' },
  });
}

async function handleScheduledEventTranslationBackfill(env: Env): Promise<void> {
  try {
    const result = await backfillMonitorEventTranslations(env, 1);
    if (result.processed > 0) {
      console.info('[Event Translation] scheduled_backfill', {
        processed: result.processed,
        translated: result.translated,
        failed: result.failed,
        remaining: result.remaining,
      });
    }
  } catch (error) {
    console.error('[Event Translation] scheduled_backfill_failed', {
      error: error instanceof Error ? error.message.slice(0, 160) : 'unknown',
    });
  }
}

function gambitCronWindows(env: Env): string[] {
  return (env.GAMBIT_CRON_WINDOWS || '30 2 * * *,30 14 * * *')
    .split(',')
    .map(value => value.trim())
    .filter(value => value.length > 0);
}

function shouldRunGambitCron(event: ScheduledEvent, env: Env): boolean {
  return env.GAMBIT_SCHEDULE_ENABLED !== 'false' && gambitCronWindows(env).includes(event.cron);
}

async function handleOpenGambitScheduled(env: Env, cron: string): Promise<void> {
  try {
    const result = await runGambitDiscovery(env, { windowKey: `${new Date().toISOString().slice(0, 10)}:${cron.replace(/\s+/gu, '-')}` });
    console.info('[Open Gambit] scheduled_discovery', {
      runId: result.runId,
      status: result.status,
      candidates: result.candidatesFound,
      qualified: result.qualifiedGambits,
      workflows: result.workflowStarts,
      fetchFailures: result.fetchFailures,
    });
  } catch (error) {
    console.error('[Open Gambit] scheduled_discovery_failed', { error: error instanceof Error ? error.message.slice(0, 160) : 'unknown' });
  }
}

class UnavailableClassifier implements ClassificationProvider {
  readonly name = 'llm-unavailable';
  async classify(_post: import('./types').SourcePost): Promise<ClassificationOutcome> {
    return {
      status: 'ERROR',
      error: 'LLM_NOT_CONFIGURED',
      errorCode: 'LLM_NOT_CONFIGURED',
      failureKind: 'PERMANENT_OR_CONFIGURATION_ERROR',
      category: 'ERROR',
    };
  }
}

// ── Export ──
export default {
  fetch: app.fetch,

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(handleCron(env));
    ctx.waitUntil(handleScheduledEventTranslationBackfill(env));
    if (shouldRunGambitCron(event, env)) ctx.waitUntil(handleOpenGambitScheduled(env, event.cron));
  },
};

export { handleCron };
export { OpenGambitAnalysisWorkflow };
