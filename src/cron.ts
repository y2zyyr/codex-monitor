// ============================================================
// Tibo Monitor - Direct-first source orchestration
// ============================================================
import type { Env, SourcePost, ClassificationOutcome, ClassificationProvider } from './types';
import { Repository } from './db/repository';
import {
  buildCompletedResetHintResult,
  buildSoftResetHintResult,
  isCompletedResetHint,
  isSoftResetHint,
  keywordPrefilter,
} from './classifier/types';
import type { SocialSourceProvider, SearchResult, WebSearchProvider } from './providers/types';
import {
  XApiProvider,
  reserveXApiFetch,
  X_API_PROVIDER_KEY,
  XApiPartialFailureError,
  type XApiAccountBatch,
} from './providers/x-api';
import {
  getAdaptiveSearchQueries,
  monitoredAccounts,
  normalizeDiscoveryResults,
  ProviderBudgetExceededError,
  WEB_SEARCH_PROVIDER_KEY,
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
  nextWebSearchAt,
  shouldRunWebSearch,
} from './utils/search-schedule';
import type { WebSearchMode } from './utils/search-schedule';

const MAX_CLASSIFICATIONS_PER_RUN = 5;

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
  const startedAt = (options.now ?? new Date()).toISOString();
  const now = options.now ?? new Date(startedAt);
  const errors: string[] = [];
  let runId: number | null = null;
  let postsChecked = 0;
  let candidatesFound = 0;
  let eventsCreated = 0;
  let xApiCalls = 0;
  let webSearchCalls = 0;
  let llmClassifications = 0;
  let classificationBudget = MAX_CLASSIFICATIONS_PER_RUN;
  let searchStatus: 'ok' | 'degraded' | 'not_configured' = options.searchProvider ? 'ok' : 'not_configured';
  let searchError: string | null = null;
  let xSyncReason: string | null = null;
  let xSyncAttempted = false;
  let xSyncSkipped = true;
  let lastXFetchAt: string | null = null;
  let xLastSuccessAt: string | null = null;
  let xSyncFailedThisRun = false;
  let xFailureCount = 0;
  let xUsage: XUsageSnapshot | null = null;
  let searchMode: WebSearchMode = 'NORMAL';
  let searchSkipped = !!options.searchProvider;
  let searchSkipReason: string | null = options.searchProvider ? 'not_due' : 'not_configured';
  let searchLastAttemptAt: string | null = null;
  let searchUsage: { request_count?: number; usedToday?: number; last_request_at?: string | null; last_request_slot?: string | null } | null = null;

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
    const activeCycle = await repo.getActiveResetCycle();
    searchMode = getWebSearchMode(activeCycle, now);
    const accounts = monitoredAccounts(env);
    const discoveryResults: SearchResult[] = [];
    const newCandidates: SourcePost[] = [];
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
              xApiCalls = 1;
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
                  newCandidates.push(...persisted.newCandidates);
                  errors.push(...persisted.errors);
                  await persistXRateLimit(repo, error.accounts);
                  errors.push(`X authoritative sync degraded: ${message}`);
                  await repo.recordProviderStatus(X_API_PROVIDER_KEY, 'degraded', null, message);
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

    searchUsage = await repo.getProviderUsage(WEB_SEARCH_PROVIDER_KEY, providerUsageDate(now));

    const fetchedAt = now.toISOString();
    const discoveredPosts = options.searchProvider
      ? normalizeDiscoveryResults(discoveryResults, accounts, fetchedAt)
      : discoveryResults.map(resultToLegacyPost).filter((post): post is SourcePost => !!post);
    postsChecked += discoveredPosts.length;

    for (const post of discoveredPosts) {
      const upserted = await repo.upsertSourcePost(post, fetchedAt);
      if (upserted.isNew && keywordPrefilter(post.text)) {
        newCandidates.push({ ...post, id: upserted.id });
      }
    }
    candidatesFound += newCandidates.length;

    // 3. Candidate classification and pending retries. All direct/search raw
    // rows have been persisted before this phase starts. Keep a local set so
    // the D1 recovery pass below cannot classify the same post twice in one
    // run.
    const classifiedPostIds = new Set<number>();
    for (const candidate of newCandidates) {
      if (classificationBudget <= 0) break;
      if (candidate.id !== undefined) classifiedPostIds.add(candidate.id);
      llmClassifications++;
      const outcome = await classifyAndCreateEvent(repo, classifier, candidate, now);
      if (outcome.created) eventsCreated++;
      if (outcome.outcome.status === 'ERROR') errors.push(`LLM classification failed for source ${candidate.id}: ${outcome.outcome.error}`);
      classificationBudget--;
    }
    if (classificationBudget > 0) {
      const pending = await repo.getUnclassifiedPosts(20);
      for (const post of pending) {
        if (classificationBudget <= 0) break;
        const attempts = (post as SourcePost & { classification_attempts?: number }).classification_attempts ?? 0;
        const lastAttempt = (post as SourcePost & { last_classification_attempt_at?: string }).last_classification_attempt_at;
        if (attempts >= 5 || (lastAttempt && new Date(lastAttempt).getTime() > now.getTime() - 3600000)) continue;
        if (post.id !== undefined) classifiedPostIds.add(post.id);
        llmClassifications++;
        const outcome = await classifyAndCreateEvent(repo, classifier, post, now);
        if (outcome.created) eventsCreated++;
        if (outcome.outcome.status === 'ERROR') errors.push(`LLM classification failed for source ${post.id}: ${outcome.outcome.error}`);
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
        if (!isCompletedResetHint(post) && !isSoftResetHint(post)) continue;
        if (post.id !== undefined) classifiedPostIds.add(post.id);
        candidatesFound++;
        llmClassifications++;
        const outcome = await classifyAndCreateEvent(repo, classifier, post, now);
        if (outcome.created) eventsCreated++;
        if (outcome.outcome.status === 'ERROR') errors.push(`LLM classification failed for recovered source ${post.id}: ${outcome.outcome.error}`);
        classificationBudget--;
      }
    }

    // 4. Confirming mode uses the same adaptive search request. Direct X data
    // has already been ingested and therefore wins indexed evidence.
    if (options.searchProvider && activeCycle && searchMode === 'CONFIRMING_RESET' && !searchSkipped && searchStatus === 'ok') {
      await processConfirmationSearch(repo, activeCycle, discoveryResults, now);
    }

    const finishedAt = new Date().toISOString();
    const nextSearchAt = nextWebSearchAt(now, searchMode, searchLastAttemptAt, searchUsage, env);
    const errorMessage = errors.length > 0 ? errors.join(' | ') : null;
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
      errorMessage,
      startedAt,
      finishedAt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const finishedAt = new Date().toISOString();
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
): Promise<{ created: boolean; outcome: ClassificationOutcome }> {
  const now = clock.toISOString();
  const currentAttempts = ((post as SourcePost & { classification_attempts?: number }).classification_attempts ?? 0) + 1;
  try {
    const completedResetResult = isCompletedResetHint(post)
      ? buildCompletedResetHintResult(post)
      : null;
    const softResetResult = isSoftResetHint(post)
      ? buildSoftResetHintResult(post)
      : null;
    const classifierOutcome = await classifier.classify(post);
    await recordClassifierStatus(repo, classifierOutcome, now);
    // Explicit direct completion language is deterministic enough to keep
    // even when the LLM is unavailable. This protects the source-of-truth
    // signal from both transient classifier failures and model drift.
    if (classifierOutcome.status === 'ERROR' && !completedResetResult && !softResetResult) {
      await repo.updateClassificationRetry(post.id!, currentAttempts, now, classifierOutcome.error);
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
      : classifierOutcome;
    if (outcome.status === 'ERROR') {
      await repo.updateClassificationRetry(post.id!, currentAttempts, now, outcome.error);
      return { created: false, outcome };
    }
    const result = outcome.result;
    if (!result.relevant || result.category === 'IRRELEVANT') {
      await repo.markClassified(post.id!);
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
    if (eventId !== null) {
      const event = await repo.getEventById(eventId);
      if (event) await repo.handleResetEvent(event);
    }
    return { created: eventId !== null, outcome };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await repo.updateClassificationRetry(post.id!, currentAttempts, now, message);
    return { created: false, outcome: { status: 'ERROR', error: message, category: 'ERROR' } };
  }
}

export async function persistXAccountBatches(
  repo: Repository,
  batches: XApiAccountBatch[],
  now: Date,
): Promise<{
  postsChecked: number;
  newPosts: number;
  candidatesFound: number;
  newCandidates: SourcePost[];
  errors: string[];
}> {
  const fetchedAt = now.toISOString();
  let postsChecked = 0;
  let newPosts = 0;
  let candidatesFound = 0;
  const newCandidates: SourcePost[] = [];
  const errors: string[] = [];

  for (const batch of batches) {
    try {
      for (const post of batch.posts) {
        postsChecked++;
        const upserted = await repo.upsertSourcePost(post, fetchedAt);
        if (upserted.isNew) {
          newPosts++;
          if (keywordPrefilter(post.text)) {
            candidatesFound++;
            newCandidates.push({ ...post, id: upserted.id });
          }
        }
      }

      if (!batch.complete) {
        errors.push(`${batch.account}: X batch incomplete; cursor was not advanced`);
      } else if (batch.newestId) {
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

  return { postsChecked, newPosts, candidatesFound, newCandidates, errors };
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
    await repo.recordProviderStatus(
      'llm-classifier',
      outcome.status === 'SUCCESS' ? 'ok' : 'degraded',
      outcome.status === 'SUCCESS' ? checkedAt : null,
      outcome.status === 'ERROR' ? outcome.error : null,
    );
  } catch (error) {
    console.error('[Cron] Failed to persist classifier status:', error);
  }
}

async function processConfirmationSearch(repo: Repository, cycle: any, results: SearchResult[], now: Date): Promise<void> {
  // Classification above may have ingested a direct RESET_COMPLETED event
  // and closed this cycle. Re-read the state before writing community
  // evidence so a stale snapshot cannot overwrite a direct confirmation.
  const currentCycle = await repo.getActiveResetCycle();
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
