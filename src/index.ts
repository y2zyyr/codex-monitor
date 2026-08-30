// ============================================================
// Codex Usage Monitor - Cloudflare Worker Entry Point
// Includes SSR for SEO, dynamic sitemap, and API noindex
// ============================================================
import { Hono } from 'hono';
import type { Env, MonitorEvent } from './types';
import api from './routes/api';
import { executeCron } from './cron';
import { Repository } from './db/repository';
import { handleTelegramWebhook } from './telegram';
import { toPublicManualResetReport } from './manual-reset';
import { canUseXApi, XApiProvider } from './providers/x-api';
import { SearchProvider, canUseSearchProvider, monitoredAccounts, WEB_SEARCH_PROVIDER_KEY } from './providers/search-provider';
import type { WebSearchProvider } from './providers/types';
import { LLMClassifier } from './classifier/llm';
import type { ClassificationProvider, ClassificationOutcome } from './types';
import { isXApiAutomaticSyncEnabled } from './utils/schedule';
import { isEventIndexEligible } from './utils/index-policy';
import { effectiveManualResetReport } from './utils/reset-source';
import {
  renderHomepage,
  renderEventPage,
  renderLandingPage,
  render404,
  renderRssFeed,
  renderSitemap,
  type LandingPageKey,
  type SiteIntegrations,
  type SitemapLandingPage,
} from './renderer';

const app = new Hono<{ Bindings: Env }>();

const RESET_HISTORY_CATEGORIES = ['RESET_PLANNED', 'RESET_COMPLETED', 'RESET_TIME_CHANGED'];
const RATE_LIMIT_CATEGORIES = ['POLICY_CHANGE', 'RESET_TIME_CHANGED'];

function siteIntegrations(env: Env): SiteIntegrations {
  return {
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

async function buildLandingResponse(env: Env, page: LandingPageKey, lang: 'en' | 'zh'): Promise<Response> {
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
  const providedSecret = c.req.query('secret') || (await c.req.formData()).get('secret');
  if (providedSecret !== secret) {
    return c.json({ error: 'Unauthorized - invalid or missing secret' }, 401);
  }
  return handleCron(c.env);
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
    const [events, freshness] = await Promise.all([
      getAllEvents(repo),
      getPageFreshness(repo, c.env),
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

    const xml = renderSitemap(events, lastmod, landingPages);
    return c.newResponse(xml, 200, {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Sitemap] Error:', msg);
    try {
      const staticSitemap = await c.env.ASSETS.fetch(new Request('https://fakehost/sitemap.xml'));
      if (staticSitemap.status === 200) return staticSitemap;
    } catch {}
    return c.newResponse('Internal Server Error', 500);
  }
});

// ── RSS Feed ──
app.get('/feed.xml', async (c) => {
  try {
    const repo = new Repository(c.env.DB);
    const [eventsResult, manualReset, latestDirectReset] = await Promise.all([
      repo.getEvents({ limit: 20 }),
      repo.getLatestManualResetReport(),
      repo.getLatestDirectResetEvent(),
    ]);
    const visibleManualReset = effectiveManualResetReport(manualReset, latestDirectReset);
    return c.newResponse(renderRssFeed(eventsResult.data, 'zh', toPublicManualResetReport(visibleManualReset)), 200, {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=60',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[RSS] Error:', msg);
    return c.newResponse(renderRssFeed([], 'zh', null), 500, {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'no-store',
    });
  }
});

// ── Dynamic robots.txt ──
app.get('/robots.txt', async (c) => {
  const robots = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    'Disallow: /__cron/',
    'Disallow: /*.json',
    '',
    'Sitemap: https://tibo.modelyard.dev/sitemap.xml',
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
app.get('/zh/latest', (c) => c.redirect('/zh/latest/', 301));
app.get('/zh/reset-history', (c) => c.redirect('/zh/reset-history/', 301));
app.get('/zh/rate-limit-updates', (c) => c.redirect('/zh/rate-limit-updates/', 301));
app.get('/zh/faq', (c) => c.redirect('/zh/faq/', 301));
app.get('/zh/methodology', (c) => c.redirect('/zh/methodology/', 301));

app.get('/latest/', (c) => buildLandingResponse(c.env, 'latest', 'en'));
app.get('/reset-history/', (c) => buildLandingResponse(c.env, 'reset-history', 'en'));
app.get('/rate-limit-updates/', (c) => buildLandingResponse(c.env, 'rate-limit-updates', 'en'));
app.get('/faq/', (c) => buildLandingResponse(c.env, 'faq', 'en'));
app.get('/methodology/', (c) => buildLandingResponse(c.env, 'methodology', 'en'));
app.get('/zh/latest/', (c) => buildLandingResponse(c.env, 'latest', 'zh'));
app.get('/zh/reset-history/', (c) => buildLandingResponse(c.env, 'reset-history', 'zh'));
app.get('/zh/rate-limit-updates/', (c) => buildLandingResponse(c.env, 'rate-limit-updates', 'zh'));
app.get('/zh/faq/', (c) => buildLandingResponse(c.env, 'faq', 'zh'));
app.get('/zh/methodology/', (c) => buildLandingResponse(c.env, 'methodology', 'zh'));

// ── SSR: Homepage (English) ──
app.get('/', async (c) => {
  try {
    const repo = new Repository(c.env.DB);
    const [eventsResult, latestEvent, lastReset, lastPolicy, manualReset, latestDirectReset, freshness] = await Promise.all([
      repo.getEvents({ limit: 50 }),
      repo.getLatestEvent(),
      repo.getLatestResetEvent(),
      repo.getLatestPolicyEvent(),
      repo.getLatestManualResetReport(),
      repo.getLatestDirectResetEvent(),
      getPageFreshness(repo, c.env),
    ]);
    const visibleManualReset = effectiveManualResetReport(manualReset, latestDirectReset);

    const html = renderHomepage({
      events: eventsResult.data,
      latestEvent,
      lastReset,
      manualReset: toPublicManualResetReport(visibleManualReset),
      lastPolicy,
      lastCheckedAt: freshness.lastCheckedAt,
      sourceLastFetchedAt: freshness.sourceLastFetchedAt,
      sourceLastNewPostAt: freshness.sourceLastNewPostAt,
      sourceMode: freshness.sourceMode,
      totalEvents: eventsResult.total,
      accounts: monitoredAccounts(c.env),
    }, 'en', siteIntegrations(c.env));

    const response = c.html(html);
    response.headers.set('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=60');
    return response;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[SSR /] Error:', msg);
    try {
      const index = await c.env.ASSETS.fetch(new Request('https://fakehost/index.html'));
      if (index.status === 200) return index;
    } catch {}
    return c.newResponse('Internal Server Error', 500);
  }
});

// ── SSR: Homepage (Chinese) ──
app.get('/zh', (c) => {
  const url = new URL(c.req.url);
  url.pathname = '/zh/';
  return c.redirect(url.toString(), 301);
});

app.get('/zh/', async (c) => {
  try {
    const repo = new Repository(c.env.DB);
    const [eventsResult, latestEvent, lastReset, lastPolicy, manualReset, latestDirectReset, freshness] = await Promise.all([
      repo.getEvents({ limit: 50 }),
      repo.getLatestEvent(),
      repo.getLatestResetEvent(),
      repo.getLatestPolicyEvent(),
      repo.getLatestManualResetReport(),
      repo.getLatestDirectResetEvent(),
      getPageFreshness(repo, c.env),
    ]);
    const visibleManualReset = effectiveManualResetReport(manualReset, latestDirectReset);

    const html = renderHomepage({
      events: eventsResult.data,
      latestEvent,
      lastReset,
      manualReset: toPublicManualResetReport(visibleManualReset),
      lastPolicy,
      lastCheckedAt: freshness.lastCheckedAt,
      sourceLastFetchedAt: freshness.sourceLastFetchedAt,
      sourceLastNewPostAt: freshness.sourceLastNewPostAt,
      sourceMode: freshness.sourceMode,
      totalEvents: eventsResult.total,
      accounts: monitoredAccounts(c.env),
    }, 'zh', siteIntegrations(c.env));

    const response = c.html(html);
    response.headers.set('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=60');
    return response;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[SSR /zh/] Error:', msg);
    return c.newResponse('Internal Server Error', 500);
  }
});

// ── SSR: Event Page (English) ──
app.get('/events/:id', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    if (isNaN(id) || id <= 0) {
      return c.newResponse(render404('en', siteIntegrations(c.env)), 404, { 'Content-Type': 'text/html; charset=utf-8' });
    }

    const repo = new Repository(c.env.DB);
    const event = await repo.getEventById(id);
    if (!event || event.id === undefined) {
      return c.newResponse(render404('en', siteIntegrations(c.env)), 404, { 'Content-Type': 'text/html; charset=utf-8' });
    }

    const allEvents = await repo.getEvents({ limit: 100 });
    const eventIndex = allEvents.data.findIndex((e: MonitorEvent) => e.id !== undefined && e.id === id);
    const prevEvent = eventIndex > 0 ? allEvents.data[eventIndex - 1] : null;
    const nextEvent = eventIndex >= 0 && eventIndex < allEvents.data.length - 1
      ? allEvents.data[eventIndex + 1]
      : null;

    const relatedEvents = allEvents.data
      .filter((e: MonitorEvent) => e.id !== id && e.category === event.category)
      .slice(0, 5);

    const html = renderEventPage({
      event,
      prevEvent,
      nextEvent,
      relatedEvents,
    }, 'en', siteIntegrations(c.env));

    const response = c.html(html);
    response.headers.set('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=60');
    return response;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[SSR /events/:id] Error:', msg);
    return c.newResponse(render404('en', siteIntegrations(c.env)), 404, { 'Content-Type': 'text/html; charset=utf-8' });
  }
});

// ── SSR: Event Page (Chinese) ──
app.get('/zh/events/:id', async (c) => {
  try {
    const id = Number(c.req.param('id'));
    if (isNaN(id) || id <= 0) {
      return c.newResponse(render404('zh', siteIntegrations(c.env)), 404, { 'Content-Type': 'text/html; charset=utf-8' });
    }

    const repo = new Repository(c.env.DB);
    const event = await repo.getEventById(id);
    if (!event || event.id === undefined) {
      return c.newResponse(render404('zh', siteIntegrations(c.env)), 404, { 'Content-Type': 'text/html; charset=utf-8' });
    }

    const allEvents = await repo.getEvents({ limit: 100 });
    const eventIndex = allEvents.data.findIndex((e: MonitorEvent) => e.id !== undefined && e.id === id);
    const prevEvent = eventIndex > 0 ? allEvents.data[eventIndex - 1] : null;
    const nextEvent = eventIndex >= 0 && eventIndex < allEvents.data.length - 1
      ? allEvents.data[eventIndex + 1]
      : null;

    const relatedEvents = allEvents.data
      .filter((e: MonitorEvent) => e.id !== id && e.category === event.category)
      .slice(0, 5);

    const html = renderEventPage({
      event,
      prevEvent,
      nextEvent,
      relatedEvents,
    }, 'zh', siteIntegrations(c.env));

    const response = c.html(html);
    response.headers.set('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=60');
    return response;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[SSR /zh/events/:id] Error:', msg);
    return c.newResponse(render404('zh', siteIntegrations(c.env)), 404, { 'Content-Type': 'text/html; charset=utf-8' });
  }
});

// ── Static Assets Fallback ──
app.get('/*', async (c) => {
  const pathname = new URL(c.req.url).pathname;
  try {
    const res = await c.env.ASSETS.fetch(c.req.raw);
    if (res.status === 404 && !pathname.includes('.')) {
      const lang = pathname === '/zh' || pathname.startsWith('/zh/') ? 'zh' : 'en';
      return new Response(render404(lang, siteIntegrations(c.env)), {
        status: 404,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      });
    }
    return withAssetCachePolicy(pathname, res);
  } catch {
    if (!pathname.includes('.')) {
      const lang = pathname === '/zh' || pathname.startsWith('/zh/') ? 'zh' : 'en';
      return new Response(render404(lang, siteIntegrations(c.env)), {
        status: 404,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }
    return new Response('Not Found', { status: 404 });
  }
});

function withAssetCachePolicy(pathname: string, response: Response): Response {
  const headers = new Headers(response.headers);
  const fingerprinted = /^\/assets\/.+\.[a-f0-9]{8,}\.(?:js|css|woff2?)$/i.test(pathname)
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
  const hasLLM = !!(env.LLM_API_KEY && env.LLM_API_KEY.length > 0);

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
      await repo.recordProviderStatus('llm-classifier', 'not_configured', null, 'LLM_API_KEY not set');
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

class UnavailableClassifier implements ClassificationProvider {
  readonly name = 'llm-unavailable';
  async classify(_post: import('./types').SourcePost): Promise<ClassificationOutcome> {
    return { status: 'ERROR', error: 'LLM_API_KEY not configured', category: 'ERROR' };
  }
}

// ── Export ──
export default {
  fetch: app.fetch,

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(handleCron(env));
  },
};

export { handleCron };
