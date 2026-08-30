// ============================================================
// Codex Usage Monitor - API Routes
// ============================================================
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { DISPLAY_TIME_ZONES, EVENT_CATEGORIES } from '../types';
import type { DisplayTimeZone, Env, EventQueryOptions, ManualResetReport, MonitorEvent } from '../types';
import { Repository } from '../db/repository';
import { toPublicManualResetReport } from '../manual-reset';
import {
  directResetSupersedesManualReport,
  effectiveManualResetReport,
} from '../utils/reset-source';
import { canUseSearchProvider, monitoredAccounts, WEB_SEARCH_PROVIDER_KEY } from '../providers/search-provider';
import {
  providerUsageDate,
} from '../utils/schedule';
import { isDisplayTimeZone } from '../utils/timezone';
import { getXApiStatusSnapshot } from '../utils/x-api-status';
import {
  getBraveMonthlyCreditUsd,
  getEstimatedMonthlyGrossCostUsd,
  getEstimatedMonthlyRequests,
  getWebSearchDailyLimit,
  getWebSearchMode,
  isWebSearchOverdue,
  nextWebSearchAt,
} from '../utils/search-schedule';

const api = new Hono<{ Bindings: Env }>();

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isValidDateOnly(value: string): boolean {
  if (!DATE_ONLY_PATTERN.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function readEventFilters(url: URL): { filters: EventQueryOptions } | { error: string } {
  const params = url.searchParams;
  const rawCategory = params.get('category')?.trim() || undefined;
  if (rawCategory && rawCategory !== 'ALL' && !EVENT_CATEGORIES.includes(rawCategory as typeof EVENT_CATEGORIES[number])) {
    return { error: 'Invalid category' };
  }

  const q = params.get('q')?.trim() || undefined;
  if (q && q.length > 120) return { error: 'q must be 120 characters or fewer' };

  const startDate = params.get('startDate')?.trim() || undefined;
  const endDate = params.get('endDate')?.trim() || undefined;
  const rawTimeZone = params.get('timeZone')?.trim() || undefined;
  if (startDate && !isValidDateOnly(startDate)) return { error: 'startDate must be a valid YYYY-MM-DD date' };
  if (endDate && !isValidDateOnly(endDate)) return { error: 'endDate must be a valid YYYY-MM-DD date' };
  if (startDate && endDate && startDate > endDate) return { error: 'startDate cannot be after endDate' };
  if (rawTimeZone && !isDisplayTimeZone(rawTimeZone)) {
    return { error: `timeZone must be one of ${DISPLAY_TIME_ZONES.join(' or ')}` };
  }

  return {
    filters: {
      category: rawCategory === 'ALL' ? undefined : rawCategory,
      q,
      startDate,
      endDate,
      timeZone: rawTimeZone as DisplayTimeZone | undefined,
    },
  };
}

const EXPORT_COLUMNS: Array<keyof MonitorEvent> = [
  'id',
  'category',
  'title_en',
  'title_zh',
  'summary_en',
  'summary_zh',
  'confidence',
  'published_at',
  'effective_at',
  'reset_at',
  'source_url',
  'source_text',
  'source_account',
  'source_quality',
  'evidence_quality',
  'verification_status',
  'first_discovered_via',
  'last_verified_via',
  'verified_at',
  'observed_at',
  'created_at',
  'updated_at',
];

function csvCell(value: unknown): string {
  return '"' + String(value ?? '').replace(/"/g, '""') + '"';
}

function eventsToCsv(events: MonitorEvent[]): string {
  const header = EXPORT_COLUMNS.map(column => csvCell(column)).join(',');
  const rows = events.map(event => EXPORT_COLUMNS.map(column => csvCell(event[column])).join(','));
  // UTF-8 BOM keeps Chinese text readable when opened directly in Excel.
  return '\uFEFF' + [header, ...rows].join('\r\n') + '\r\n';
}

function configuredSearchProvider(env: Env): 'tavily' | 'brave' | 'google' | 'none' {
  if (env.TAVILY_API_KEY?.trim()) return 'tavily';
  if (env.BRAVE_SEARCH_API_KEY?.trim()) return 'brave';
  if (env.GOOGLE_API_KEY?.trim() && env.GOOGLE_CSE_ID?.trim()) return 'google';
  return 'none';
}

function searchProviderStatus(
  statuses: Array<{ provider_name: string; status: string; last_success_at: string | null }>,
  configuredProvider: ReturnType<typeof configuredSearchProvider>,
) {
  // Provider-specific rows existed before the public `web_search` key was
  // introduced. Prefer the row for the provider that is actually configured;
  // never let a stale Brave/Tavily row describe a different active provider.
  const activeName = {
    tavily: 'tavily-search',
    brave: 'brave-search',
    google: 'google-search',
    none: null,
  }[configuredProvider];
  if (activeName) {
    return statuses.find(status => status.provider_name === activeName)
      ?? statuses.find(status => status.provider_name === WEB_SEARCH_PROVIDER_KEY)
      ?? statuses.find(status => status.provider_name === 'web-search');
  }
  return statuses.find(status => status.provider_name === WEB_SEARCH_PROVIDER_KEY)
    ?? statuses.find(status => status.provider_name === 'web-search');
}

function timestampMs(value: unknown): number | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function resetCycleEvidenceMs(cycle: Record<string, unknown> | null): number | null {
  if (!cycle) return null;
  const values = [
    timestampMs(cycle.planned_published_at),
    timestampMs(cycle.time_changed_published_at),
    timestampMs(cycle.confirmed_reset_at),
    timestampMs(cycle.created_at),
  ].filter((value): value is number => value !== null);
  return values.length > 0 ? Math.max(...values) : null;
}

function manualReportIsNewer(report: ManualResetReport | null, cycle: Record<string, unknown> | null): boolean {
  if (!report) return false;
  const reportMs = timestampMs(report.reset_at);
  if (reportMs === null) return false;
  const cycleMs = resetCycleEvidenceMs(cycle);
  return cycleMs === null || reportMs >= cycleMs;
}

function manualResetResponse(report: ManualResetReport) {
  return {
    status: 'CONFIRMED' as const,
    expectedResetAt: null,
    expectedResetTimeText: null,
    isApproximate: false,
    resetSource: 'Server monitoring report',
    resetSourceUrl: null,
    verificationStatus: 'MANUAL_REPORTED',
    manualReset: toPublicManualResetReport(report),
    confirmation: {
      type: 'MANUAL',
      confidence: 1,
      confirmedAt: report.reset_at,
      sourceUrl: null,
      lastCheckedAt: report.reported_at,
      evidenceCount: 0,
    },
  };
}

function directResetResponse(event: MonitorEvent) {
  const confirmationType = event.verification_status === 'OFFICIAL_VERIFIED'
    || event.source_quality === 'OFFICIAL'
    || event.evidence_quality === 'OFFICIAL'
    ? 'OFFICIAL'
    : 'DIRECT';
  const confirmedAt = event.reset_at ?? event.effective_at ?? event.published_at ?? event.created_at ?? null;

  return {
    status: 'CONFIRMED' as const,
    expectedResetAt: null,
    expectedResetTimeText: null,
    isApproximate: false,
    resetSource: event.source_account ?? (confirmationType === 'OFFICIAL' ? 'OpenAI' : 'Tibo'),
    resetSourceUrl: event.source_url,
    verificationStatus: event.verification_status ?? (confirmationType === 'OFFICIAL' ? 'OFFICIAL_VERIFIED' : 'DIRECT_VERIFIED'),
    manualReset: null,
    confirmation: {
      type: confirmationType,
      confidence: event.confidence,
      confirmedAt,
      sourceUrl: event.source_url,
      lastCheckedAt: event.observed_at ?? event.verified_at ?? event.updated_at ?? null,
      evidenceCount: 0,
    },
  };
}

// CORS
api.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'OPTIONS'],
}));

// GET /api/events - List events with pagination
api.get('/events', async (c) => {
  const repo = new Repository(c.env.DB);

  const rawLimit = c.req.query('limit');
  const parsedLimit = rawLimit === undefined || rawLimit === '' ? 20 : Number(rawLimit);
  if (!Number.isInteger(parsedLimit) || parsedLimit < 1) {
    return c.json({ error: 'limit must be a positive integer' }, 400);
  }
  const limit = Math.min(parsedLimit, 100);

  const rawCursor = c.req.query('cursor');
  const parsedFilters = readEventFilters(new URL(c.req.url));
  if ('error' in parsedFilters) return c.json({ error: parsedFilters.error }, 400);
  const filters = parsedFilters.filters;

  try {
    let cursor: { sortValue: string; id: number } | null = null;
    if (rawCursor && rawCursor !== '0') {
      cursor = Repository.decodeEventCursor(rawCursor);

      // Keep cursors emitted by the previous API contract usable. The old
      // endpoint returned the last event id; resolve it to the new composite
      // publication-time/id cursor before querying the next page.
      if (!cursor && /^\d+$/.test(rawCursor)) {
        const legacyEvent = await repo.getEventById(Number(rawCursor));
        const sortValue = legacyEvent?.published_at ?? legacyEvent?.created_at;
        if (legacyEvent?.id && sortValue) cursor = { sortValue, id: legacyEvent.id };
      }

      if (!cursor) return c.json({ error: 'Invalid cursor' }, 400);
    }

    const result = await repo.getEvents({ ...filters, limit, cursor });
    return c.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[API] GET /events error: ${msg}`);
    return c.json({ error: 'Internal server error', data: [], nextCursor: null, total: 0 }, 500);
  }
});

// GET /api/export - Export all events matching the current filters
api.get('/export', async (c) => {
  const format = (c.req.query('format') || 'json').trim().toLowerCase();
  if (format !== 'json' && format !== 'csv') {
    return c.json({ error: 'format must be csv or json' }, 400);
  }

  const parsedFilters = readEventFilters(new URL(c.req.url));
  if ('error' in parsedFilters) return c.json({ error: parsedFilters.error }, 400);

  try {
    const repo = new Repository(c.env.DB);
    const events = await repo.getAllEvents(parsedFilters.filters);
    if (format === 'csv') {
      return c.newResponse(eventsToCsv(events), 200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="tibo-codex-events.csv"',
        'Cache-Control': 'no-store',
      });
    }

    const response = c.json({
      data: events,
      total: events.length,
      filters: parsedFilters.filters,
      generatedAt: new Date().toISOString(),
    });
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('Content-Disposition', 'attachment; filename="tibo-codex-events.json"');
    return response;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[API] GET /export error: ${msg}`);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// GET /api/history - Zero-filled daily event totals for the last N days
api.get('/history', async (c) => {
  const rawDays = c.req.query('days');
  const parsedDays = rawDays === undefined || rawDays === '' ? 30 : Number(rawDays);
  if (!Number.isInteger(parsedDays) || parsedDays < 1 || parsedDays > 366) {
    return c.json({ error: 'days must be an integer between 1 and 366' }, 400);
  }
  const rawTimeZone = c.req.query('timeZone')?.trim() || undefined;
  if (rawTimeZone && !isDisplayTimeZone(rawTimeZone)) {
    return c.json({ error: `timeZone must be one of ${DISPLAY_TIME_ZONES.join(' or ')}` }, 400);
  }
  const timeZone: DisplayTimeZone = rawTimeZone
    ? rawTimeZone as DisplayTimeZone
    : 'Asia/Shanghai';

  try {
    const repo = new Repository(c.env.DB);
    const history = await repo.getEventHistory({ days: parsedDays, timeZone });
    const response = c.json(history);
    response.headers.set('Cache-Control', 'public, max-age=300, s-maxage=300, stale-while-revalidate=60');
    return response;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[API] GET /history error: ${msg}`);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// GET /api/events/:id - Single event detail
api.get('/events/:id', async (c) => {
  const repo = new Repository(c.env.DB);
  const id = Number(c.req.param('id'));

  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: 'Invalid event ID' }, 400);
  }

  try {
    const event = await repo.getEventById(id);
    if (!event) {
      return c.json({ error: 'Event not found' }, 404);
    }
    return c.json(event);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[API] GET /events/${id} error: ${msg}`);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// GET /api/status - Current status summary with provider state
api.get('/status', async (c) => {
  const repo = new Repository(c.env.DB);

  try {
    const now = new Date();
    const [latestEvent, lastReset, currentPolicy, lastRun, lastSuccessfulRun, providerStatuses, xApiSnapshot, searchUsage, activeCycle, lastSearchAttempt, lastSearchSuccess, manualResetReport, latestDirectReset] = await Promise.all([
      repo.getLatestEvent(),
      repo.getLatestResetEvent(),
      repo.getLatestPolicyEvent(),
      repo.getLatestRun(),
      repo.getLatestSuccessfulRun(),
      repo.getAllProviderStatuses(),
      getXApiStatusSnapshot(repo, c.env, now),
      repo.getProviderUsageSummary(WEB_SEARCH_PROVIDER_KEY, providerUsageDate(now)),
      repo.getActiveResetCycle(),
      repo.getSetting('web_search_last_attempt'),
      repo.getSetting('web_search_last_success'),
      repo.getLatestManualResetReport(),
      repo.getLatestDirectResetEvent(),
    ]);
    const visibleManualResetReport = effectiveManualResetReport(manualResetReport, latestDirectReset);

    const accounts = monitoredAccounts(c.env);

    // Determine system status
    const hasLLM = providerStatuses.find(p => p.provider_name === 'llm-classifier');
    const webSearchConfigured = canUseSearchProvider(c.env);
    const searchProvider = configuredSearchProvider(c.env);
    const webSearchStatus = searchProviderStatus(providerStatuses, searchProvider);
    const llmConfigured = !!c.env.LLM_API_KEY?.trim();
    const llmStatus = !llmConfigured
      ? 'not_configured'
      : (hasLLM && hasLLM.status !== 'not_configured' ? hasLLM.status : 'unknown');
    const searchMode = getWebSearchMode(activeCycle, now);
    const searchLastSuccessAt = lastSearchSuccess ?? webSearchStatus?.last_success_at ?? searchUsage.lastSuccessAt;
    const searchLastAttemptAt = lastSearchAttempt ?? searchLastSuccessAt;
    const nextSearchAt = nextWebSearchAt(now, searchMode, searchLastAttemptAt, searchUsage, c.env);
    const estimatedMonthlyRequests = getEstimatedMonthlyRequests(searchMode, c.env, 1);
    // The configured price variable is specifically Brave's price. Do not
    // present a Brave estimate while Tavily/Google is the active provider.
    const estimatedMonthlyGrossCostUsd = searchProvider === 'brave'
      ? getEstimatedMonthlyGrossCostUsd(searchMode, c.env, 1)
      : null;
    const monthlyCreditUsd = searchProvider === 'brave' ? getBraveMonthlyCreditUsd(c.env) : null;

    let systemStatus: string;
    const sourceConfigured = xApiSnapshot.automaticSync || webSearchConfigured;
    if (!sourceConfigured && !llmConfigured) {
      systemStatus = 'not_configured';
    } else if (!sourceConfigured) {
      systemStatus = 'source_not_configured';
    } else if (!llmConfigured) {
      systemStatus = 'classifier_not_configured';
    } else if ((!xApiSnapshot.automaticSync && (webSearchStatus?.status === 'degraded' || webSearchStatus?.status === 'down'))
      || llmStatus === 'degraded' || llmStatus === 'down') {
      systemStatus = 'degraded';
    } else if (!xApiSnapshot.automaticSync && webSearchConfigured && isWebSearchOverdue(now, searchLastSuccessAt, searchMode, c.env, searchUsage)) {
      systemStatus = 'degraded';
    } else if (xApiSnapshot.automaticSync && ['down', 'degraded', 'stale'].includes(xApiSnapshot.status)) {
      systemStatus = 'degraded';
    } else if (lastRun?.status === 'failed' || !!lastRun?.error_message) {
      systemStatus = 'degraded';
    } else {
      systemStatus = 'ok';
    }

    return c.json({
      status: systemStatus,
      // A successful completed monitor run is the page-level freshness
      // signal. Provider fetch freshness is exposed separately below so
      // "LIVE" never implies that an event itself was independently verified
      // just now.
      lastCheckedAt: lastSuccessfulRun?.finished_at ?? null,
      lastSuccessfulCron: lastSuccessfulRun?.finished_at ?? null,
      lastSourceFetch: xApiSnapshot.automaticSync
        ? xApiSnapshot.lastSuccessAt
        : (lastSearchSuccess ?? webSearchStatus?.last_success_at ?? searchUsage.lastSuccessAt ?? null),
      lastEventVerifiedAt: latestEvent?.verified_at ?? null,
      latestEvent,
      lastReset,
      manualReset: toPublicManualResetReport(visibleManualResetReport),
      currentPolicy,
      lastRun,
      checkedAccounts: accounts,
      providers: {
        source: xApiSnapshot.automaticSync
          ? { name: 'x_api', configured: xApiSnapshot.configured, status: xApiSnapshot.status }
          : {
            name: WEB_SEARCH_PROVIDER_KEY,
            configured: webSearchConfigured,
            status: webSearchStatus?.status ?? (webSearchConfigured ? 'unknown' : 'not_configured'),
          },
        classifier: {
          name: 'llm',
          configured: llmConfigured,
          status: llmStatus,
        },
        xApi: {
          ...xApiSnapshot,
          lastAuthoritativeSync: xApiSnapshot.lastSuccessAt,
        },
        webSearch: {
          configured: webSearchConfigured,
          provider: searchProvider,
          status: webSearchStatus?.status ?? (webSearchConfigured ? 'unknown' : 'not_configured'),
          dailyLimit: getWebSearchDailyLimit(c.env),
          usedToday: searchUsage.usedToday,
          requestsToday: searchUsage.usedToday,
          lastFetchAt: searchUsage.lastFetchAt,
          lastSuccessAt: searchLastSuccessAt,
          currentMode: searchMode,
          nextSearchAt,
          estimatedMonthlyRequests,
          estimatedMonthlyGrossCostUsd,
          monthlyCreditUsd,
        },
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[API] GET /status error: ${msg}`);
    return c.json({
      status: 'error',
      error: 'Internal server error',
      lastCheckedAt: null,
      lastSuccessfulCron: null,
      lastSourceFetch: null,
      lastEventVerifiedAt: null,
      latestEvent: null,
      lastReset: null,
      manualReset: null,
      currentPolicy: null,
      lastRun: null,
      checkedAccounts: [],
      providers: {
        source: { name: WEB_SEARCH_PROVIDER_KEY, configured: false, status: 'unknown' },
        classifier: { name: 'llm', configured: false, status: 'unknown' },
        xApi: {
          name: 'x_api',
          configured: false,
          automaticSync: false,
          status: 'unknown',
          sourceRole: 'primary',
          dailyLimit: 96,
          usedToday: 0,
          pollIntervalMinutes: 15,
          lastFetchAt: null,
          lastAttemptAt: null,
          lastSuccessAt: null,
          lastNewPostAt: null,
          nextPollAt: null,
          lastAuthoritativeSync: null,
          nextScheduledSync: null,
          rateLimitRemaining: null,
          rateLimitResetAt: null,
          observedPostsToday: 0,
        },
        webSearch: {
          configured: false,
          dailyLimit: 6,
          usedToday: 0,
          requestsToday: 0,
          lastFetchAt: null,
          lastSuccessAt: null,
          currentMode: 'NORMAL',
          nextSearchAt: null,
          estimatedMonthlyRequests: 180,
          estimatedMonthlyGrossCostUsd: null,
          monthlyCreditUsd: null,
        },
      },
    }, 500);
  }
});

// GET /api/health - Health check with provider status
api.get('/health', async (c) => {
  const repo = new Repository(c.env.DB);

  try {
    const dbConnected = await repo.healthCheck();
    const lastRun = await repo.getLatestRun();
    const latestEvent = await repo.getLatestEvent();
    const lastSuccessfulRun = await repo.getLatestSuccessfulRun();
    const providerStatuses = await repo.getAllProviderStatuses();
    const now = new Date();
    const xApiSnapshot = await getXApiStatusSnapshot(repo, c.env, now);
    const searchUsage = await repo.getProviderUsageSummary(WEB_SEARCH_PROVIDER_KEY, providerUsageDate(now));
    const activeCycle = await repo.getActiveResetCycle();
    const lastSearchAttempt = await repo.getSetting('web_search_last_attempt');
    const lastSearchSuccess = await repo.getSetting('web_search_last_success');

    // Determine overall status
    let overallStatus: string;
    const hasLLM = providerStatuses.find(p => p.provider_name === 'llm-classifier');
    const llmConfigured = !!c.env.LLM_API_KEY?.trim();
    const llmStatus = !llmConfigured
      ? 'not_configured'
      : (hasLLM && hasLLM.status !== 'not_configured' ? hasLLM.status : 'unknown');
    const searchProvider = configuredSearchProvider(c.env);
    const searchStatus = searchProviderStatus(providerStatuses, searchProvider);
    const searchMode = getWebSearchMode(activeCycle, now);
    const searchLastSuccessAt = lastSearchSuccess ?? searchStatus?.last_success_at ?? searchUsage.lastSuccessAt;
    const searchLastAttemptAt = lastSearchAttempt ?? searchLastSuccessAt;
    const nextSearchAt = nextWebSearchAt(now, searchMode, searchLastAttemptAt, searchUsage, c.env);
    const estimatedMonthlyRequests = getEstimatedMonthlyRequests(searchMode, c.env, 1);
    const estimatedMonthlyGrossCostUsd = searchProvider === 'brave'
      ? getEstimatedMonthlyGrossCostUsd(searchMode, c.env, 1)
      : null;
    const monthlyCreditUsd = searchProvider === 'brave' ? getBraveMonthlyCreditUsd(c.env) : null;

    const sourceConfigured = xApiSnapshot.automaticSync || canUseSearchProvider(c.env);
    if (!dbConnected) {
      overallStatus = 'error';
    } else if (!sourceConfigured) {
      overallStatus = 'degraded';
    } else if (!llmConfigured) {
      overallStatus = 'degraded';
    } else if ((!xApiSnapshot.automaticSync && (searchStatus?.status === 'down' || searchStatus?.status === 'degraded'))
      || llmStatus === 'down' || llmStatus === 'degraded') {
      overallStatus = 'degraded';
    } else if (!xApiSnapshot.automaticSync && canUseSearchProvider(c.env) && isWebSearchOverdue(now, searchLastSuccessAt, searchMode, c.env, searchUsage)) {
      overallStatus = 'degraded';
    } else if (xApiSnapshot.automaticSync && ['down', 'degraded', 'stale'].includes(xApiSnapshot.status)) {
      overallStatus = 'degraded';
    } else if (lastRun?.status === 'failed' || !!lastRun?.error_message) {
      overallStatus = 'degraded';
    } else {
      overallStatus = 'ok';
    }

    const sourceProvider = xApiSnapshot.automaticSync
      ? {
        name: 'x_api',
        configured: xApiSnapshot.configured,
        status: xApiSnapshot.status,
        lastSuccessAt: xApiSnapshot.lastSuccessAt,
      }
      : {
        name: WEB_SEARCH_PROVIDER_KEY,
        configured: canUseSearchProvider(c.env),
        status: searchStatus?.status ?? 'not_configured',
        lastSuccessAt: searchLastSuccessAt,
      };

    const xApiStatusPayload = {
      ...xApiSnapshot,
      lastAuthoritativeSync: xApiSnapshot.lastSuccessAt,
    };
    const webSearchStatusPayload = {
      name: WEB_SEARCH_PROVIDER_KEY,
      provider: searchProvider,
      configured: canUseSearchProvider(c.env),
      status: searchStatus?.status ?? 'not_configured',
      lastSuccessAt: searchLastSuccessAt,
      lastFetchAt: searchUsage.lastFetchAt,
      dailyLimit: getWebSearchDailyLimit(c.env),
      usedToday: searchUsage.usedToday,
      requestsToday: searchUsage.usedToday,
      currentMode: searchMode,
      nextSearchAt,
      estimatedMonthlyRequests,
      estimatedMonthlyGrossCostUsd,
      monthlyCreditUsd,
    };

    // Build classifier info
    const classifier = {
      name: 'llm',
      configured: llmConfigured,
      status: llmStatus,
      lastSuccessAt: hasLLM?.last_success_at ?? null,
    };

    return c.json({
      status: overallStatus,
      version: '0.1.0',
      // Workers do not expose a stable process uptime. Returning the epoch
      // timestamp here was misleading; callers can use checkedAt instead.
      uptime: null,
      lastRun,
      dbConnected,
      sourceProvider,
      xApi: xApiStatusPayload,
      webSearch: webSearchStatusPayload,
      classifier,
      providers: {
        xApi: xApiStatusPayload,
        webSearch: webSearchStatusPayload,
        classifier,
      },
      lastSuccessfulCron: lastSuccessfulRun?.finished_at ?? null,
      lastSourceFetch: xApiSnapshot.automaticSync
        ? xApiSnapshot.lastSuccessAt
        : searchLastSuccessAt,
      lastEventAt: latestEvent?.published_at ?? latestEvent?.created_at ?? null,
      checkedAt: now.toISOString(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[API] GET /health error: ${msg}`);
    const errorXApi = {
      name: 'x_api',
      configured: false,
      automaticSync: false,
      status: 'unknown',
      sourceRole: 'primary',
      lastSuccessAt: null,
      lastFetchAt: null,
      lastAttemptAt: null,
      lastNewPostAt: null,
      pollIntervalMinutes: 15,
      nextPollAt: null,
      dailyLimit: 96,
      usedToday: 0,
      nextScheduledSync: null,
      rateLimitRemaining: null,
      rateLimitResetAt: null,
      observedPostsToday: 0,
    };
    const errorWebSearch = {
      name: 'web_search',
      configured: false,
      status: 'unknown',
      lastSuccessAt: null,
      lastFetchAt: null,
      dailyLimit: 6,
      usedToday: 0,
      requestsToday: 0,
      currentMode: 'NORMAL',
      nextSearchAt: null,
      estimatedMonthlyRequests: 180,
      estimatedMonthlyGrossCostUsd: null,
      monthlyCreditUsd: null,
    };
    const errorClassifier = { name: 'llm', configured: false, status: 'unknown', lastSuccessAt: null };
    return c.json({
      status: 'error',
      version: '0.1.0',
      uptime: null,
      lastRun: null,
      dbConnected: false,
      sourceProvider: { name: WEB_SEARCH_PROVIDER_KEY, configured: false, status: 'unknown', lastSuccessAt: null },
      xApi: errorXApi,
      webSearch: errorWebSearch,
      classifier: errorClassifier,
      providers: {
        xApi: errorXApi,
        webSearch: errorWebSearch,
        classifier: errorClassifier,
      },
      lastSuccessfulCron: null,
      lastSourceFetch: null,
      lastEventAt: null,
      checkedAt: new Date().toISOString(),
    }, 500);
  }
});

// GET /api/reset/current - Current reset cycle status
api.get('/reset/current', async (c) => {
  const repo = new Repository(c.env.DB);

  try {
    // The page can be opened between scheduled Cron runs. Advance due/expired
    // cycles here as well so the public state is correct at read time.
    await repo.advanceResetCycleState(new Date().toISOString());
    const [rawManualResetReport, latestDirectReset] = await Promise.all([
      repo.getLatestManualResetReport(),
      repo.getLatestDirectResetEvent(),
    ]);
    const manualResetReport = effectiveManualResetReport(rawManualResetReport, latestDirectReset);
    const directResetSupersedesManual = directResetSupersedesManualReport(latestDirectReset, rawManualResetReport);

    // Query the most recent active reset cycle
    const cycle = await c.env.DB
      .prepare(`
        SELECT rc.*,
          me.published_at AS planned_published_at,
          te.published_at AS time_changed_published_at
        FROM reset_cycles rc
        LEFT JOIN monitor_events me ON me.id = rc.planned_event_id
        LEFT JOIN monitor_events te ON te.id = rc.time_changed_event_id
        WHERE rc.status IN ('SCHEDULED', 'DUE', 'CONFIRMING', 'TIME_CHANGED')
          AND rc.verification_status <> 'REJECTED'
          AND (
            rc.expected_reset_at IS NOT NULL
            OR COALESCE((
              SELECT MAX(julianday(COALESCE(lifecycle.published_at, lifecycle.created_at)))
              FROM monitor_events lifecycle
              WHERE lifecycle.id = rc.planned_event_id
                 OR lifecycle.id = rc.time_changed_event_id
            ), julianday(rc.created_at)) >= julianday('now', '-48 hours')
          )
        ORDER BY CASE
          WHEN rc.expected_reset_at IS NOT NULL THEN julianday(rc.expected_reset_at)
          ELSE COALESCE((
            SELECT MAX(julianday(COALESCE(lifecycle.published_at, lifecycle.created_at)))
            FROM monitor_events lifecycle
            WHERE lifecycle.id = rc.planned_event_id
               OR lifecycle.id = rc.time_changed_event_id
          ), julianday(rc.created_at))
        END DESC, rc.id DESC
        LIMIT 1
      `)
      .first();

    // A direct completion may be discovered after a Telegram report and
    // before the lifecycle row is promoted (for example after a partial
    // worker failure). Never let the manual fallback mask that evidence.
    if (latestDirectReset && directResetSupersedesManual && (!cycle || cycle.status !== 'CONFIRMED')) {
      return c.json(directResetResponse(latestDirectReset));
    }

    if (manualReportIsNewer(manualResetReport, cycle as Record<string, unknown> | null)) {
      return c.json(manualResetResponse(manualResetReport!));
    }

    if (!cycle) {
      // Check if there's a confirmed cycle (most recent)
      const confirmed = await c.env.DB
        .prepare(`
          SELECT * FROM reset_cycles
          WHERE status = 'CONFIRMED'
            AND verification_status <> 'REJECTED'
            AND julianday(COALESCE(confirmed_reset_at, created_at)) >= julianday('now', '-48 hours')
          ORDER BY julianday(COALESCE(confirmed_reset_at, created_at)) DESC, id DESC
          LIMIT 1
        `)
        .first();

      if (confirmed) {
        const confirmedEvidence = confirmed as Record<string, unknown>;
        if (manualReportIsNewer(manualResetReport, confirmedEvidence)) {
          return c.json(manualResetResponse(manualResetReport!));
        }

        const evidence_count = await c.env.DB
          .prepare('SELECT COUNT(*) as count FROM reset_confirmation_evidence WHERE reset_cycle_id = ?')
          .bind(confirmed.id)
          .first<{ count: number }>();

        return c.json({
          status: 'CONFIRMED',
          expectedResetAt: confirmed.expected_reset_at,
          expectedResetTimeText: confirmed.expected_reset_time_text,
          isApproximate: confirmed.is_approximate === 1,
          resetSource: confirmed.reset_source,
          resetSourceUrl: confirmed.reset_source_url,
          verificationStatus: confirmed.verification_status ?? 'DIRECT_VERIFIED',
          manualReset: toPublicManualResetReport(manualResetReport),
          confirmation: {
            type: confirmed.confirmation_type,
            confidence: confirmed.confirmation_confidence,
            confirmedAt: confirmed.confirmed_reset_at,
            sourceUrl: confirmed.reset_source_url,
            lastCheckedAt: confirmed.confirmation_checked_at,
            evidenceCount: evidence_count?.count ?? 0,
          },
        });
      }

      return c.json({
        status: 'NONE',
        expectedResetAt: null,
        expectedResetTimeText: null,
        isApproximate: false,
        resetSource: null,
        resetSourceUrl: null,
        manualReset: toPublicManualResetReport(manualResetReport),
        confirmation: {
          type: 'NONE',
          lastCheckedAt: null,
        },
      });
    }

    return c.json({
      status: cycle.status,
      expectedResetAt: cycle.expected_reset_at,
      expectedResetTimeText: cycle.expected_reset_time_text,
      isApproximate: cycle.is_approximate === 1,
      resetSource: cycle.reset_source,
      resetSourceUrl: cycle.reset_source_url,
      verificationStatus: cycle.verification_status ?? 'DIRECT_VERIFIED',
      manualReset: toPublicManualResetReport(manualResetReport),
      confirmation: {
        type: cycle.confirmation_type,
        lastCheckedAt: cycle.confirmation_checked_at,
        confirmedAt: cycle.confirmed_reset_at,
        evidenceCount: cycle.confirmation_evidence_count ?? 0,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[API] GET /reset/current error: ${msg}`);
    return c.json({
      status: 'ERROR',
      expectedResetAt: null,
      expectedResetTimeText: null,
      isApproximate: false,
      resetSource: null,
      resetSourceUrl: null,
      manualReset: null,
      confirmation: { type: 'NONE', lastCheckedAt: null },
      error: 'Internal server error',
    }, 500);
  }
});

export default api;
