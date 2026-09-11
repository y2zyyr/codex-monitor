import { canonicalJson, sha256Hex } from './canonical';
import { GambitRunBudget } from './budget';
import { fetchEvidence, GAMBIT_FEED_EXTRACTOR_VERSION, isHostnameAllowed, normalizeGambitUrl } from './evidence';
import { GAMBIT_ELIGIBILITY_RULES_VERSION } from './eligibility';
import { makeCandidateFromDecision, qualificationGate } from './policy';
import type {
  GambitCandidate,
  GambitEvidence,
  GambitSourceDefinition,
  GambitSourceSnapshot,
  GambitSourceTier,
  GambitSourceType,
} from './types';
import { GAMBIT_SOURCE_TIERS, GAMBIT_SOURCE_TYPES } from './types';

export interface SourceRegistryParseResult {
  sources: GambitSourceDefinition[];
  errors: string[];
}

export function parseGambitSourceRegistry(raw: string | undefined): SourceRegistryParseResult {
  if (!raw?.trim()) return { sources: [], errors: [] };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { sources: [], errors: ['GAMBIT_SOURCE_REGISTRY_JSON is not valid JSON.'] };
  }
  if (!Array.isArray(value)) return { sources: [], errors: ['The source registry must be a JSON array.'] };
  const sources: GambitSourceDefinition[] = [];
  const errors: string[] = [];
  for (const [index, item] of value.entries()) {
    const result = parseSourceDefinition(item);
    if (result.ok) sources.push(result.value);
    else errors.push(`source[${index}]: ${result.error}`);
  }
  const ids = new Set<string>();
  const uniqueSources = sources.filter(source => {
    if (ids.has(source.id)) {
      errors.push(`source ${source.id}: duplicate id`);
      return false;
    }
    ids.add(source.id);
    return true;
  });
  return { sources: uniqueSources.filter(source => source.enabled), errors };
}

function parseSourceDefinition(value: unknown): { ok: true; value: GambitSourceDefinition } | { ok: false; error: string } {
  if (!value || typeof value !== 'object') return { ok: false, error: 'must be an object' };
  const record = value as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  const type = typeof record.type === 'string' ? record.type.trim().toUpperCase() : '';
  const url = typeof record.url === 'string' ? record.url.trim() : '';
  const publisher = typeof record.publisher === 'string' ? record.publisher.trim() : '';
  const qualityTier = typeof record.qualityTier === 'string' ? record.qualityTier.trim().toUpperCase() : '';
  if (!id || !name || !url || !publisher) return { ok: false, error: 'id, name, url, and publisher are required' };
  if (!GAMBIT_SOURCE_TYPES.includes(type as GambitSourceType)) return { ok: false, error: `unsupported type ${type}` };
  if (!GAMBIT_SOURCE_TIERS.includes(qualityTier as GambitSourceTier)) return { ok: false, error: `unsupported qualityTier ${qualityTier}` };
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return { ok: false, error: 'url is invalid' };
  }
  if (parsedUrl.protocol !== 'https:') return { ok: false, error: 'url must use HTTPS' };
  const rawHosts = Array.isArray(record.allowedHosts)
    ? record.allowedHosts.filter((host): host is string => typeof host === 'string')
    : [parsedUrl.hostname];
  const allowedHosts = rawHosts.map(host => host.trim().toLowerCase().replace(/^https?:\/\//u, '').replace(/\/.*$/u, '').replace(/^www\./u, '')).filter(Boolean);
  if (allowedHosts.length === 0) return { ok: false, error: 'allowedHosts must not be empty' };
  return {
    ok: true,
    value: {
      id,
      name,
      type: type as GambitSourceType,
      url,
      publisher,
      qualityTier: qualityTier as GambitSourceTier,
      enabled: record.enabled !== false,
      allowedHosts,
      feedUrl: typeof record.feedUrl === 'string' ? record.feedUrl.trim() : undefined,
      notes: typeof record.notes === 'string' ? record.notes.slice(0, 500) : undefined,
    },
  };
}

export function sourceRegistryToJson(sources: GambitSourceDefinition[]): string {
  return canonicalJson(sources.map(source => ({
    id: source.id,
    name: source.name,
    type: source.type,
    url: source.url,
    publisher: source.publisher,
    qualityTier: source.qualityTier,
    enabled: source.enabled,
    allowedHosts: source.allowedHosts,
    feedUrl: source.feedUrl ?? null,
  })));
}

export interface DiscoveryItem {
  source: GambitSourceDefinition;
  url: string;
  title: string;
  summary: string;
  snapshot: GambitSourceSnapshot;
  stableId?: string;
  feedUrl?: string;
}

export interface DiscoveryResult {
  items: DiscoveryItem[];
  failures: Array<{ sourceId: string; status: string; error: string }>;
  fetchCount: number;
  selectedSourceIds: string[];
  /** Sources that returned a successful fetch (even when the feed had no admissible items). */
  sourcesSucceeded: number;
  /** Admitted items after freshness/hostname/malformed filters (=== items.length). */
  admittedItems: number;
  rawItemsFound: number;
  staleItems: number;
  malformedItems: number;
}

/**
 * Deterministic registry rotation. A run key chooses a stable offset in the
 * enabled registry and then walks it in registry order, so bounded runs do
 * not repeatedly privilege the first source. No content can influence the
 * selected source list.
 */
export function selectSourcesForRun(
  sources: GambitSourceDefinition[],
  maxSources = 20,
  rotationKey?: string,
): GambitSourceDefinition[] {
  const enabled = sources.filter(source => source.enabled);
  const limit = Math.min(enabled.length, Math.max(0, Math.floor(maxSources)));
  if (limit === 0) return [];
  if (!rotationKey || enabled.length <= limit) return enabled.slice(0, limit);
  const offset = fnv1a32(rotationKey) % enabled.length;
  return Array.from({ length: limit }, (_unused, index) => enabled[(offset + index) % enabled.length]);
}

/**
 * V1 discovery intentionally fetches only configured source URLs. A source is
 * never selected because content told the system to visit another URL.
 *
 * Broad-discovery redesign: every enabled source that fits the per-run cap is
 * attempted with bounded concurrency, and each source is isolated so one
 * timeout/failure cannot invalidate the healthy sources of the same run.
 */
export async function discoverConfiguredSources(
  sources: GambitSourceDefinition[],
  options: {
    fetchImpl?: typeof fetch;
    now?: Date;
    maxSources?: number;
    maxItemsPerSource?: number;
    maxItemAgeDays?: number;
    rotationKey?: string;
    timeoutMs?: number;
    /** Byte cap for a fetched HTML page (a source without a feed URL). */
    maxBytes?: number;
    /**
     * Byte cap for a fetched feed document (a source WITH a feed URL).
     *
     * Feeds need a larger cap than HTML pages: an atom `<content>` element may
     * carry the fully rendered HTML of a release note, so a 19,880-character
     * release becomes a 172,048-byte document (8.7x, measured on
     * `openai-codex-releases` / `rust-v0.154.0`). The single 128,000-byte cap
     * that applied to both classified that healthy feed as SOURCE_TOO_LARGE and
     * silently dropped the source. The HTML cap is deliberately NOT raised: an
     * ordinary page should still be rejected at 128,000 bytes.
     */
    maxFeedBytes?: number;
    budget?: GambitRunBudget;
    concurrency?: number;
  } = {},
): Promise<DiscoveryResult> {
  const items: DiscoveryItem[] = [];
  const failures: DiscoveryResult['failures'] = [];
  let fetchCount = 0;
  let sourcesSucceeded = 0;
  let rawItemsFound = 0;
  let staleItems = 0;
  let malformedItems = 0;
  const now = options.now ?? new Date();
  const maxItemsPerSource = Math.min(5, Math.max(1, Math.floor(options.maxItemsPerSource ?? 3)));
  const maxItemAgeDays = Math.min(365, Math.max(1, Math.floor(options.maxItemAgeDays ?? 30)));
  const concurrency = Math.min(8, Math.max(1, Math.floor(options.concurrency ?? 4)));
  const selectedSources = selectSourcesForRun(sources, options.maxSources ?? 20, options.rotationKey);

  // Phase 1 — bounded parallel fetch with per-source isolation. One broken
  // source only records a failure; every other source still contributes.
  const fetched = await mapWithConcurrency(selectedSources, concurrency, async source => {
    if (options.budget && !options.budget.consume('gambit_http')) {
      return { source, result: null as never, budgetExceeded: true, fetchError: null as string | null };
    }
    try {
      // The artifact that is actually fetched decides the byte cap: a source
      // with a feed URL fetches the feed document, everything else fetches a
      // page. Applying one cap to both is what misclassified healthy feeds.
      const result = await fetchEvidence(source.feedUrl || source.url, source, {
        fetchImpl: options.fetchImpl,
        now: options.now,
        timeoutMs: options.timeoutMs,
        maxBytes: source.feedUrl ? options.maxFeedBytes ?? options.maxBytes : options.maxBytes,
      });
      return { source, result, budgetExceeded: false, fetchError: null as string | null };
    } catch (error) {
      return {
        source,
        result: null as never,
        budgetExceeded: false,
        fetchError: error instanceof Error ? error.message.slice(0, 200) : 'unknown fetch error',
      };
    }
  });

  for (const entry of fetched) {
    const { source, result } = entry;
    if (entry.budgetExceeded) {
      failures.push({ sourceId: source.id, status: 'BUDGET_EXCEEDED', error: 'The per-run gambit_http budget was exhausted.' });
      continue;
    }
    fetchCount += 1;
    if (entry.fetchError) {
      failures.push({ sourceId: source.id, status: 'FETCH_ERROR', error: entry.fetchError });
      continue;
    }
    if (!result.ok) {
      failures.push({ sourceId: source.id, status: result.status, error: result.error });
      continue;
    }
    sourcesSucceeded += 1;
    if (!result.isFeed) {
      if (result.snapshot.title && result.snapshot.normalizedContent.trim()) {
        items.push({
          source,
          url: result.snapshot.canonicalUrl,
          title: result.snapshot.title || source.name,
          summary: result.snapshot.normalizedContent.slice(0, 2_000),
          snapshot: result.snapshot,
          feedUrl: source.feedUrl || source.url,
        });
      } else {
        malformedItems += 1;
      }
      continue;
    }

    if (result.feedItems.length === 0) {
      malformedItems += 1;
      continue;
    }

    rawItemsFound += result.feedItems.length;
    const seen = new Set<string>();
    const eligible = [] as typeof result.feedItems;
    for (const feedItem of result.feedItems) {
      const canonicalUrl = normalizeGambitUrl(feedItem.canonicalUrl || '');
      const key = feedItem.stableId || canonicalUrl || `${feedItem.title ?? ''}|${feedItem.publishedAt ?? ''}`;
      if (!feedItem.title || !feedItem.content || !canonicalUrl || !isHostnameAllowed(canonicalUrl, source)) {
        malformedItems += 1;
        continue;
      }
      if (feedItem.publishedAt) {
        const publishedAt = new Date(feedItem.publishedAt).getTime();
        if (Number.isFinite(publishedAt) && publishedAt < now.getTime() - maxItemAgeDays * 86_400_000) {
          staleItems += 1;
          continue;
        }
      }
      if (seen.has(key)) continue;
      seen.add(key);
      eligible.push({ ...feedItem, canonicalUrl });
    }
    eligible.sort((left, right) => {
      const leftTime = left.publishedAt ? new Date(left.publishedAt).getTime() : 0;
      const rightTime = right.publishedAt ? new Date(right.publishedAt).getTime() : 0;
      return rightTime - leftTime || left.stableId.localeCompare(right.stableId);
    });
    for (const feedItem of eligible.slice(0, maxItemsPerSource)) {
      const snapshot: GambitSourceSnapshot = {
        sourceId: source.id,
        requestedUrl: result.snapshot.requestedUrl,
        finalUrl: result.snapshot.finalUrl,
        canonicalUrl: feedItem.canonicalUrl!,
        title: feedItem.title!,
        publisher: feedItem.publisher || result.snapshot.publisher || source.publisher,
        publishedAt: feedItem.publishedAt,
        retrievedAt: result.snapshot.retrievedAt,
        normalizedContent: feedItem.content.slice(0, 12_000),
        contentHash: await sha256Hex(`${feedItem.stableId}|${feedItem.canonicalUrl}|${feedItem.content}`),
        extractorVersion: GAMBIT_FEED_EXTRACTOR_VERSION,
        sourceQualityTier: source.qualityTier,
      };
      items.push({
        source,
        url: snapshot.canonicalUrl,
        title: snapshot.title!,
        summary: feedItem.content.slice(0, 2_000),
        snapshot,
        stableId: feedItem.stableId,
        feedUrl: source.feedUrl || source.url,
      });
    }
  }
  return {
    items,
    failures,
    fetchCount,
    selectedSourceIds: selectedSources.map(source => source.id),
    sourcesSucceeded,
    admittedItems: items.length,
    rawItemsFound,
    staleItems,
    malformedItems,
  };
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await mapper(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Fingerprint a discovered item.
 *
 * The admission-rule version is part of the identity on purpose. An exact
 * fingerprint dedup permanently skips anything already seen, which is correct
 * for re-reporting the same evidence, but it also meant a candidate rejected by
 * an older, stricter rule set could never be re-evaluated -- so fixing the rules
 * could not reach the items they were fixed for. Including the version makes a
 * rules change open exactly one new evaluation pass, while re-running the same
 * rules stays idempotent.
 */
export async function fingerprintCandidate(
  title: string,
  canonicalUrl: string,
  content: string,
  stableId?: string,
  rulesVersion: string = GAMBIT_ELIGIBILITY_RULES_VERSION,
): Promise<string> {
  const identity = stableId
    ? `stable:${normalizeContent(stableId).slice(0, 500)}`
    : `${normalizeTitle(title)}|${canonicalUrl}|${normalizeContent(content).slice(0, 2_000)}`;
  return sha256Hex(`rules:${rulesVersion}|${identity}`);
}

export async function candidateFromDiscoveryItem(item: DiscoveryItem, snapshotId: number): Promise<{
  candidate: GambitCandidate;
  evidence: GambitEvidence;
}> {
  const fingerprint = await fingerprintCandidate(item.title, item.snapshot.canonicalUrl, item.snapshot.normalizedContent, item.stableId);
  const evidence: GambitEvidence = {
    snapshotId,
    sourceId: item.source.id,
    sourceTier: item.source.qualityTier,
    canonicalUrl: item.snapshot.canonicalUrl,
    title: item.snapshot.title,
    publisher: item.snapshot.publisher,
    publishedAt: item.snapshot.publishedAt,
    quote: item.snapshot.normalizedContent.slice(0, 4_000),
    role: 'FACT',
    contentHash: item.snapshot.contentHash,
  };
  const decision = qualificationGate({
    headline: item.title,
    summary: item.summary,
    content: item.snapshot.normalizedContent,
    evidence: [evidence],
  });
  return {
    candidate: makeCandidateFromDecision({
      fingerprint,
      headline: item.title.slice(0, 240),
      summary: item.summary.slice(0, 2_000),
      canonicalUrl: item.snapshot.canonicalUrl,
      snapshotIds: [snapshotId],
      sourceIds: [item.source.id],
      decision,
      discoveredAt: item.snapshot.retrievedAt,
    }),
    evidence,
  };
}

function normalizeTitle(value: string): string {
  return value.toLocaleLowerCase('en-US').normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function normalizeContent(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

function fnv1a32(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}
