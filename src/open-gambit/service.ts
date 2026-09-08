import type { Env } from '../types';
import { gambitBudgetFromEnv, GambitRunBudget } from './budget';
import { strategicSubstance } from './eligibility';
import { getGambitModelRoleConfig } from './llm';
import { emptyTranslationResult, translateGambit } from './publication';
import { GambitRepository } from './repository';
import { selectGlobalTopK } from './selection';
import { candidateFromDiscoveryItem, discoverConfiguredSources, parseGambitSourceRegistry } from './sources';
import { MemorySnapshotBucket, R2SnapshotStore, type SnapshotStore } from './snapshots';
import { dispatchQualifiedGambit, createConfiguredProviders, workflowIdForCandidate } from './workflow';
import type {
  GambitCandidate,
  GambitEvidence,
  GambitLLMProvider,
  GambitMetrics,
  GambitPublicArticle,
  GambitWorkflowResult,
} from './types';

export { normalizeGambitTranslation } from './publication';

export interface GambitDiscoveryOptions {
  repository?: GambitRepository;
  snapshotStore?: SnapshotStore;
  fetchImpl?: typeof fetch;
  now?: Date;
  windowKey?: string;
  startWorkflows?: boolean;
  providers?: Partial<Record<string, GambitLLMProvider>>;
  budget?: GambitRunBudget;
}

export interface GambitDiscoveryResult {
  runId: number;
  runKey: string;
  status: 'COMPLETED' | 'FAILED' | 'SKIPPED';
  sourcesConfigured: number;
  sourcesAttempted: number;
  sourcesSucceeded: number;
  sourcesFetched: number;
  fetchFailures: number;
  rawItemsFound: number;
  staleItems: number;
  malformedItems: number;
  admittedItems: number;
  selectedSourceIds: string[];
  candidatesFound: number;
  duplicates: number;
  politicalRejects: number;
  noGambitRejects: number;
  routineNoiseRejects: number;
  qualifiedGambits: number;
  strategicEligible: number;
  eventDuplicates: number;
  globalPoolSize: number;
  globalTopKSelected: number;
  workflowStarts: number;
  workflowFailures: number;
  workflows: GambitWorkflowResult[];
  errors: string[];
}

const LOCAL_SNAPSHOT_BUCKET = new MemorySnapshotBucket();

export async function runGambitDiscovery(env: Env, options: GambitDiscoveryOptions = {}): Promise<GambitDiscoveryResult> {
  const repository = options.repository ?? new GambitRepository(env.DB);
  const now = options.now ?? new Date();
  const windowKey = options.windowKey || utcWindowKey(now);
  const budget = options.budget ?? gambitBudgetFromEnv(env);
  const runKey = `gambit-discovery:${windowKey}`;
  const registry = parseGambitSourceRegistry(env.GAMBIT_SOURCE_REGISTRY_JSON);
  const run = await repository.createRun(runKey, 'DISCOVERY', now.toISOString());
  if (!run.isNew) {
    return {
      runId: run.id,
      runKey,
      status: 'SKIPPED',
      sourcesConfigured: registry.sources.length,
      sourcesAttempted: 0,
      sourcesSucceeded: 0,
      sourcesFetched: 0,
      fetchFailures: 0,
      rawItemsFound: 0,
      staleItems: 0,
      malformedItems: 0,
      admittedItems: 0,
      selectedSourceIds: [],
      candidatesFound: 0,
      duplicates: 0,
      politicalRejects: 0,
      noGambitRejects: 0,
      routineNoiseRejects: 0,
      qualifiedGambits: 0,
      strategicEligible: 0,
      eventDuplicates: 0,
      globalPoolSize: 0,
      globalTopKSelected: 0,
      workflowStarts: 0,
      workflowFailures: 0,
      workflows: [],
      errors: ['DUPLICATE_RUN_WINDOW'],
    };
  }
  for (const source of registry.sources) await repository.upsertSource(source, now.toISOString());
  const emptyResult = (): GambitDiscoveryResult => ({
    runId: run.id,
    runKey,
    status: 'COMPLETED',
    sourcesConfigured: registry.sources.length,
    sourcesAttempted: 0,
    sourcesSucceeded: 0,
    sourcesFetched: 0,
    fetchFailures: registry.errors.length,
    rawItemsFound: 0,
    staleItems: 0,
    malformedItems: 0,
    admittedItems: 0,
    selectedSourceIds: [],
    candidatesFound: 0,
    duplicates: 0,
    politicalRejects: 0,
    noGambitRejects: 0,
    routineNoiseRejects: 0,
    qualifiedGambits: 0,
    strategicEligible: 0,
    eventDuplicates: 0,
    globalPoolSize: 0,
    globalTopKSelected: 0,
    workflowStarts: 0,
    workflowFailures: 0,
    workflows: [],
    errors: registry.errors.slice(0, 20),
  });
  const result = emptyResult();
  if (registry.sources.length === 0) {
    await repository.finishRun(run.id, 'SKIPPED', { sourcesFetched: 0, fetchFailures: result.fetchFailures }, registry.errors.length ? registry.errors.join('; ') : null, now.toISOString());
    await repository.upsertDailyMetrics(dateKey(now), { discoveryRuns: 1, fetchFailures: result.fetchFailures }, now.toISOString());
    return { ...result, status: 'SKIPPED' };
  }

  const store = options.snapshotStore
    ?? (env.GAMBIT_SNAPSHOTS ? new R2SnapshotStore(env.GAMBIT_SNAPSHOTS) : env.GAMBIT_LOCAL_MEMORY_SNAPSHOTS === 'true' ? new R2SnapshotStore(LOCAL_SNAPSHOT_BUCKET) : null);
  if (!store) {
    const deferredSources = registry.sources.length;
    const error = 'R2_STORE_UNAVAILABLE';
    result.sourcesAttempted = deferredSources;
    result.fetchFailures = deferredSources;
    result.errors.push(error);
    await repository.finishRun(run.id, 'FAILED', { sourcesFetched: 0, fetchFailures: deferredSources }, error, now.toISOString());
    await repository.upsertDailyMetrics(dateKey(now), { discoveryRuns: 1, fetchFailures: deferredSources }, now.toISOString());
    return { ...result, status: 'FAILED' };
  }

  // Broad discovery: attempt every enabled source that fits the per-run cap
  // with bounded concurrency and per-source failure isolation.
  const analysisCap = readNumber(env.GAMBIT_MAX_ANALYSIS_CANDIDATES_PER_RUN, 3);
  const discovered = await discoverConfiguredSources(registry.sources, {
    fetchImpl: options.fetchImpl,
    now,
    maxSources: readNumber(env.GAMBIT_MAX_SOURCES_PER_RUN, 20),
    maxItemsPerSource: readNumber(env.GAMBIT_MAX_ITEMS_PER_SOURCE, 3),
    maxItemAgeDays: readNumber(env.GAMBIT_MAX_ITEM_AGE_DAYS, 30),
    rotationKey: windowKey,
    timeoutMs: readNumber(env.GAMBIT_HTTP_TIMEOUT_MS, 8_000),
    maxBytes: readNumber(env.GAMBIT_MAX_SOURCE_BYTES, 512_000),
    concurrency: readNumber(env.GAMBIT_FETCH_CONCURRENCY, 4),
    budget,
  });
  result.sourcesAttempted = discovered.selectedSourceIds.length;
  result.sourcesSucceeded = discovered.sourcesSucceeded;
  result.sourcesFetched = discovered.fetchCount;
  result.rawItemsFound = discovered.rawItemsFound;
  result.staleItems = discovered.staleItems;
  result.malformedItems = discovered.malformedItems;
  result.admittedItems = discovered.admittedItems;
  result.selectedSourceIds = discovered.selectedSourceIds;
  result.fetchFailures += discovered.failures.length;
  result.errors.push(...discovered.failures.map(failure => `${failure.sourceId}:${failure.status}`));

  // Phase 1 — durable snapshots and per-item deterministic qualification.
  const poolInput: Array<{ candidate: GambitCandidate; evidence: GambitEvidence[] }> = [];
  for (const item of discovered.items) {
    result.candidatesFound += 1;
    let snapshot = item.snapshot;
    let r2Key: string | null = null;
    try {
      const stored = await store.put(snapshot);
      r2Key = stored.key;
    } catch {
      // Evidence must not become eligible for analysis unless its private
      // normalized snapshot was durably accepted by the configured store.
      result.fetchFailures += 1;
      result.errors.push(`${item.source.id}:R2_WRITE_FAILED`);
      continue;
    }
    const snapshotRow = await repository.insertSnapshot({ ...snapshot, r2Key }, r2Key);
    const candidateData = await candidateFromDiscoveryItem(item, snapshotRow.id);
    const existing = await repository.findCandidateByFingerprint(candidateData.candidate.fingerprint);
    if (existing) {
      result.duplicates += 1;
      if (existing.id) await repository.linkCandidateSource(existing.id, snapshotRow.id, item.source.id, 'CORROBORATING', now.toISOString());
      continue;
    }
    const candidateRow = await repository.insertCandidate(candidateData.candidate);
    const candidateId = candidateRow.id;
    await repository.linkCandidateSource(candidateId, snapshotRow.id, item.source.id, item.source.qualityTier === 'DISCOVERY_ONLY' ? 'DISCOVERY' : 'PRIMARY', now.toISOString());
    if (candidateData.candidate.politicalTopic) {
      result.politicalRejects += 1;
    } else if (candidateData.candidate.status === 'REJECTED') {
      result.noGambitRejects += 1;
      if (strategicSubstance([candidateData.evidence]).detail === 'ROUTINE_MAINTENANCE') result.routineNoiseRejects += 1;
    } else if (candidateData.candidate.status === 'QUALIFIED') {
      result.qualifiedGambits += 1;
      poolInput.push({ candidate: { ...candidateData.candidate, id: candidateId }, evidence: [candidateData.evidence] });
    }
  }
  result.strategicEligible = poolInput.length;

  // Phase 2 — global cross-source pool: event deduplication, deterministic
  // ranking, and the GLOBAL Top-K cap before any expensive analysis starts.
  const selection = poolInput.length > 0
    ? selectGlobalTopK({ candidates: poolInput, now, topK: analysisCap })
    : { selected: [], deferred: [], absorbed: [], eventDuplicates: 0 };
  result.eventDuplicates = selection.eventDuplicates;
  result.globalPoolSize = poolInput.length;
  result.globalTopKSelected = selection.selected.length;

  // Absorbed candidates are the same event as their cluster representative:
  // they must not consume an expensive analysis slot. Persist the duplicate
  // status and link their snapshots as corroborating evidence.
  for (const absorbed of selection.absorbed) {
    const absorbedId = absorbed.candidate.id;
    if (!absorbedId) continue;
    await repository.setCandidateStatus(absorbedId, 'DUPLICATE', 'DUPLICATE', now.toISOString());
  }
  for (const representative of selection.selected) {
    const representativeId = representative.candidate.id;
    if (!representativeId) continue;
    for (const corroborating of representative.corroboratingEvidence) {
      await repository.linkCandidateSource(representativeId, corroborating.snapshotId, corroborating.sourceId, 'CORROBORATING', now.toISOString());
    }
    if (options.startWorkflows !== false) {
      try {
        const allSnapshotIds = [...new Set([
          ...representative.evidence.map(ev => ev.snapshotId),
          ...representative.absorbedSnapshotIds,
        ].filter(id => id > 0))];
        const workflow = await dispatchQualifiedGambit({
          workflowId: workflowIdForCandidate(representativeId),
          candidateId: representativeId,
          snapshotIds: allSnapshotIds,
          startedAt: now.toISOString(),
        }, env, {
          repository,
          binding: env.GAMBIT_ANALYSIS_WORKFLOW as unknown as import('./workflow').WorkflowBindingLike | undefined,
          providers: options.providers,
          budget,
        });
        if (workflow.status === 'DISPATCHED') {
          if (workflow.deduplicated !== true) result.workflowStarts += 1;
        } else {
          result.workflows.push(workflow);
        }
      } catch (error) {
        result.workflowFailures += 1;
        result.errors.push(`workflow:${representativeId}:${error instanceof Error ? error.message.slice(0, 120) : 'failed'}`);
      }
    }
  }
  const partialSourceFailure = discovered.failures.length > 0;
  await repository.finishRun(run.id, result.workflowFailures > 0 ? 'FAILED' : 'COMPLETED', {
    sourcesFetched: result.sourcesFetched,
    fetchFailures: result.fetchFailures,
    candidatesFound: result.candidatesFound,
    duplicates: result.duplicates,
    politicalRejects: result.politicalRejects,
    noGambitRejects: result.noGambitRejects,
    qualifiedGambits: result.qualifiedGambits,
    workflowStarts: result.workflowStarts,
    workflowFailures: result.workflowFailures,
  }, result.errors.join('; ') || null, now.toISOString());
  await repository.upsertDailyMetrics(dateKey(now), {
    discoveryRuns: 1,
    sourcesFetched: result.sourcesFetched,
    fetchFailures: result.fetchFailures,
    duplicates: result.duplicates,
    politicalRejects: result.politicalRejects,
    noGambitRejects: result.noGambitRejects,
    qualifiedGambits: result.qualifiedGambits,
    workflowStarts: result.workflowStarts,
    workflowFailures: result.workflowFailures,
  }, now.toISOString());
  try {
    await repository.insertDiscoveryStats({
      runId: run.id,
      sourcesAttempted: result.sourcesAttempted,
      sourcesSucceeded: result.sourcesSucceeded,
      sourcesFailed: discovered.failures.length,
      rawItemsObserved: discovered.rawItemsFound,
      staleItems: discovered.staleItems,
      malformedItems: discovered.malformedItems,
      admittedItems: discovered.admittedItems,
      exactDuplicates: result.duplicates,
      routineNoiseRejects: result.routineNoiseRejects,
      strategicEligible: result.strategicEligible,
      eventDuplicates: selection.eventDuplicates,
      globalPoolSize: result.globalPoolSize,
      globalTopKSelected: result.globalTopKSelected,
      workflowDispatches: result.workflowStarts,
      workflowFailures: result.workflowFailures,
      partialSourceFailure,
    }, now.toISOString());
  } catch (statsError) {
    // Discovery stats are observability, not operational. A stats insertion
    // failure (e.g. migration not yet applied) does not fail the run.
    console.error('[Open Gambit] discovery_stats_failed', { runId: run.id, error: statsError instanceof Error ? statsError.message.slice(0, 160) : 'unknown' });
  }
  return result;
}

export async function publishApprovedGambit(
  env: Env,
  articleId: number,
  revisionId: number,
  options: { repository?: GambitRepository; translationProvider?: import('./types').GambitLLMProvider; now?: Date } = {},
): Promise<{ published: boolean; translation: import('./publication').GambitTranslationRunResult; article: GambitPublicArticle | null }> {
  const repository = options.repository ?? new GambitRepository(env.DB);
  const article = await repository.getArticleById(articleId);
  if (!article || article.articleId !== articleId || article.status !== 'APPROVED') return { published: false, translation: emptyTranslationResult(), article };
  if (article.politicalTopic) return { published: false, translation: emptyTranslationResult(), article };
  const now = options.now ?? new Date();
  const translationRole = getGambitModelRoleConfig(env).find(item => item.role === 'translation');
  const translationStatus = await translateGambit(repository, article, revisionId, options.translationProvider, translationRole, now);
  const published = translationStatus.status === 'TRANSLATION_READY'
    ? await repository.publishApprovedArticle(articleId, revisionId, now.toISOString())
    : false;
  return { published, translation: translationStatus, article: await repository.getArticleById(articleId) };
}

function utcWindowKey(date: Date): string {
  return date.toISOString().slice(0, 13);
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function readNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}
