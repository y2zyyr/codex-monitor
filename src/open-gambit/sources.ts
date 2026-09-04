import { canonicalJson, sha256Hex } from './canonical';
import { GambitRunBudget } from './budget';
import { fetchEvidence } from './evidence';
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
}

export interface DiscoveryResult {
  items: DiscoveryItem[];
  failures: Array<{ sourceId: string; status: string; error: string }>;
  fetchCount: number;
}

/**
 * V1 discovery intentionally fetches only configured source URLs. A source is
 * never selected because content told the system to visit another URL.
 */
export async function discoverConfiguredSources(
  sources: GambitSourceDefinition[],
  options: { fetchImpl?: typeof fetch; now?: Date; maxSources?: number; timeoutMs?: number; maxBytes?: number; budget?: GambitRunBudget } = {},
): Promise<DiscoveryResult> {
  const items: DiscoveryItem[] = [];
  const failures: DiscoveryResult['failures'] = [];
  let fetchCount = 0;
  for (const source of sources.filter(item => item.enabled).slice(0, options.maxSources ?? 20)) {
    if (options.budget && !options.budget.consume('gambit_http')) {
      failures.push({ sourceId: source.id, status: 'BUDGET_EXCEEDED', error: 'The per-run gambit_http budget was exhausted.' });
      continue;
    }
    const result = await fetchEvidence(source.feedUrl || source.url, source, {
      fetchImpl: options.fetchImpl,
      now: options.now,
      timeoutMs: options.timeoutMs,
      maxBytes: options.maxBytes,
    });
    fetchCount += 1;
    if (!result.ok) {
      failures.push({ sourceId: source.id, status: result.status, error: result.error });
      continue;
    }
    items.push({
      source,
      url: result.snapshot.canonicalUrl,
      title: result.snapshot.title || source.name,
      summary: result.snapshot.normalizedContent.slice(0, 2_000),
      snapshot: result.snapshot,
    });
  }
  return { items, failures, fetchCount };
}

export async function fingerprintCandidate(title: string, canonicalUrl: string, content: string): Promise<string> {
  const normalized = `${normalizeTitle(title)}|${canonicalUrl}|${normalizeContent(content).slice(0, 2_000)}`;
  return sha256Hex(normalized);
}

export async function candidateFromDiscoveryItem(item: DiscoveryItem, snapshotId: number): Promise<{
  candidate: GambitCandidate;
  evidence: GambitEvidence;
}> {
  const fingerprint = await fingerprintCandidate(item.title, item.snapshot.canonicalUrl, item.snapshot.normalizedContent);
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
