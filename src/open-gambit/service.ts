import type { Env } from '../types';
import { gambitBudgetFromEnv, GambitRunBudget } from './budget';
import { getGambitModelRoleConfig } from './llm';
import { emptyTranslationResult, translateGambit } from './publication';
import { GambitRepository } from './repository';
import { candidateFromDiscoveryItem, discoverConfiguredSources, parseGambitSourceRegistry } from './sources';
import { MemorySnapshotBucket, R2SnapshotStore, type SnapshotStore } from './snapshots';
import { dispatchQualifiedGambit, createConfiguredProviders, workflowIdForCandidate } from './workflow';
import type {
  GambitCandidate,
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
  sourcesFetched: number;
  fetchFailures: number;
  rawItemsFound: number;
  staleItems: number;
  malformedItems: number;
  selectedSourceIds: string[];
  candidatesFound: number;
  duplicates: number;
  politicalRejects: number;
  noGambitRejects: number;
  qualifiedGambits: number;
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
      sourcesFetched: 0,
      fetchFailures: 0,
      rawItemsFound: 0,
      staleItems: 0,
      malformedItems: 0,
      selectedSourceIds: [],
      candidatesFound: 0,
      duplicates: 0,
      politicalRejects: 0,
      noGambitRejects: 0,
      qualifiedGambits: 0,
      workflowStarts: 0,
      workflowFailures: 0,
      workflows: [],
      errors: ['DUPLICATE_RUN_WINDOW'],
    };
  }
  for (const source of registry.sources) await repository.upsertSource(source, now.toISOString());
  const result: GambitDiscoveryResult = {
    runId: run.id,
    runKey,
    status: 'COMPLETED',
    sourcesConfigured: registry.sources.length,
    sourcesFetched: 0,
    fetchFailures: registry.errors.length,
    rawItemsFound: 0,
    staleItems: 0,
    malformedItems: 0,
    selectedSourceIds: [],
    candidatesFound: 0,
    duplicates: 0,
    politicalRejects: 0,
    noGambitRejects: 0,
    qualifiedGambits: 0,
    workflowStarts: 0,
    workflowFailures: 0,
    workflows: [],
    errors: registry.errors.slice(0, 20),
  };
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
    result.fetchFailures = deferredSources;
    result.errors.push(error);
    await repository.finishRun(run.id, 'FAILED', { sourcesFetched: 0, fetchFailures: deferredSources }, error, now.toISOString());
    await repository.upsertDailyMetrics(dateKey(now), { discoveryRuns: 1, fetchFailures: deferredSources }, now.toISOString());
    return { ...result, status: 'FAILED' };
  }
  const discovered = await discoverConfiguredSources(registry.sources, {
    fetchImpl: options.fetchImpl,
    now,
    maxSources: readNumber(env.GAMBIT_MAX_SOURCES_PER_RUN, 20),
    maxItemsPerSource: readNumber(env.GAMBIT_MAX_ITEMS_PER_SOURCE, 3),
    maxItemAgeDays: readNumber(env.GAMBIT_MAX_ITEM_AGE_DAYS, 30),
    rotationKey: windowKey,
    timeoutMs: readNumber(env.GAMBIT_HTTP_TIMEOUT_MS, 8_000),
    maxBytes: readNumber(env.GAMBIT_MAX_SOURCE_BYTES, 512_000),
    budget,
  });
  result.sourcesFetched = discovered.fetchCount;
  result.rawItemsFound = discovered.rawItemsFound;
  result.staleItems = discovered.staleItems;
  result.malformedItems = discovered.malformedItems;
  result.selectedSourceIds = discovered.selectedSourceIds;
  result.fetchFailures += discovered.failures.length;
  result.errors.push(...discovered.failures.map(failure => `${failure.sourceId}:${failure.status}`));

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
    if (!candidateData.candidate.politicalTopic && candidateData.candidate.status === 'QUALIFIED') result.qualifiedGambits += 1;
    if (candidateData.candidate.politicalTopic) result.politicalRejects += 1;
    else if (candidateData.candidate.status === 'REJECTED') result.noGambitRejects += 1;
    if (options.startWorkflows !== false && candidateData.candidate.status === 'QUALIFIED') {
      try {
        const workflow = await dispatchQualifiedGambit({
          workflowId: workflowIdForCandidate(candidateId),
          candidateId,
          snapshotIds: [snapshotRow.id],
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
        result.errors.push(`workflow:${candidateId}:${error instanceof Error ? error.message.slice(0, 120) : 'failed'}`);
      }
    }
  }
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
