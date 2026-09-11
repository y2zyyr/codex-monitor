// ============================================================
// Tibo Monitor - Direct-first source orchestration
// ============================================================
import type {
  ClassificationDecisionTrace,
  ClassificationOutcome,
  ClassificationProvider,
  ClassificationReasonCode,
  Env,
  SourcePost,
} from './types';
import { Repository } from './db/repository';
import { recordReviewAlert } from './review';
import {
  buildCompletedResetHintResult,
  buildObviousIrrelevantResult,
  buildSoftResetHintResult,
  applyTrustedResetContext,
  CLASSIFIER_VERSION,
  getStrongResetSignal,
  hasCredibleActiveResetContext,
  getTrustedSourceContext,
  hasExplicitCodexReference,
  isCompletedResetHint,
  isCodexProductSignalAdmissible,
  isNeedsReviewStrongResetSignal,
  isObviousIrrelevant,
  isSoftResetHint,
  isTrustedContextualResetWithContext,
  keywordPrefilter,
} from './classifier/types';
import {
  boundedClassificationError,
  isClassificationRetryEligible,
  normalizeClassificationFailureKind,
} from './classifier/retry';
import type { SocialSourceProvider, SearchResult, WebSearchProvider } from './providers/types';
import {
  XApiProvider,
  reserveXApiFetch,
  X_API_PROVIDER_KEY,
  XApiPartialFailureError,
  MAX_X_BACKFILL_PAGES,
  type XApiAccountBatch,
} from './providers/x-api';
import {
  getAdaptiveSearchQueries,
  getReplySupplementQueries,
  getXPostPublishedAt,
  monitoredAccounts,
  normalizeDiscoveryResults,
  ProviderBudgetExceededError,
  WEB_SEARCH_PROVIDER_KEY,
  WEB_SEARCH_SUPPLEMENT_PROVIDER_KEY,
} from './providers/search-provider';
import { evaluateCommunityEvidence } from './confirmation';
import {
  providerUsageDate,
  shouldRunXApiSync,
  isXApiSyncOverdue,
  nextScheduledXSyncAt,
  isXApiAutomaticSyncEnabled,
} from './utils/schedule';
import {
  getWebSearchDailyLimit,
  getWebSearchFallbackBackoffMinutes,
  getWebSearchMode,
  getWebSearchIntervalHours,
  getWebSearchSupplementDailyLimit,
  nextWebSearchAt,
  shouldRunSupplementalWebSearch,
  shouldRunWebSearch,
} from './utils/search-schedule';
import type { WebSearchMode } from './utils/search-schedule';

// Bound sequential classifier wall time: at most eight 30-second calls.
// Realtime posts precede backfill; reset hints rank first within each group.
const MAX_CLASSIFICATIONS_PER_RUN = 8;

export function getClassificationBudgetPerRun(env: Env): number {
  const configured = Number(env.CLASSIFICATIONS_PER_RUN ?? MAX_CLASSIFICATIONS_PER_RUN);
  return Number.isFinite(configured) ? Math.max(0, Math.min(MAX_CLASSIFICATIONS_PER_RUN, Math.floor(configured))) : MAX_CLASSIFICATIONS_PER_RUN;
}

type XUsageSnapshot = NonNullable<Awaited<ReturnType<Repository['getProviderUsage']>>> & {
  rate_limit_remaining: number | null;
  rate_limit_reset_at: string | null;
};

export interface CronResult {
  status: 'completed' | 'failed';
  postsChecked: number;
  candidatesFound: number;
  eventsCreated: number;
  xApiCalls: number;
  webSearchCalls: number;
  llmClassifications: number;
  classificationByCategory: Record<string, number>;
  xSync: {
    attempted: boolean;
    skipped: boolean;
    reason: string | null;
    lastFetchAt?: string | null;
    nextScheduledAt?: string | null;
  };
  search: {
    status: 'ok' | 'degraded' | 'not_configured';
    error: string | null;
    mode: WebSearchMode;
    skipped: boolean;
    reason: string | null;
    nextSearchAt: string | null;
  };
  xIngestionProbe: XIngestionProbeResult | null;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface CronOptions {
  searchProvider?: WebSearchProvider;
  xApiProvider?: XApiProvider;
  now?: Date;
}

/**
 * Execute one scheduled run. The old sourceProvider argument remains as a
 * compatibility seam for local callers; production passes null and uses the
 * separate WebSearchProvider + XApiProvider options.
 */
export async function executeCron(
  env: Env,
  sourceProvider: SocialSourceProvider | null,
  classifier: ClassificationProvider,
  options: CronOptions = {},
): Promise<CronResult> {
  const repo = new Repository(env.DB);
  const startedAt = new Date().toISOString();
  const now = options.now ?? new Date(startedAt);
  const errors: string[] = [];
  let runId: number | null = null;
  let postsChecked = 0;
  let candidatesFound = 0;
  let eventsCreated = 0;
  let xApiCalls = 0;
  let webSearchCalls = 0;
  let llmClassifications = 0;
  const classificationByCategory: Record<string, number> = {};
  let classificationBudget = getClassificationBudgetPerRun(env);
  let searchStatus: 'ok' | 'degraded' | 'not_configured' = options.searchProvider ? 'ok' : 'not_configured';
  let searchError: string | null = null;
  let xSyncReason: string | null = null;
  let xSyncAttempted = false;
  let xSyncSkipped = true;
  let lastXFetchAt: string | null = null;
  let xLastSuccessAt: string | null = null;
  let xSyncFailedThisRun = false;
  let xFailureCount = 0;
  let xApiNewPostsThisRun = 0;
  let xUsage: XUsageSnapshot | null = null;
  let searchMode: WebSearchMode = 'NORMAL';
  let searchSkipped = !!options.searchProvider;
  let searchSkipReason: string | null = options.searchProvider ? 'not_due' : 'not_configured';
  let searchLastAttemptAt: string | null = null;
  let searchSupplementalLastAt: string | null = null;
  let searchUsage: { request_count?: number; usedToday?: number; last_request_at?: string | null; last_request_slot?: string | null } | null = null;
  let ingestionProbe: XIngestionProbeResult | null = null;

  try {
    runId = await repo.insertRun({
      started_at: startedAt,
      finished_at: null,
      status: 'running',
      posts_checked: 0,
      candidates_found: 0,
      events_created: 0,
      x_api_calls: 0,
      web_search_calls: 0,
      llm_classifications: 0,
      error_message: null,
    });

    // Persist the due transition before choosing cadence. This keeps the
    // confirmation mode stable across worker restarts and Cron boundaries.
    await repo.advanceResetCycleState(now.toISOString());
    const activeCycle = await repo.getActiveResetCycle({ advance: false });
    const activeCodexReset = hasCredibleActiveResetContext(activeCycle)
      || await repo.hasRecentTrustedResetPlan(now);
    const classificationContext = {
      activeCodexReset,
    };
    searchMode = getWebSearchMode(activeCycle, now);
    const accounts = monitoredAccounts(env);
    const discoveryResults: SearchResult[] = [];
    const newCandidates: SourcePost[] = [];
    // A due probe takes this slot before normal intake. Otherwise a healthy
    // 15-minute poll consumes every slot and the probe can never run. Both
    // share the unchanged daily cap; next intake catches up from its cursor.
    if (options.xApiProvider && isXApiAutomaticSyncEnabled(env)) {
      const lastProbeAt = await repo.getSetting('x_ingestion_probe_last_at');
      const lastProbeAttemptAt = await repo.getSetting('x_ingestion_probe_last_attempt_at');
      if (shouldRunXIngestionProbe(now, lastProbeAt, lastProbeAttemptAt, env).allowed) {
        ingestionProbe = await probeXIngestionCompleteness(env, { now });
      }
    }

    if (ingestionProbe?.reservationsUsed) xApiCalls += ingestionProbe.reservationsUsed;
    xUsage = await getXUsageSnapshot(repo, providerUsageDate(now));
    xLastSuccessAt = await repo.getSetting('x_api_last_success_at') ?? xUsage?.last_success_at ?? null;
    xFailureCount = parseCounter(await repo.getSetting('x_api_consecutive_failures'));

    // 1. Official X timeline first. The provider only fetches batches; raw
    // posts are written and deduplicated before each account cursor advances.
    const xApiAutomaticSync = !!options.xApiProvider && isXApiAutomaticSyncEnabled(env);
    if (options.xApiProvider && xApiAutomaticSync) {
      const usageDate = providerUsageDate(now);
      const decision = shouldRunXApiSync(now, xUsage, env);
      xSyncReason = decision.reason === 'allowed' ? null : decision.reason;
      if (decision.allowed) {
        const lockValue = await repo.acquireLock('x_api_sync_lock', now, 600);
        if (!lockValue) {
          xSyncReason = 'lock_unavailable';
        } else {
          try {
            const reservation = await reserveXApiFetch(repo, env, now);
            if (!reservation) {
              xSyncReason = 'daily_budget_exhausted_or_concurrent_trigger';
            } else {
              xSyncAttempted = true;
              xSyncSkipped = false;
              xApiCalls += 1;
              lastXFetchAt = now.toISOString();
              await repo.setSetting('x_api_last_attempt_at', lastXFetchAt);

              try {
                const batch = await options.xApiProvider.fetchIncremental({
                  reservationAlreadyHeld: true,
                  reservation,
                  now,
                });
                const persisted = await persistXAccountBatches(repo, batch.accounts, now);
                postsChecked += persisted.postsChecked;
                candidatesFound += persisted.candidatesFound;
                newCandidates.push(...persisted.newCandidates);
                errors.push(...persisted.errors);
                await persistXRateLimit(repo, batch.accounts);

                if (persisted.errors.length > 0) throw new Error(persisted.errors.join('; '));

                await repo.recordProviderUsageSuccess(X_API_PROVIDER_KEY, usageDate, now.toISOString());
                await repo.setSetting('x_api_last_success_at', now.toISOString());
                await repo.setSetting('x_api_consecutive_failures', '0');
                await repo.setSetting('web_search_fallback_failures', '0');
                await repo.setSetting('web_search_fallback_last_attempt', '');
                xLastSuccessAt = now.toISOString();
                xFailureCount = 0;
                xApiNewPostsThisRun = persisted.newPosts;
                if (persisted.newPosts > 0) await repo.setSetting('x_api_last_new_post_at', now.toISOString());
                await repo.recordProviderStatus(X_API_PROVIDER_KEY, 'ok', now.toISOString(), null);
              } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                xSyncFailedThisRun = true;
                xFailureCount = await recordXApiFailure(repo, xFailureCount, now);
                if (error instanceof XApiPartialFailureError) {
                  // Healthy accounts are retained; incomplete accounts do not
                  // advance their cursor and will be retried on the next slot.
                  const persisted = await persistXAccountBatches(repo, error.accounts, now);
                  postsChecked += persisted.postsChecked;
                  candidatesFound += persisted.candidatesFound;
                  newCandidates.push(...persisted.newCandidates);
                  errors.push(...persisted.errors);
                  await persistXRateLimit(repo, error.accounts);
                  errors.push(`X authoritative sync degraded: ${message}`);
                  await repo.recordProviderStatus(X_API_PROVIDER_KEY, 'degraded', null, message);
                  xApiNewPostsThisRun = Math.max(xApiNewPostsThisRun, persisted.newPosts);
                  if (persisted.newPosts > 0) await repo.setSetting('x_api_last_new_post_at', now.toISOString());
                } else {
                  errors.push(`X authoritative sync failed: ${message}`);
                  await repo.recordProviderStatus(X_API_PROVIDER_KEY, 'down', null, message);
                }
              }
            }
          } finally {
            await repo.releaseLock('x_api_sync_lock', lockValue);
          }
        }
      }
    } else if (options.xApiProvider) {
      xSyncReason = 'automatic_sync_disabled';
    }


    xUsage = await getXUsageSnapshot(repo, providerUsageDate(now));
    searchLastAttemptAt = await repo.getSetting('web_search_last_attempt');
    searchSupplementalLastAt = await repo.getSetting('web_search_supplemental_last_attempt');
    searchUsage = await repo.getProviderUsage(WEB_SEARCH_PROVIDER_KEY, providerUsageDate(now));

    // 2. Indexed search is a low-frequency backstop. It may run on its normal
    // cadence, or earlier when the direct source failed/is stale and the
    // exponential fallback backoff allows another attempt.
    if (options.searchProvider) {
      const normalDecision = shouldRunWebSearch(now, searchMode, searchLastAttemptAt, searchUsage, env);
      const directNeedsFallback = xApiAutomaticSync && (
        xSyncFailedThisRun
        || isXApiSyncOverdue(now, xLastSuccessAt, env, xUsage)
      );
      const fallbackLastAttemptAt = await repo.getSetting('web_search_fallback_last_attempt');
      const fallbackFailures = parseCounter(await repo.getSetting('web_search_fallback_failures'));
      const fallbackBackoffMinutes = getWebSearchFallbackBackoffMinutes(fallbackFailures);
      const fallbackBackoffElapsed = !fallbackLastAttemptAt
        || Number.isNaN(new Date(fallbackLastAttemptAt).getTime())
        || now.getTime() >= new Date(fallbackLastAttemptAt).getTime() + fallbackBackoffMinutes * 60_000;
      const fallbackAllowed = directNeedsFallback
        && fallbackBackoffElapsed
        && (searchUsage?.request_count ?? searchUsage?.usedToday ?? 0) < getWebSearchDailyLimit(env);
      const shouldSearch = normalDecision.allowed || fallbackAllowed;
      searchSkipReason = shouldSearch ? null : (normalDecision.reason === 'allowed' ? 'fallback_backoff' : normalDecision.reason);
      if (shouldSearch) {
        const remainingBudget = Math.max(0, getWebSearchDailyLimit(env) - (searchUsage?.request_count ?? 0));
        const queries = getAdaptiveSearchQueries(accounts, now, searchMode, getWebSearchIntervalHours(searchMode, env)).slice(0, remainingBudget);
        if (queries.length === 0) {
          searchSkipReason = 'daily_budget_exhausted';
        } else {
          searchSkipped = false;
          searchLastAttemptAt = now.toISOString();
          await repo.setSetting('web_search_last_attempt', searchLastAttemptAt);
          if (fallbackAllowed) await repo.setSetting('web_search_fallback_last_attempt', searchLastAttemptAt);
          try {
            for (const query of queries) {
              try {
                discoveryResults.push(...await options.searchProvider.search(query, now));
                // Increment only after the provider call was made. A budget
                // rejection happens before HTTP and must not be counted.
                webSearchCalls++;
              } catch (error) {
                if (!(error instanceof ProviderBudgetExceededError)) webSearchCalls++;
                throw error;
              }
            }
            searchStatus = 'ok';
            await repo.setSetting('web_search_last_success', now.toISOString());
            if (fallbackAllowed) await repo.setSetting('web_search_fallback_failures', '0');
            await repo.recordProviderStatus(WEB_SEARCH_PROVIDER_KEY, 'ok', now.toISOString(), null);
          } catch (error) {
            if (error instanceof ProviderBudgetExceededError) {
              searchSkipped = true;
              searchSkipReason = 'daily_budget_exhausted_or_concurrent_trigger';
              searchError = null;
            } else {
              searchStatus = 'degraded';
              searchError = error instanceof Error ? error.message : String(error);
              errors.push(`Web search degraded: ${searchError}`);
              if (fallbackAllowed) await repo.setSetting('web_search_fallback_failures', String(fallbackFailures + 1));
              await repo.recordProviderStatus(WEB_SEARCH_PROVIDER_KEY, 'degraded', null, searchError);
            }
          }
        }
      }
    } else if (sourceProvider) {
      // Legacy/test adapter only. It is not selected by the production entrypoint.
      searchSkipped = false;
      searchSkipReason = null;
      try {
        webSearchCalls++;
        const legacyPosts = await sourceProvider.fetchLatestPosts();
        for (const post of legacyPosts) discoveryResults.push({
          title: post.text,
          snippet: '',
          url: post.source_url,
          publishedAt: post.published_at,
          raw: post.raw_json,
        });
        searchStatus = 'ok';
      } catch (error) {
        searchStatus = 'degraded';
        searchError = error instanceof Error ? error.message : String(error);
        errors.push(`Legacy source degraded: ${searchError}`);
      }
    }

    // 2b. Reply-supplement search. The direct X timeline is the primary channel
    // and now keeps replies (x-api.ts), but web indexes are the only backstop
    // for posts the API never returned before replies were retained. The gate
    // is wider than the old active-mode-only check so a bare "Reset done."
    // reply with no prior plan is re-checked through web indexes in NORMAL
    // mode too (see shouldRunSupplementalWebSearch). It draws on its own small
    // daily pool, shares the per-run cooldown, never double-runs the normal
    // cadence search in the same tick (searchSkipped), and fails closed.
    if (options.searchProvider && xApiAutomaticSync && !xSyncFailedThisRun && searchSkipped) {
      const supplementUsage = await repo.getProviderUsage(WEB_SEARCH_SUPPLEMENT_PROVIDER_KEY, providerUsageDate(now));
      const recentResetWithoutEvent = await repo.hasRecentDirectResetSignalWithoutEvent(24, now);
      const supplementalDecision = shouldRunSupplementalWebSearch(
        now,
        searchMode,
        searchSupplementalLastAt,
        supplementUsage,
        env,
        { lastMainSearchAt: searchLastAttemptAt, recentResetWithoutEvent },
      );
      if (!supplementalDecision.allowed && supplementalDecision.reason !== 'interval_not_elapsed') {
        // The supplement is a backstop, not the primary channel: when it is
        // actively disabled/exhausted or has no trigger, keep the run's
        // skipped state as-is (the regular search remains the visible reason).
        searchSkipReason = searchSkipReason ?? supplementalDecision.reason;
      }
      if (supplementalDecision.allowed) {
        const remainingBudget = Math.max(0, getWebSearchSupplementDailyLimit(env) - (supplementUsage?.request_count ?? 0));
        const queries = getReplySupplementQueries(accounts, now).slice(0, remainingBudget);
        if (queries.length === 0) {
          searchSkipReason = 'daily_budget_exhausted';
        } else {
          searchSkipped = false;
          searchSkipReason = null;
          searchSupplementalLastAt = now.toISOString();
          await repo.setSetting('web_search_supplemental_last_attempt', searchSupplementalLastAt);
          try {
            for (const query of queries) {
              try {
                discoveryResults.push(...await options.searchProvider.search(query, now));
                // Increment only after the provider call was made. A budget
                // rejection happens before HTTP and must not be counted.
                webSearchCalls++;
              } catch (error) {
                if (!(error instanceof ProviderBudgetExceededError)) webSearchCalls++;
                throw error;
              }
            }
            searchStatus = 'ok';
            await repo.setSetting('web_search_last_success', now.toISOString());
            await repo.recordProviderStatus(WEB_SEARCH_PROVIDER_KEY, 'ok', now.toISOString(), null);
          } catch (error) {
            if (error instanceof ProviderBudgetExceededError) {
              searchSkipped = true;
              searchSkipReason = 'daily_budget_exhausted_or_concurrent_trigger';
              searchError = null;
            } else {
              searchStatus = 'degraded';
              searchError = error instanceof Error ? error.message : String(error);
              errors.push(`Web search degraded (reply supplement): ${searchError}`);
              await repo.recordProviderStatus(WEB_SEARCH_PROVIDER_KEY, 'degraded', null, searchError);
            }
          }
        }
      }
    }

    searchUsage = await repo.getProviderUsage(WEB_SEARCH_PROVIDER_KEY, providerUsageDate(now));

    const fetchedAt = now.toISOString();
    const discoveredPosts = options.searchProvider
      ? normalizeDiscoveryResults(discoveryResults, accounts, fetchedAt)
      : discoveryResults.map(resultToLegacyPost).filter((post): post is SourcePost => !!post);
    postsChecked += discoveredPosts.length;

    const newlyDiscoveredPosts: SourcePost[] = [];
    for (const post of discoveredPosts) {
      const upserted = await repo.upsertSourcePost(post, fetchedAt);
      if (upserted.isNew) newlyDiscoveredPosts.push({ ...post, id: upserted.id });
    }
    const orderedDiscoveredPosts = prioritizeCandidates(newlyDiscoveredPosts);
    newCandidates.push(...orderedDiscoveredPosts);
    candidatesFound += orderedDiscoveredPosts.length;

    // 3. Candidate classification and pending retries. All direct/search raw
    // rows have been persisted before this phase starts. Keep a local set so
    // the D1 recovery pass below cannot classify the same post twice in one
    // run.
    const classifiedPostIds = new Set<number>();
    for (const candidate of newCandidates) {
      if (classificationBudget <= 0) break;
      if (candidate.id !== undefined) classifiedPostIds.add(candidate.id);
      if (!isObviousIrrelevant(candidate)) llmClassifications++;
      const outcome = await classifyAndCreateEvent(repo, classifier, candidate, now, classificationContext);
      recordClassificationCategory(classificationByCategory, outcome.outcome);
      if (outcome.created) eventsCreated++;
      if (outcome.outcome.status === 'ERROR') errors.push(`LLM classification failed for source ${candidate.id}: ${formatClassificationFailure(outcome.outcome)}`);
      classificationBudget--;
    }
    if (classificationBudget > 0) {
      const pending = await repo.getUnclassifiedPosts(50, now);
      for (const post of prioritizeCandidates(pending)) {
        if (classificationBudget <= 0) break;
        if (post.id !== undefined && classifiedPostIds.has(post.id)) continue;
        if (!isClassificationRetryEligible(post, now)) continue;
        if (post.id !== undefined) classifiedPostIds.add(post.id);
        if (!isObviousIrrelevant(post)) llmClassifications++;
        const outcome = await classifyAndCreateEvent(repo, classifier, post, now, classificationContext);
        recordClassificationCategory(classificationByCategory, outcome.outcome);
        if (outcome.created) eventsCreated++;
        if (outcome.outcome.status === 'ERROR') errors.push(`LLM classification failed for source ${post.id}: ${formatClassificationFailure(outcome.outcome)}`);
        classificationBudget--;
      }
    }
    if (classificationBudget > 0) {
      // A prior Worker version may have persisted a direct post and marked it
      // irrelevant before a new deterministic signal rule existed. Revisit
      // only authoritative, event-less rows and only keep rows that match a
      // deterministic completion/soft-hint rule. This repairs that state
      // without spending another X API request.
      const directRecoveryCandidates = await repo.getDirectPostsWithoutEvents(50);
      for (const post of directRecoveryCandidates) {
        if (classificationBudget <= 0) break;
        if (post.id !== undefined && classifiedPostIds.has(post.id)) continue;
        if (post.classification_pending && !isClassificationRetryEligible(post, now)) continue;
        if (!isCompletedResetHint(post) && !isSoftResetHint(post) && !isTrustedContextualResetWithContext(post, classificationContext)) continue;
        if (post.id !== undefined) classifiedPostIds.add(post.id);
        candidatesFound++;
        if (!isObviousIrrelevant(post)) llmClassifications++;
        const outcome = await classifyAndCreateEvent(repo, classifier, post, now, classificationContext);
        recordClassificationCategory(classificationByCategory, outcome.outcome);
        if (outcome.created) eventsCreated++;
        if (outcome.outcome.status === 'ERROR') errors.push(`LLM classification failed for recovered source ${post.id}: ${formatClassificationFailure(outcome.outcome)}`);
        classificationBudget--;
      }
    }

    // 4. Confirming mode uses the same adaptive search request. Direct X data
    // has already been ingested and therefore wins indexed evidence.
    if (options.searchProvider && activeCycle && searchMode === 'CONFIRMING_RESET' && !searchSkipped && searchStatus === 'ok') {
      await processConfirmationSearch(repo, activeCycle, discoveryResults, now);
    }

    try { await recordReviewAlert(repo, env); } catch { errors.push('REVIEW_ALERT_FAILED'); }
    const finishedAt = new Date().toISOString();
    try { await recordRunDuration(repo, env, startedAt, finishedAt); } catch { errors.push('MONITOR_DURATION_WRITE_FAILED'); }
    const nextSearchAt = nextWebSearchAt(now, searchMode, searchLastAttemptAt, searchUsage, env);
    const errorMessage = errors.length > 0 ? errors.join(' | ') : null;
    console.info('[Cron] classification_by_category', classificationByCategory);
    if (runId !== null) {
      await repo.updateRun(runId, {
        finished_at: finishedAt,
        status: 'completed',
        posts_checked: postsChecked,
        candidates_found: candidatesFound,
        events_created: eventsCreated,
        x_api_calls: xApiCalls,
        web_search_calls: webSearchCalls,
        llm_classifications: llmClassifications,
        error_message: errorMessage,
      });
    }
    return {
      status: 'completed',
      postsChecked,
      candidatesFound,
      eventsCreated,
      xApiCalls,
      webSearchCalls,
      llmClassifications,
      classificationByCategory,
      xSync: {
        attempted: xSyncAttempted,
        skipped: xSyncSkipped,
        reason: xSyncReason,
        lastFetchAt: lastXFetchAt,
        nextScheduledAt: options.xApiProvider && isXApiAutomaticSyncEnabled(env)
          ? nextScheduledXSyncAt(now, env, xUsage)
          : null,
      },
      search: {
        status: searchStatus,
        error: searchError,
        mode: searchMode,
        skipped: searchSkipped,
        reason: searchSkipReason,
        nextSearchAt,
      },
      xIngestionProbe: ingestionProbe,
      errorMessage,
      startedAt,
      finishedAt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const finishedAt = new Date().toISOString();
    try { await recordRunDuration(repo, env, startedAt, finishedAt); } catch { errors.push('MONITOR_DURATION_WRITE_FAILED'); }
    if (runId !== null) {
      await repo.updateRun(runId, {
        finished_at: finishedAt,
        status: 'failed',
        posts_checked: postsChecked,
        candidates_found: candidatesFound,
        events_created: eventsCreated,
        x_api_calls: xApiCalls,
        web_search_calls: webSearchCalls,
        llm_classifications: llmClassifications,
        error_message: message,
      });
    }
    return {
      status: 'failed',
      postsChecked,
      candidatesFound,
      eventsCreated,
      xApiCalls,
      webSearchCalls,
      llmClassifications,
      classificationByCategory,
      xSync: {
        attempted: xSyncAttempted,
        skipped: xSyncSkipped,
        reason: xSyncReason,
        lastFetchAt: lastXFetchAt,
        nextScheduledAt: options.xApiProvider && isXApiAutomaticSyncEnabled(env)
          ? nextScheduledXSyncAt(now, env, xUsage)
          : null,
      },
      search: {
        status: searchStatus,
        error: searchError,
        mode: searchMode,
        skipped: searchSkipped,
        reason: searchSkipReason,
        nextSearchAt: nextWebSearchAt(now, searchMode, searchLastAttemptAt, searchUsage, env),
      },
      xIngestionProbe: ingestionProbe,
      errorMessage: message,
      startedAt,
      finishedAt,
    };
  }
}

export async function classifyAndCreateEvent(
  repo: Repository,
  classifier: ClassificationProvider,
  post: SourcePost,
  clock: Date = new Date(),
  classificationContext: { activeCodexReset?: boolean } = {},
): Promise<{ created: boolean; outcome: ClassificationOutcome }> {
  const now = clock.toISOString();
  try {
    const completedResetResult = isCompletedResetHint(post)
      ? buildCompletedResetHintResult(post)
      : null;
    const softResetResult = isSoftResetHint(post)
      ? buildSoftResetHintResult(post)
      : null;
    const obviousIrrelevantResult = isObviousIrrelevant(post)
      ? buildObviousIrrelevantResult(post)
      : null;
    const classifierOutcome: ClassificationOutcome = obviousIrrelevantResult
      ? { status: 'SUCCESS', result: obviousIrrelevantResult }
      : await classifier.classify(post);
    if (!obviousIrrelevantResult) await recordClassifierStatus(repo, classifierOutcome, now);
    const contextualClassification = applyTrustedResetContext(post, classifierOutcome, classificationContext);
    // Explicit direct completion language is deterministic enough to keep
    // even when the LLM is unavailable. This protects the source-of-truth
    // signal from both transient classifier failures and model drift.
    if (classifierOutcome.status === 'ERROR'
      && contextualClassification.outcome.status === 'ERROR'
      && !completedResetResult
      && !softResetResult) {
      await persistClassificationTrace(repo, post, buildClassificationTrace(
        post,
        classifierOutcome,
        false,
        contextualClassification.sourceContext,
      ));
      await persistClassificationRetry(repo, post, now, classifierOutcome);
      return { created: false, outcome: classifierOutcome };
    }

    // Deterministic completion wins over the LLM. A direct post can also be
    // an important early warning without being a formal announcement; keep
    // that low-confidence planned hint even when the classifier is uncertain
    // or temporarily unavailable.
    const outcome: ClassificationOutcome = completedResetResult
      ? { status: 'SUCCESS', result: completedResetResult }
      : softResetResult
      ? { status: 'SUCCESS', result: softResetResult }
      : contextualClassification.outcome;
    if (outcome.status === 'ERROR') {
      await persistClassificationTrace(repo, post, buildClassificationTrace(
        post,
        outcome,
        false,
        contextualClassification.sourceContext,
      ));
      await persistClassificationRetry(repo, post, now, outcome);
      return { created: false, outcome };
    }
    const result = outcome.result;
    const hasCodexAnchor = hasExplicitCodexReference(post.text) || contextualClassification.applied;
    if (!result.relevant
      || result.category === 'IRRELEVANT'
      || !isCodexProductSignalAdmissible(result)
      || (result.product_scope === 'CODEX' && !hasCodexAnchor)) {
      // R4/R5: a trusted direct post that reads like a completed Codex reset
      // (strong phrase + broad audience) but lacks the explicit Codex anchor
      // must not be hard-dropped. It is flagged for operator review instead —
      // REVIEW is never a public event, so OBSERVATION stays unpublished and
      // the AGENTS.md "no Codex inference from author alone" invariant is not
      // violated (nothing is published from the flag).
      if (isNeedsReviewStrongResetSignal(post)) {
        await repo.markClassified(post.id!);
        await persistClassificationTrace(repo, post, {
          classification_label: outcome.status === 'SUCCESS' ? outcome.result.category : 'NEEDS_REVIEW',
          classification_decision: 'REVIEW',
          classification_reason_code: 'NEEDS_REVIEW',
          classification_source_context: contextualClassification.sourceContext,
          classification_event_created: false,
          classifier_version: CLASSIFIER_VERSION,
        });
        return { created: false, outcome };
      }
      await repo.markClassified(post.id!);
      await persistClassificationTrace(repo, post, buildClassificationTrace(
        post,
        outcome,
        false,
        contextualClassification.sourceContext,
        contextualClassification.applied,
      ));
      return { created: false, outcome };
    }

    const sourceQuality = post.source_quality ?? 'DIRECT';
    const verificationStatus = sourceQuality === 'INDEXED'
      ? 'INDEXED_ONLY'
      : sourceQuality === 'OFFICIAL' ? 'OFFICIAL_VERIFIED' : 'DIRECT_VERIFIED';
    const eventId = await repo.insertEvent({
      source_post_id: post.id!,
      category: result.category,
      title_en: result.title_en,
      title_zh: result.title_zh,
      summary_en: result.summary_en,
      summary_zh: result.summary_zh,
      confidence: result.confidence,
      published_at: post.published_at,
      effective_at: result.effective_time,
      reset_at: result.reset_time,
      source_url: post.source_url,
      source_quality: sourceQuality,
      evidence_quality: sourceQuality,
      verification_status: verificationStatus,
      verified_at: sourceQuality === 'INDEXED' ? null : now,
    });
    await repo.markClassified(post.id!);
    await persistClassificationTrace(repo, post, buildClassificationTrace(
      post,
      outcome,
      eventId !== null,
      contextualClassification.sourceContext,
      contextualClassification.applied,
      eventId === null,
    ));
    if (eventId !== null) {
      const event = await repo.getEventById(eventId);
      if (event && isResetLifecycleCategory(result.category)) await repo.handleResetEvent(event);
    }
    return { created: eventId !== null, outcome };
  } catch {
    await persistClassificationTrace(repo, post, {
      classification_label: 'ERROR',
      classification_decision: 'RETRY',
      classification_reason_code: 'CLASSIFIER_ERROR',
      classification_source_context: getTrustedSourceContext(post).sourceContext,
      classification_event_created: false,
      classifier_version: CLASSIFIER_VERSION,
    });
    const safeOutcome: ClassificationOutcome = {
      status: 'ERROR',
      error: 'UNEXPECTED_CLASSIFIER_ERROR',
      errorCode: 'UNEXPECTED_CLASSIFIER_ERROR',
      failureKind: 'CLASSIFIER_OUTPUT_ERROR',
      category: 'ERROR',
    };
    await persistClassificationRetry(repo, post, now, safeOutcome);
    return { created: false, outcome: safeOutcome };
  }
}

async function persistClassificationRetry(
  repo: Repository,
  post: SourcePost,
  attemptedAt: string,
  outcome: Extract<ClassificationOutcome, { status: 'ERROR' }>,
): Promise<void> {
  await repo.updateClassificationRetry(
    post.id!,
    attemptedAt,
    boundedClassificationError(outcome),
    normalizeClassificationFailureKind(outcome),
  );
}

function formatClassificationFailure(outcome: Extract<ClassificationOutcome, { status: 'ERROR' }>): string {
  return `${normalizeClassificationFailureKind(outcome)}:${boundedClassificationError(outcome)}`;
}

type TraceCapableRepository = Repository & {
  recordClassificationDecision?: (id: number, trace: ClassificationDecisionTrace) => Promise<void>;
};

async function persistClassificationTrace(
  repo: Repository,
  post: SourcePost,
  trace: ClassificationDecisionTrace,
): Promise<void> {
  if (!post.id) return;
  const recorder = (repo as unknown as TraceCapableRepository).recordClassificationDecision;
  if (typeof recorder !== 'function') return;
  try {
    await recorder.call(repo, post.id, trace);
  } catch (error) {
    // The event/classification path remains available if an additive trace
    // column is unavailable in an older local database; production gates
    // separately verify that the migration and trace writes are present.
    console.error('[Cron] Failed to persist classification trace:', error);
  }
}

function buildClassificationTrace(
  post: SourcePost,
  outcome: ClassificationOutcome,
  eventCreated: boolean,
  sourceContext: ClassificationDecisionTrace['classification_source_context'],
  contextualApplied = false,
  duplicateEvent = false,
): ClassificationDecisionTrace {
  const classificationLabel = outcome.status === 'SUCCESS' ? outcome.result.category : 'ERROR';
  let reasonCode: ClassificationReasonCode;
  if (outcome.status === 'ERROR') {
    reasonCode = 'CLASSIFIER_ERROR';
  } else if (duplicateEvent) {
    reasonCode = 'DUPLICATE_EVENT';
  } else if (eventCreated) {
    reasonCode = contextualApplied
      ? 'TRUSTED_SOURCE_CONTEXT_APPLIED'
      : isCompletedResetHint(post)
      ? 'DETERMINISTIC_COMPLETED_RESET'
      : isSoftResetHint(post)
      ? 'DETERMINISTIC_SOFT_RESET_HINT'
      : 'EVENT_CREATED';
  } else if (outcome.result.statement_nature === 'OBSERVATION') {
    reasonCode = 'OBSERVATION_NOT_ADMITTED';
  } else if (outcome.result.product_scope === 'CODEX'
    && !hasExplicitCodexReference(post.text)
    && !contextualApplied) {
    reasonCode = 'MISSING_PRODUCT_CONTEXT';
  } else if (['RESET_PLANNED', 'RESET_COMPLETED', 'RESET_TIME_CHANGED', 'POLICY_CHANGE', 'CODEX_UPDATE', 'ROADMAP_HINT', 'FEATURE_DISCUSSION'].includes(outcome.result.category)
    && outcome.result.product_scope !== 'CODEX') {
    reasonCode = outcome.result.product_scope === 'AMBIGUOUS'
      ? 'AMBIGUOUS_PRODUCT_SCOPE'
      : 'NON_CODEX_PRODUCT_SCOPE';
  } else if (sourceContext === 'UNTRUSTED_SOURCE' && /\breset\b|重置/i.test(post.text)) {
    reasonCode = 'UNTRUSTED_SOURCE_CONTEXT';
  } else if (sourceContext === 'TRUSTED_CODEX_SOURCE_AVAILABLE'
    && !getStrongResetSignal(post).strong
    && /\breset\b|重置/i.test(post.text)) {
    reasonCode = 'WEAK_RESET_SIGNAL';
  } else {
    reasonCode = 'NO_PUBLIC_EVENT';
  }
  return {
    classification_label: classificationLabel,
    classification_decision: eventCreated ? 'EVENT_CREATED' : 'NO_EVENT',
    classification_reason_code: reasonCode,
    classification_source_context: sourceContext,
    classification_event_created: eventCreated,
    classifier_version: CLASSIFIER_VERSION,
  };
}

export async function persistXAccountBatches(
  repo: Repository,
  batches: XApiAccountBatch[],
  now: Date,
  options: { advanceCursor?: boolean; backfill?: boolean } = {},
): Promise<{
  postsChecked: number;
  newPosts: number;
  candidatesFound: number;
  newCandidates: SourcePost[];
  errors: string[];
}> {
  const advanceCursor = options.advanceCursor ?? true;
  const fetchedAt = now.toISOString();
  let postsChecked = 0;
  let newPosts = 0;
  let candidatesFound = 0;
  const newCandidates: SourcePost[] = [];
  const newlyPersistedPosts: SourcePost[] = [];
  const errors: string[] = [];

  for (const batch of batches) {
    try {
      for (const post of batch.posts) {
        postsChecked++;
        const upserted = await repo.upsertSourcePost(options.backfill ? { ...post, first_discovered_via: 'backfill' } : post, fetchedAt);
        if (upserted.isNew) {
          newPosts++;
          newlyPersistedPosts.push({ ...post, id: upserted.id });
        }
      }

      if (!batch.complete) {
        errors.push(`${batch.account}: X batch incomplete; cursor was not advanced`);
      } else if (batch.newestId && advanceCursor) {
        // This is deliberately the last operation for the account. If any
        // raw D1 write above fails, the cursor remains unchanged and the next
        // slot safely refetches the batch.
        await repo.advanceXApiCursor(batch.account, batch.newestId);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${batch.account}: raw D1 ingestion failed: ${message}`);
    }
  }

  newCandidates.push(...prioritizeCandidates(newlyPersistedPosts));
  candidatesFound = newlyPersistedPosts.length;
  return { postsChecked, newPosts, candidatesFound, newCandidates, errors };
}

/**
 * One-shot historical backfill. Re-fetches the recent X timeline window
 * WITHOUT the stored since_id cursor so posts that predate the reply-retention
 * fix (x-api.ts) can be ingested. Safety properties:
 *
 * 1. The cursor is never advanced (persistXAccountBatches runs with
 *    advanceCursor=false), so forward incremental syncs are untouched.
 * 2. Ingestion goes through upsertSourcePost, which deduplicates by canonical
 *    post id and preserves the indexed->direct upgrade path; duplicate events
 *    are impossible because monitor_events UNIQUE(source_post_id).
 * 3. `sinceId` (when provided) acts as a bounded lower bound; otherwise the
 *    oldest stored direct X post id is used, and if none exists the provider
 *    fetches the most recent window (bounded by backfill max pages).
 * 4. Newly ingested posts are left classification_pending=true and flow into
 *    the normal classifier queue; no events are fabricated here.
 *
 * Budget metering: one X daily reservation covers the whole run (the provider
 * may still issue up to `maxPages` HTTP page requests plus a user resolution
 * under that single reservation). The run default is 5 pages so a single
 * backfill cannot blow the daily X budget; a `since` bound older than the
 * lookback window is refused unless `force=true` because the required page
 * count is unknowable without first fetching.
 */
export async function backfillHistoricalXTimeline(
  env: Env,
  options: { sinceId?: string; now?: Date; maxPages?: number; force?: boolean } = {},
): Promise<{
  fetchedAt: string;
  newPosts: number;
  postsChecked: number;
  cursorAdvanced: boolean;
  pagesFetched: number;
  reservationsUsed: number;
  httpRequestsUsed: number;
  errors: string[];
}> {
  const repo = new Repository(env.DB);
  const now = options.now ?? new Date();
  const sinceId = options.sinceId ?? (await repo.getOldestDirectXSourcePostId()) ?? undefined;
  if (sinceId && !options.force) {
    const sinceDate = getXPostPublishedAt(sinceId);
    if (!sinceDate || now.getTime() - new Date(sinceDate).getTime() > getBackfillLookbackLimitDays(env) * 86400000) {
      throw new Error(
        `BACKFILL_SINCE_TOO_OLD: since=${sinceId} is from before the ${getBackfillLookbackLimitDays(env)}-day lookback window; pass force=true to backfill it anyway`,
      );
    }
  }

  const provider = new XApiProvider(env, repo);
  const effectiveMaxPages = options.maxPages !== undefined
    ? Math.max(1, Math.min(MAX_X_BACKFILL_PAGES, Math.floor(options.maxPages)))
    : Math.max(1, Math.min(MAX_X_BACKFILL_PAGES, parseCounter(env.X_API_BACKFILL_MAX_PAGES ?? '') || DEFAULT_X_BACKFILL_MAX_PAGES));

  const reservation = await reserveXApiFetch(repo, env, now);
  if (!reservation) return { fetchedAt: now.toISOString(), newPosts: 0, postsChecked: 0, cursorAdvanced: false,
    pagesFetched: 0, reservationsUsed: 0, httpRequestsUsed: 0, errors: ['X_BUDGET_EXHAUSTED'] };
  let batches: XApiAccountBatch[];
  try {
    const batch = await provider.fetchIncremental({ sinceId, ignoreStoredCursor: options.sinceId === undefined,
      backfillMaxPages: effectiveMaxPages, now, reservationAlreadyHeld: true, reservation });
    batches = batch.accounts;
  } catch (error) {
    if (error instanceof XApiPartialFailureError && error.accounts.every(account => account.complete || account.error === 'pagination_limit_reached')) {
      batches = error.accounts;
    } else {
      const accounts = error instanceof XApiPartialFailureError ? error.accounts : [];
      await persistXRateLimit(repo, accounts);
      const code = accounts.some(account => /429|X_RATE_LIMIT_EXHAUSTED/.test(account.error ?? '')) ? 'X_BACKFILL_RATE_LIMITED' : 'X_BACKFILL_FETCH_FAILED';
      await repo.setSetting('x_backfill_warning', code);
      await repo.recordProviderStatus('x-backfill', 'degraded', null, code);
      return { fetchedAt: now.toISOString(), newPosts: 0, postsChecked: 0, cursorAdvanced: false,
        pagesFetched: provider.timelineRequestsUsed, reservationsUsed: 1, httpRequestsUsed: provider.httpRequestsUsed, errors: [code] };
    }
  }
  await persistXRateLimit(repo, batches);
  const persisted = await persistXAccountBatches(repo, batches, now, { advanceCursor: false, backfill: true });
  await repo.setSetting('x_backfill_warning', persisted.errors.length ? 'X_BACKFILL_INCOMPLETE' : '');
  await repo.recordProviderStatus('x-backfill', persisted.errors.length ? 'degraded' : 'ok', now.toISOString(), persisted.errors.length ? 'X_BACKFILL_INCOMPLETE' : null);
  const pagesFetched = batches.reduce((sum, account) => sum + (account.pagesFetched ?? 0), 0);
  return {
    fetchedAt: now.toISOString(),
    newPosts: persisted.newPosts,
    postsChecked: persisted.postsChecked,
    cursorAdvanced: false,
    pagesFetched,
    reservationsUsed: 1,
    httpRequestsUsed: provider.httpRequestsUsed,
    errors: persisted.errors,
  };
}

// ==================== Ingestion-completeness probe (R3/M1) ====================

export const DEFAULT_X_BACKFILL_MAX_PAGES = 5;
export const DEFAULT_X_INGESTION_PROBE_INTERVAL_HOURS = 24;
export const DEFAULT_X_INGESTION_PROBE_WINDOW_HOURS = 24;
export const DEFAULT_X_INGESTION_PROBE_MAX_PAGES = 2;
export const DEFAULT_X_INGESTION_PROBE_RETRY_HOURS = 4;
export const DEFAULT_X_BACKFILL_LOOKBACK_DAYS = 14;

export function getBackfillLookbackLimitDays(env: Env): number {
  const configured = Number(env.X_BACKFILL_MAX_LOOKBACK_DAYS);
  return Number.isFinite(configured)
    ? Math.max(1, Math.min(90, Math.floor(configured)))
    : DEFAULT_X_BACKFILL_LOOKBACK_DAYS;
}

export function isXIngestionProbeEnabled(env: Env): boolean {
  return env.X_INGESTION_PROBE_ENABLED?.trim().toLowerCase() === 'true';
}

export function getXIngestionProbeIntervalHours(env: Env): number {
  const configured = Number(env.X_INGESTION_PROBE_INTERVAL_HOURS);
  return Number.isFinite(configured)
    ? Math.max(1, Math.min(168, Math.floor(configured)))
    : DEFAULT_X_INGESTION_PROBE_INTERVAL_HOURS;
}

export function getXIngestionProbeWindowHours(env: Env): number {
  const configured = Number(env.X_INGESTION_PROBE_WINDOW_HOURS);
  return Number.isFinite(configured)
    ? Math.max(1, Math.min(168, Math.floor(configured)))
    : DEFAULT_X_INGESTION_PROBE_WINDOW_HOURS;
}

export function getXIngestionProbeMaxPages(env: Env): number {
  const configured = Number(env.X_INGESTION_PROBE_MAX_PAGES);
  return Number.isFinite(configured)
    ? Math.max(1, Math.min(5, Math.floor(configured)))
    : DEFAULT_X_INGESTION_PROBE_MAX_PAGES;
}

export function getXIngestionProbeRetryHours(env: Env): number {
  const configured = Number(env.X_INGESTION_PROBE_RETRY_HOURS);
  return Number.isFinite(configured)
    ? Math.max(1, Math.min(48, Math.floor(configured)))
    : DEFAULT_X_INGESTION_PROBE_RETRY_HOURS;
}

export interface XIngestionProbeDecision {
  allowed: boolean;
  reason: 'allowed' | 'probe_disabled' | 'interval_not_elapsed' | 'retry_backoff';
}

/**
 * The completeness probe runs at most once per interval (default 24h) and
 * backoffs its retries after a failure so an X outage cannot burn the budget
 * by itself. Fail closed: disabled unless X_INGESTION_PROBE_ENABLED=true.
 */
export function shouldRunXIngestionProbe(
  now: Date,
  lastProbeAt: string | null,
  lastAttemptAt: string | null,
  env: Env,
): XIngestionProbeDecision {
  if (!isXIngestionProbeEnabled(env)) return { allowed: false, reason: 'probe_disabled' };
  if (lastProbeAt) {
    const last = new Date(lastProbeAt).getTime();
    if (!Number.isNaN(last) && now.getTime() - last < getXIngestionProbeIntervalHours(env) * 3600000) {
      return { allowed: false, reason: 'interval_not_elapsed' };
    }
  }
  if (lastAttemptAt) {
    const last = new Date(lastAttemptAt).getTime();
    if (!Number.isNaN(last) && now.getTime() - last < getXIngestionProbeRetryHours(env) * 3600000) {
      return { allowed: false, reason: 'retry_backoff' };
    }
  }
  return { allowed: true, reason: 'allowed' };
}

export interface XIngestionProbeResult {
  probeRun: boolean;
  skippedReason: string | null;
  windowStart: string | null;
  timelineWindowStart: string | null;
  timelineWindowEnd: string | null;
  storedWindowStart: string | null;
  storedWindowEnd: string | null;
  discrepancyRatio: number | null;
  warning: string | null;
  timelineCount: number | null;
  storedCount: number | null;
  missedCount: number | null;
  pagesFetched: number;
  reservationsUsed: number;
  lastProbeAt: string | null;
}

/**
 * Read-only ingestion-completeness probe: fetch the raw recent timeline
 * (replies included) with a start_time lower bound and compare its post count
 * against what is actually stored in D1. The probe NEVER writes source_posts
 * and never advances any cursor; it consumes one X reservation for the whole
 * bounded (max 2 pages) fetch and only persists metering settings. A positive
 * missedCount with replies retained is the symptom of an intake-layer filter
 * (e.g. exclude=replies) being reintroduced that monitorGap cannot see.
 */
export async function probeXIngestionCompleteness(
  env: Env,
  options: { now?: Date; force?: boolean } = {},
): Promise<XIngestionProbeResult> {
  const repo = new Repository(env.DB);
  const now = options.now ?? new Date();
  const lastProbeAt = await repo.getSetting('x_ingestion_probe_last_at');
  const lastAttemptAt = await repo.getSetting('x_ingestion_probe_last_attempt_at');
  const decision = shouldRunXIngestionProbe(now, lastProbeAt, lastAttemptAt, env);
  const empty = {
    probeRun: false,
    skippedReason: decision.reason,
    windowStart: null,
    timelineWindowStart: null, timelineWindowEnd: null, storedWindowStart: null, storedWindowEnd: null,
    discrepancyRatio: null, warning: null,
    timelineCount: null,
    storedCount: null,
    missedCount: null,
    pagesFetched: 0,
    reservationsUsed: 0,
    lastProbeAt,
  };
  if (!decision.allowed && !options.force) return empty;
  if (!isXIngestionProbeEnabled(env)) return empty;

  const windowStart = new Date(now.getTime() - getXIngestionProbeWindowHours(env) * 3600000).toISOString();
  const maxPages = getXIngestionProbeMaxPages(env);
  const provider = new XApiProvider(env, repo);
  const reservation = await reserveXApiFetch(repo, env, now);
  if (!reservation) {
    return { ...empty, skippedReason: 'daily_budget_exhausted_or_concurrent_trigger' };
  }
  await repo.setSetting('x_ingestion_probe_last_attempt_at', now.toISOString());
  try {
    const batch = await provider.fetchIncremental({
      reservationAlreadyHeld: true,
      reservation,
      startTime: windowStart,
      backfillMaxPages: maxPages,
      now,
    });
    const windowStartMs = new Date(windowStart).getTime();
    const timelineCount = new Set(batch.accounts
      .flatMap(account => account.posts)
      .filter(post => {
        if (!post.published_at) return false;
        const published = new Date(post.published_at).getTime();
        return !Number.isNaN(published) && published >= windowStartMs && published < now.getTime();
      }).map(post => `${post.source_account}:${post.canonical_post_id ?? post.source_post_id}`)).size;
    const storedCount = await repo.countIngestedDirectXPostsWithin(windowStart, now, monitoredAccounts(env));
    const missedCount = Math.max(0, timelineCount - storedCount);
    const discrepancyRatio = Math.abs(timelineCount - storedCount) / Math.max(1, timelineCount, storedCount);
    const warning = discrepancyRatio > 0.01 ? 'INGESTION_COUNT_DISCREPANCY' : null;
    await repo.setSetting('x_ingestion_probe_window_end', now.toISOString());
    await repo.setSetting('x_ingestion_probe_discrepancy_ratio', String(discrepancyRatio));
    await repo.setSetting('x_ingestion_probe_warning', warning ?? '');
    const pagesFetched = batch.accounts.reduce((sum, account) => sum + (account.pagesFetched ?? 0), 0);
    await repo.recordProviderUsageSuccess(X_API_PROVIDER_KEY, providerUsageDate(now), now.toISOString());
    await repo.setSetting('x_ingestion_probe_last_at', now.toISOString());
    await repo.setSetting('x_ingestion_probe_window_start', windowStart);
    await repo.setSetting('x_ingestion_probe_timeline_count', String(timelineCount));
    await repo.setSetting('x_ingestion_probe_stored_count', String(storedCount));
    await repo.setSetting('x_ingestion_probe_missed_count', String(missedCount));
    await repo.setSetting('x_ingestion_probe_pages', String(pagesFetched));
    return {
      probeRun: true,
      skippedReason: null,
      windowStart,
      timelineWindowStart: windowStart, timelineWindowEnd: now.toISOString(),
      storedWindowStart: windowStart, storedWindowEnd: now.toISOString(), discrepancyRatio, warning,
      timelineCount,
      storedCount,
      missedCount,
      pagesFetched,
      reservationsUsed: 1,
      lastProbeAt: now.toISOString(),
    };
  } catch (error) {
    console.error('[Cron] X ingestion probe failed:', error);
    return {
      ...empty,
      skippedReason: 'probe_fetch_failed',
      windowStart,
      reservationsUsed: 1,
    };
  }
}

/**
 * Put likely product/usage signals first, while retaining every new post.
 * Deterministic reset hints (completed-state or soft-hint language) rank above
 * the keyword prefilter because they are the exact "seen on X, missing on the
 * site" candidates this repair targets; the classifier budget spends on those
 * first.
 */
export function prioritizeCandidates(posts: SourcePost[]): SourcePost[] {
  if (posts.some(post => post.first_discovered_via === 'backfill') && posts.some(post => post.first_discovered_via !== 'backfill')) {
    return [...prioritizeCandidates(posts.filter(post => post.first_discovered_via !== 'backfill')),
      ...prioritizeCandidates(posts.filter(post => post.first_discovered_via === 'backfill'))];
  }
  const resetHints: SourcePost[] = [];
  const priority: SourcePost[] = [];
  const ordinary: SourcePost[] = [];
  for (const post of posts) {
    if (isCompletedResetHint(post) || isSoftResetHint(post) || isTrustedContextualResetWithContext(post, { activeCodexReset: true })) {
      resetHints.push(post);
    } else if (keywordPrefilter(post.text)) {
      priority.push(post);
    } else {
      ordinary.push(post);
    }
  }
  return [...resetHints, ...priority, ...ordinary];
}

async function getXUsageSnapshot(repo: Repository, usageDate: string): Promise<XUsageSnapshot | null> {
  const [usage, remainingSetting, resetSetting] = await Promise.all([
    repo.getProviderUsage(X_API_PROVIDER_KEY, usageDate),
    repo.getSetting('x_api_rate_limit_remaining'),
    repo.getSetting('x_api_rate_limit_reset_at'),
  ]);
  if (!usage) return null;
  return {
    ...usage,
    rate_limit_remaining: parseNullableCounter(remainingSetting),
    rate_limit_reset_at: resetSetting,
  };
}

async function persistXRateLimit(repo: Repository, batches: XApiAccountBatch[]): Promise<void> {
  const withRemaining = [...batches].reverse().find(batch => batch.rateLimit.remaining !== null);
  const withReset = [...batches].reverse().find(batch => batch.rateLimit.resetAt !== null);
  if (withRemaining?.rateLimit.remaining !== null && withRemaining?.rateLimit.remaining !== undefined) {
    await repo.setSetting('x_api_rate_limit_remaining', String(withRemaining.rateLimit.remaining));
  }
  if (withReset?.rateLimit.resetAt) await repo.setSetting('x_api_rate_limit_reset_at', withReset.rateLimit.resetAt);
}

async function recordXApiFailure(repo: Repository, previous: number, now: Date): Promise<number> {
  const next = Math.min(20, Math.max(0, previous) + 1);
  await repo.setSetting('x_api_consecutive_failures', String(next));
  await repo.setSetting('x_api_last_failure_at', now.toISOString());
  return next;
}

function parseCounter(value: string | null): number {
  if (!value || !/^\d+$/.test(value)) return 0;
  return Math.min(1000, Number(value));
}

function parseNullableCounter(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null;
  return Math.min(1000000, Number(value));
}

async function recordClassifierStatus(repo: Repository, outcome: ClassificationOutcome, checkedAt: string): Promise<void> {
  try {
    const error = outcome.status === 'ERROR' ? formatClassificationFailure(outcome) : null;
    await repo.recordProviderStatus(
      'llm-classifier',
      outcome.status === 'SUCCESS' ? 'ok' : 'degraded',
      outcome.status === 'SUCCESS' ? checkedAt : null,
      error,
    );
  } catch (error) {
    console.error('[Cron] Failed to persist classifier status:', error);
  }
}

function recordClassificationCategory(
  counts: Record<string, number>,
  outcome: ClassificationOutcome,
): void {
  const category = outcome.status === 'SUCCESS' ? outcome.result.category : 'ERROR';
  counts[category] = (counts[category] ?? 0) + 1;
}

function isResetLifecycleCategory(category: string): boolean {
  return category === 'RESET_PLANNED'
    || category === 'RESET_TIME_CHANGED'
    || category === 'RESET_COMPLETED';
}

async function processConfirmationSearch(repo: Repository, cycle: any, results: SearchResult[], now: Date): Promise<void> {
  // Classification above may have ingested a direct RESET_COMPLETED event
  // and closed this cycle. Re-read the state before writing community
  // evidence so a stale snapshot cannot overwrite a direct confirmation.
  const currentCycle = await repo.getActiveResetCycle({ advance: false });
  if (!currentCycle || Number(currentCycle.id) !== Number(cycle.id)
    || !['DUE', 'CONFIRMING'].includes(String(currentCycle.status))
    || currentCycle.completed_event_id) return;

  const decision = evaluateCommunityEvidence(results, currentCycle.expected_reset_at ?? null);
  for (const candidate of decision.candidates) {
    await repo.insertConfirmationEvidence({
      reset_cycle_id: Number(currentCycle.id),
      source_type: 'COMMUNITY',
      source_url: candidate.source_url,
      source_name: candidate.source_domain,
      source_text: candidate.source_text,
      published_at: candidate.published_at,
      classification: 'RESET_CONFIRMED',
    });
  }
  const evidence = await repo.getConfirmationEvidence(Number(currentCycle.id));
  const storedResults: SearchResult[] = evidence.map(item => ({
    title: item.source_text ?? '',
    snippet: '',
    url: item.source_url,
    publishedAt: item.published_at,
  }));
  const storedDecision = evaluateCommunityEvidence(storedResults, currentCycle.expected_reset_at ?? null);
  if (storedDecision.qualified) {
    await repo.confirmResetCycle(Number(currentCycle.id), now.toISOString(), 0.8, storedDecision.independentSources);
  } else {
    await repo.markResetCycleConfirming(Number(currentCycle.id), now.toISOString(), storedDecision.independentSources);
  }
}

function resultToLegacyPost(result: SearchResult): SourcePost | null {
  if (!result.url || !result.title && !result.snippet) return null;
  return {
    source: 'legacy',
    source_account: 'unknown',
    source_post_id: result.url,
    source_url: result.url,
    text: [result.title, result.snippet].filter(Boolean).join('\n'),
    published_at: result.publishedAt ?? null,
    fetched_at: new Date().toISOString(),
    raw_json: JSON.stringify(result.raw ?? result),
    content_hash: result.url,
    classification_pending: true,
  };
}

export async function recordRunDuration(repo: Repository, env: Env, startedAt: string, finishedAt: string) {
  const elapsedMs = Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt));
  const configured = Number(env.MONITOR_RUN_WARN_MS ?? '240000');
  const threshold = Number.isFinite(configured) && configured >= 0 ? configured : 240000;
  await repo.setSetting('monitor_run_duration', JSON.stringify({ elapsedMs, thresholdMs: threshold, warning: elapsedMs > threshold, finishedAt }));
  await repo.recordProviderStatus('monitor-runtime', elapsedMs > threshold ? 'degraded' : 'ok', finishedAt, elapsedMs > threshold ? 'MONITOR_RUN_SLOW' : null);
}
