// ============================================================
// Open Gambit — Global Candidate Selection
// ============================================================
// This module implements the broad-discovery redesign:
//   ALL ENABLED SOURCES → cheap fetch → global pool → event
//   deduplication → deterministic ranking → global Top-K →
//   expensive LLM analysis.
//
// Every function is deterministic and testable. No LLM, no
// vectors, no network, no storage.  Inputs are the candidate
// pool and the current time only.
// ============================================================

import { strategicSubstance } from './eligibility';
import type { GambitCandidate, GambitEvidence, GambitSourceTier } from './types';

// ---------------------------------------------------------------------------
// 1. Event family priority (higher = more likely to reach analysis).
//    Routine maintenance and marketing text never reach this list because
//    they do not produce a CONCRETE_STRATEGIC_EVENT signal.
// ---------------------------------------------------------------------------

export const EVENT_FAMILY_PRIORITY: Record<string, number> = {
  MODEL_LAUNCH: 1.0,
  PRICE_CHANGE: 0.95,
  OPEN_RELEASE: 0.9,
  ACCESS_CHANGE: 0.9,
  INTEROPERABILITY: 0.85,
  DEFAULT_DISTRIBUTION: 0.85,
  ACQUISITION: 0.8,
  FORCED_MIGRATION: 0.8,
  CLOUD_PARTNERSHIP: 0.75,
  COMPUTE_INCENTIVE: 0.75,
  CAPABILITY_CHANGE: 0.7,
  CONTEXT_EXPANSION: 0.65,
};

const DEFAULT_FAMILY_PRIORITY = 0.4;

// ---------------------------------------------------------------------------
// 2. Known first-party actors
// ---------------------------------------------------------------------------

const ACTOR_PATTERNS: Array<[RegExp, string]> = [
  [/\bopenai\b/iu, 'openai'],
  [/\banthropic\b/iu, 'anthropic'],
  [/\bgoogle\s+deepmind\b|\bdeepmind\b/iu, 'google-deepmind'],
  [/\bgoogle\b/iu, 'google'],
  [/\bmeta\b/iu, 'meta'],
  [/\bmicrosoft\b/iu, 'microsoft'],
  [/\bgithub\b/iu, 'github'],
  [/\bcloudflare\b/iu, 'cloudflare'],
  [/\bhugging\s*face\b|\bhuggingface\b/iu, 'huggingface'],
  [/\bnvidia\b/iu, 'nvidia'],
  [/\bllama\b/iu, 'meta'],
  [/\bgemini\b/iu, 'google'],
  [/\bclaude\b/iu, 'anthropic'],
  [/\bgpt\s*-?\s*\d/iu, 'openai'],
];

// ---------------------------------------------------------------------------
// 3. Stopwords for token overlap. Merge tokens are product/model/version
//    names, so common words are deliberately excluded.
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'into', 'that', 'this', 'its',
  'has', 'was', 'are', 'will', 'can', 'you', 'your', 'our', 'their',
  'model', 'api', 'sdk', 'release', 'releases', 'announces', 'launches',
  'launched', 'news', 'blog', 'post', 'now', 'more', 'over', 'under',
  'about', 'after', 'before', 'during', 'through', 'against', 'between',
  'also', 'not', 'but', 'than', 'then', 'out', 'off', 'up', 'down',
  'per', 'via', 'into', 'while', 'still', 'very', 'just', 'gets',
  'make', 'made', 'makes', 'new', 'first', 'next', 'last', 'version',
  'updated', 'update', 'change', 'changes', 'added', 'fixed', 'fixes',
  'improved', 'support', 'supports', 'supporting', 'use', 'uses',
  'using', 'used', 'add', 'adds', 'fix', 'remove', 'removes', 'removed',
  'deprecate', 'deprecated', 'deprecates', 'upgrade', 'upgrades',
  'upgraded', 'merge', 'merged', 'merges', 'pull', 'request', 'requests',
  'branch', 'branches', 'main', 'master', 'stable', 'beta', 'alpha',
  'internal', 'other', 'chore', 'bump', 'bumps', 'bumped', 'commit',
  'commits', 'pr', 'prs', 'issue', 'issues', 'workflow',
  'workflows', 'action', 'actions', 'github', 'pypi', 'docker',
  'container', 'containers', 'image', 'images', 'tag', 'tags', 'today',
  'company', 'companies', 'announcement', 'announcements', 'officially',
  'general', 'availability', 'available', 'public', 'developer',
  'developers', 'platform', 'ecosystem', 'capability', 'capabilities',
  'feature', 'features', 'product', 'products', 'service', 'services',
  'price', 'prices', 'pricing', 'cost', 'costs', 'rate', 'rates',
  'cut', 'cuts', 'reduce', 'reduces', 'reduced', 'reduction', 'major',
  'latest', 'brand', 'world', 'text', 'token', 'tokens', 'usage',
  'access', 'open', 'closed', 'weight', 'weights', 'free', 'paid',
  'most', 'all', 'response', 'responses', 'input', 'output', 'data',
  'user', 'users', 'tool', 'tools', 'system', 'systems', 'customers',
]);

// ---------------------------------------------------------------------------
// 4. Helpers
// ---------------------------------------------------------------------------

export function extractActor(headline: string, summary: string, publisher: string | null): string {
  const haystack = `${headline} ${summary} ${publisher ?? ''}`;
  for (const [pattern, name] of ACTOR_PATTERNS) {
    if (pattern.test(haystack)) return name;
  }
  return 'unknown';
}

/**
 * Product/model/version tokens used to decide whether two headlines describe
 * the same concrete event. Only "concrete" tokens count: a token must contain
 * a digit (model/version names such as "gpt-5", "v0.2.152") or be capitalized
 * in the original headline (proper nouns such as "Claude", "DeepMind").
 * Generic English content words ("strategic", "event", "pricing") never match,
 * which prevents false event merges.
 */
function mergeTokens(text: string): Set<string> {
  const rawTokens = text.normalize('NFKC')
    .replace(/[^\p{L}\p{N}.\-]+/gu, ' ')
    .split(' ')
    .map(token => token.trim())
    .filter(token => token.length >= 5);
  const result = new Set<string>();
  for (const raw of rawTokens) {
    const lower = raw.toLocaleLowerCase('en-US');
    if (STOPWORDS.has(lower)) continue;
    if (!/\d/u.test(raw) && !/[A-Z]/u.test(raw)) continue;
    result.add(lower);
  }
  return result;
}

export function sharedConcreteTokenCount(left: string, right: string): number {
  const leftTokens = mergeTokens(left);
  const rightTokens = mergeTokens(right);
  let shared = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) shared += 1;
  }
  return shared;
}

function sourceTierWeight(tier: GambitSourceTier): number {
  switch (tier) {
    case 'PRIMARY_OFFICIAL': return 1.0;
    case 'PRIMARY_REPOSITORY': return 0.9;
    case 'PRIMARY_DOCUMENTATION': return 0.85;
    case 'SECONDARY_HIGH_QUALITY': return 0.6;
    case 'DISCOVERY_ONLY': return 0.3;
  }
}

/** Monday-based ISO week bucket of a date, or null when unparseable. */
function weekBucket(publishedAt: string | null): string | null {
  if (!publishedAt) return null;
  const date = new Date(publishedAt);
  if (!Number.isFinite(date.getTime())) return null;
  const day = date.getDay();
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - ((day + 6) % 7)));
  return monday.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// 5. Pool entry
// ---------------------------------------------------------------------------

export interface GambitPoolEntry {
  candidate: GambitCandidate;
  evidence: GambitEvidence[];
  clusterKey: string;
  rankScore: number;
  signalTypes: string[];
  /** Corroborating evidence from event-duplicate sources in the cluster. */
  corroboratingEvidence: GambitEvidence[];
  /** Candidate ids absorbed as event duplicates (for status updates). */
  absorbedCandidateIds: number[];
  /** Snapshot ids absorbed as corroborating evidence (for analysis input). */
  absorbedSnapshotIds: number[];
}

export interface GlobalSelectionInput {
  candidates: Array<{ candidate: GambitCandidate; evidence: GambitEvidence[] }>;
  now: Date;
  topK: number;
}

export interface GlobalSelectionResult {
  /** Ranked, deduplicated event clusters capped at topK analysis slots. */
  selected: GambitPoolEntry[];
  /** Qualified clusters that did not make the global Top-K this run. */
  deferred: GambitPoolEntry[];
  /** Candidates absorbed as event duplicates (corroboration only). */
  absorbed: GambitPoolEntry[];
  eventDuplicates: number;
}

// ---------------------------------------------------------------------------
// 6. Ranking score
// ---------------------------------------------------------------------------

/**
 * Deterministic ANALYSIS-PRIORITY score. This is never a publication score.
 * Composition (documented, transparent):
 *   40% strategic substance    (from the deterministic eligibility gate)
 *   25% event family priority  (model launch, price change, open weights, …)
 *   15% source authority       (first-party official > repository > …)
 *   10% recency                (bounded decay over the 30-day window)
 *   10% corroboration          (independent sources strengthen the event)
 * Marketing adjectives alone cannot score; raw source falsifiability is not
 * an input.
 */
export function globalRankScore(
  candidate: GambitCandidate,
  evidence: GambitEvidence[],
  signalTypes: string[],
  corroborationCount: number,
  now: Date,
): number {
  const substance = candidate.strategicValue;
  const familyPriority = EVENT_FAMILY_PRIORITY[signalTypes[0] ?? 'UNKNOWN'] ?? DEFAULT_FAMILY_PRIORITY;
  const authority = evidence.reduce((best, ev) => Math.max(best, sourceTierWeight(ev.sourceTier)), 0);
  let recency = 0.5;
  const discoveredMs = new Date(candidate.discoveredAt).getTime();
  if (Number.isFinite(discoveredMs)) {
    const ageDays = Math.max(0, (now.getTime() - discoveredMs) / 86_400_000);
    recency = Math.max(0.5, 1 - Math.min(1, ageDays / 30) * 0.5);
  }
  const corroboration = Math.min(1, corroborationCount * 0.15);
  return 0.4 * substance + 0.25 * familyPriority + 0.15 * authority + 0.1 * recency + 0.1 * corroboration;
}

// ---------------------------------------------------------------------------
// 7. Cluster key (used for diagnostics; the merge decision uses the richer
//    rules in selectGlobalTopK)
// ---------------------------------------------------------------------------

export function eventClusterKey(input: {
  headline: string;
  summary: string;
  publishedAt: string | null;
  signalTypes: string[];
  publisher: string | null;
}): string {
  const actor = extractActor(input.headline, input.summary, input.publisher);
  const family = input.signalTypes[0] ?? 'UNKNOWN';
  const bucket = weekBucket(input.publishedAt) ?? 'no-date';
  return `${actor}|${family}|${bucket}`;
}

// ---------------------------------------------------------------------------
// 8. Global selection
// ---------------------------------------------------------------------------

function belongsToCluster(entry: GambitPoolEntry, representative: GambitPoolEntry): boolean {
  const sameFamily = entry.signalTypes[0] === representative.signalTypes[0];
  if (!sameFamily) return false;
  const entryWeek = weekOf(entry.evidence[0]?.publishedAt ?? null);
  const repWeek = weekOf(representative.evidence[0]?.publishedAt ?? null);
  if (entryWeek !== repWeek) return false;
  const shared = sharedConcreteTokenCount(entry.candidate.headline, representative.candidate.headline);
  const entryActor = extractActor(entry.candidate.headline, entry.candidate.summary, entry.evidence[0]?.publisher ?? null);
  const repActor = extractActor(representative.candidate.headline, representative.candidate.summary, representative.evidence[0]?.publisher ?? null);
  // Same known actor + at least one shared concrete token (official blog + own
  // GitHub release of the same product). When either side has no known actor,
  // require >= 2 shared concrete tokens (two independent first-party accounts
  // describing the same concrete event). Generic text can never satisfy this.
  if (entryActor !== 'unknown' && repActor !== 'unknown' && entryActor === repActor) return shared >= 1;
  return shared >= 2;
}

function weekOf(publishedAt: string | null): string | null {
  if (!publishedAt) return null;
  const date = new Date(publishedAt);
  if (!Number.isFinite(date.getTime())) return null;
  const day = date.getDay();
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - ((day + 6) % 7)));
  return monday.toISOString().slice(0, 10);
}

function compareRank(left: GambitPoolEntry, right: GambitPoolEntry): number {
  const scoreDiff = right.rankScore - left.rankScore;
  if (Math.abs(scoreDiff) > 1e-9) return scoreDiff;
  return left.candidate.discoveredAt.localeCompare(right.candidate.discoveredAt);
}

function entrySignals(candidate: GambitCandidate, evidence: GambitEvidence[]): string[] {
  return strategicSubstance(evidence).signalTypes;
}

/**
 * Form the cross-source global pool, deduplicate the same event appearing in
 * several sources, rank event clusters deterministically, and return the
 * global Top-K for the expensive analysis path plus deferred/absorbed
 * clusters. One strategic event consumes ONE analysis slot; additional
 * reliable sources strengthen the representative (corroboration) rather than
 * creating duplicate LLM jobs.
 */
export function selectGlobalTopK(input: GlobalSelectionInput): GlobalSelectionResult {
  const now = input.now;
  const topK = Math.max(0, Math.floor(input.topK));

  const entries: GambitPoolEntry[] = input.candidates.map(({ candidate, evidence }) => {
    const signalTypes = entrySignals(candidate, evidence);
    const clusterKey = eventClusterKey({
      headline: candidate.headline,
      summary: candidate.summary,
      publishedAt: evidence[0]?.publishedAt ?? null,
      signalTypes,
      publisher: evidence[0]?.publisher ?? null,
    });
    return {
      candidate,
      evidence,
      clusterKey,
      rankScore: globalRankScore(candidate, evidence, signalTypes, 0, now),
      signalTypes,
      corroboratingEvidence: [],
      absorbedCandidateIds: [],
      absorbedSnapshotIds: [],
    };
  });
  entries.sort(compareRank);

  // Greedy clustering in rank order: the first (highest-ranked) member of a
  // cluster becomes its representative, so the representative is always the
  // strongest candidate and no later member can displace it.
  const clusters: GambitPoolEntry[][] = [];
  for (const entry of entries) {
    let placed = false;
    for (const cluster of clusters) {
      if (belongsToCluster(entry, cluster[0])) {
        cluster.push(entry);
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push([entry]);
  }

  const representatives: GambitPoolEntry[] = clusters.map(cluster => {
    const primary = cluster[0];
    const others = cluster.slice(1);
    const corroboratingEvidence = others.flatMap(entry => entry.evidence);
    return {
      ...primary,
      rankScore: globalRankScore(primary.candidate, [...primary.evidence, ...corroboratingEvidence], primary.signalTypes, others.length, now),
      corroboratingEvidence,
      absorbedCandidateIds: others.map(entry => entry.candidate.id ?? 0).filter(id => id > 0),
      absorbedSnapshotIds: others.flatMap(entry => entry.evidence.map(ev => ev.snapshotId)).filter(id => id > 0),
    };
  });
  representatives.sort(compareRank);

  const absorbed = clusters.flatMap(cluster => cluster.slice(1));
  return {
    selected: topK > 0 ? representatives.slice(0, topK) : [],
    deferred: topK > 0 ? representatives.slice(topK) : representatives,
    absorbed,
    eventDuplicates: absorbed.length,
  };
}
