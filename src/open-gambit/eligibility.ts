import type { GambitEvidence } from './types';

/**
 * Admission-rule version.
 *
 * Bump this whenever anything that can change a candidate's admission verdict
 * changes: a signal rule here, the matching granularity, the maintenance/noise
 * filters, or `qualificationGate`'s thresholds in `policy.ts`.
 *
 * It is an input to the candidate fingerprint (`sources.ts`), so bumping it
 * makes previously rejected items identifiable as new candidates and therefore
 * re-evaluated by the next discovery run. Without this, `findCandidateByFingerprint`
 * matches forever and a rules fix can never reach already-seen items -- which is
 * exactly how 58 production candidates stayed rejected after the rules were
 * changed. A bump is deliberate and one-off: it re-opens every previously seen
 * item exactly once.
 *
 * v2 = Phase 1 sliding-window matching, availability/platform signals, and the
 *      version-noise pre-filter (the v1 rules matched per clause and had zero
 *      intersection with the real corpus).
 */
export const GAMBIT_ELIGIBILITY_RULES_VERSION = 'gambit-eligibility-v2';

/** Analysis access, never publication approval. Signals must occur in the
 * preserved non-discovery evidence, not merely a headline or supplied score. */
export interface StrategicSubstance {
  signalTypes: string[];
  obviousNoise: boolean;
  score: number;
  detail: 'CONCRETE_STRATEGIC_EVENT' | 'ROUTINE_MAINTENANCE' | 'INSUFFICIENT_STRATEGIC_SUBSTANCE';
  /** Diagnostics for review: the widest window that produced the decision. */
  windowChars: number;
}

// Each rule combines an event/change with its strategic object or magnitude.
// Routine maintenance clauses are removed before matching: "fix protocol typo"
// must not acquire the significance of an actual protocol introduction.
const MAINTENANCE = /\b(?:chore|dependenc(?:y|ies)|typo|formatting|documentation[- ]only|docs?\s*:|bug\s*fix|fix(?:es|ed)?\b|minor\s+helper|helper\s+method|mime\s+enum|patch\s+release|updated\s+bundled|internal\/other\s+changes)\b/iu;
const EVENT = /\b(?:launch(?:es|ed)?|releas(?:e|es|ed|ing)|introduc(?:e|es|ed)|announc(?:e|es|ed)|unveil(?:s|ed)?|ship(?:s|ped)?|documents?)\b/iu;

/**
 * Strategic objects that can carry an availability event.
 *
 * Deliberately EXCLUDES convenience surfaces (`cli`, `library`, `tool`,
 * `plugin`, `extension`): measured on the real corpus, "You can now update it
 * ... with the new HfApi method ... or from the CLI" is a minor SDK helper, and
 * admitting it would forward weekly versioned release notes into expensive
 * analysis. The task's broad signal keeps its own, wider object list.
 */
const STRATEGIC_OBJECT = /\b(?:apis?|sdks?|platforms?|agents?|integrations?|developers?|models?|services?|endpoints?|protocols?|runtimes?|assistants?|copilot)\b/iu;

/** Entities that experience an access/eligibility change. */
const AUDIENCE = /\b(?:customers?|developers?|users?|teams?|organizations?|enterprises?|accounts?|plans?|tiers?)\b/iu;

/**
 * "expands trial availability" and "Eligibility has expanded from enterprises to
 * every plan" are the same event in two word orders, so the expansion check is
 * bidirectional within the window.
 */
const EXPANSION_VERB_NEAR_TIER = /\b(?:expand\w*|broaden\w*|extend\w*)\b.{0,80}\b(?:availability|access|eligibility|trial|waitlist|free\s+tier)\b|\b(?:availability|eligibility|trial|waitlist|free\s+tier)\b.{0,80}\b(?:expand\w*|broaden\w*|extend\w*)\b/iu;

/**
 * PRECISE signals: a concrete event plus in-window evidence of what it moves.
 * One precise signal is sufficient, exactly as before -- Phase 1 changes the
 * matching granularity and adds signals, it does not relax what counts as
 * evidence.
 */
const PRECISE_SIGNALS: Array<[string, (text: string) => boolean]> = [
  ['MODEL_LAUNCH', text => EVENT.test(text) && /\b(?:new|flagship|frontier|next[- ]generation)\b.{0,45}\bmodel\b/iu.test(text)],
  ['CAPABILITY_CHANGE', text => EVENT.test(text) && /\b(?:real[- ]time\s+(?:video|voice)|video\s+understanding|computer\s+use|autonomous\s+agents?|multimodal\s+reasoning)\b/iu.test(text)],
  ['PRICE_CHANGE', text => /\b(?:api|model|inference)\b/iu.test(text) && /\b(?:cut\w*|reduc\w*|lower\w*|increas\w*)\b.{0,60}\bpric\w*\b.{0,30}\b(?:[2-9]\d|100)%/iu.test(text)],
  ['ACCESS_CHANGE', text => /\b(?:paid|premium)\b.{0,90}\b(?:now|becomes?|made|makes?)\s+free\b/iu.test(text)
    || /\b(?:expand\w*|increas\w*)\b.{0,60}\bfree[- ]tier\b.{0,90}\bfrom\b.{0,30}\bto\b/iu.test(text)
    || /\b(?:remov\w*|lift\w*)\b.{0,50}\b(?:waitlist|access\s+restrictions?)\b/iu.test(text)],
  ['OPEN_RELEASE', text => EVENT.test(text) && /\b(?:open[- ]weights?|open[- ]source)\b/iu.test(text) && /\b(?:model|weights?|code|agent|platform)\b/iu.test(text)],
  ['INTEROPERABILITY', text => EVENT.test(text) && /\b(?:interoperability\s+(?:protocol|standard)|compatibility\s+(?:layer|standard)|open\s+protocol\s+adapter|protocol\s+for\s+(?:agents?|developers?))\b/iu.test(text)],
  ['DEFAULT_DISTRIBUTION', text => /\b(?:makes?|sets?|selects?|becomes?|bundl\w*)\b.{0,100}\b(?:default\s+model|enterprise\s+suite|preinstalled)\b/iu.test(text)],
  ['ACQUISITION', text => /\b(?:acquir\w*|acquisition\s+of|merg\w*\s+with)\b.{0,80}\b(?:developer|platform|cloud|model|ai|software)\b/iu.test(text)],
  ['CLOUD_PARTNERSHIP', text => /\b(?:sign\w*|announc\w*|enter\w*)\b.{0,60}\bcloud\s+partnership\b/iu.test(text) && /\b(?:distribut\w*|host\w*|compute|model)\b/iu.test(text)],
  ['COMPUTE_INCENTIVE', text => /\b(?:provid\w*|offer\w*|subsid\w*|allocat\w*)\b/iu.test(text) && /\bcompute\s+(?:credits?|subsid\w*)\b/iu.test(text) && /(?:\$\s*\d|\b\d+\s*(?:million|billion))/iu.test(text)],
  ['FORCED_MIGRATION', text => /\b(?:deprecat\w*|retir\w*|discontinu\w*|sunset\w*|end[- ]of[- ]life)\b/iu.test(text)
    && /\b(?:api|model|endpoint|sdk|service|version)\b/iu.test(text)
    && /\b(?:migrat\w*|replac\w*|requires?|alternativ\w*|upgrade)\b/iu.test(text)],
  ['CONTEXT_EXPANSION', text => /\b(?:increas\w*|expand\w*)\b.{0,60}\bcontext\s+window\b.{0,70}\bfrom\s+\d[\w.]*\s+to\s+\d/iu.test(text)],

  // --- Phase 1 additions: availability and access wording that real
  // first-party announcements use instead of "launch/release". Each one still
  // requires a strategic object, so a tooling detail such as "CodeQL is now
  // available on Linux ARM64" (no API/SDK/platform object, no event verb) does
  // not qualify.
  ['ANNOUNCED_CAPABILITY', text => /\byou can now\b/iu.test(text) && STRATEGIC_OBJECT.test(text)],
  ['GENERAL_AVAILABILITY', text => /\bis now generally available\b/iu.test(text) && STRATEGIC_OBJECT.test(text)],
  ['CAPABILITY_AVAILABILITY', text => /\b(?:is|are) now (?:available|supported|enabled)\b/iu.test(text) && STRATEGIC_OBJECT.test(text)],
  ['AVAILABILITY_EXPANSION', text => EXPANSION_VERB_NEAR_TIER.test(text)
    && (STRATEGIC_OBJECT.test(text) || AUDIENCE.test(text))],
  // "customers can now start a self-serve ... trial", "eligibility has expanded
  // from ... to ...": an access-tier opening is a strategic event even when no
  // API/SDK word appears, but it must name an ACCESS TIER.
  //
  // `preview` and `public beta` are deliberately NOT in this tier list: "available
  // in public preview" is a release-stage phrase on virtually every GitHub
  // changelog post, and treating it as an access tier admitted "Xcode 27 runner
  // image now runs on macOS 27" -- a CI image update with no strategic
  // mechanism. Release stage alone is the broad signal's business.
  ['ACCESS_OPENING', text => /\b(?:can now|now open to|is now open|no longer requires|now available to)\b/iu.test(text)
    && /\b(?:trial|waitlist|free\s+tier|early\s+access|eligibility|general\s+availability)\b/iu.test(text)],
  ['PLATFORM_MIGRATION', text => /\bnow runs? on\b/iu.test(text) && STRATEGIC_OBJECT.test(text)],
];

/**
 * BROAD signals: plausible but individually weak wording. A broad signal is
 * NEVER sufficient on its own -- it must co-occur with at least one other signal
 * in the same window. Without that constraint these two would forward routine
 * release-note noise (for example "anthropic-sdk-python v0.124.0" release text
 * mentioning a release and an SDK) into expensive analysis and burn budget.
 */
const BROAD_SIGNALS: Array<[string, (text: string) => boolean]> = [
  ['DEVELOPER_PLATFORM_CAPABILITY', text => /\b(?:announc\w*|introduc\w*|releas\w*|launch\w*|preview|ga)\b/iu.test(text) && STRATEGIC_OBJECT.test(text)],
  ['ACCESS_TIER_CHANGE', text => /\b(?:rate\s?limits?|quotas?|usage\s+limits?|tiers?|seats?|pricing\s+page)\b/iu.test(text)
    && /\b(?:increas\w*|decreas\w*|reduc\w*|rais\w*|lower\w*|expand\w*|remov\w*|new|more|less|additional)\b/iu.test(text)],
];

/**
 * Window size in characters.
 *
 * Real first-party announcements routinely split the event from its object
 * across two sentences ("You can now manage GitHub code scanning's AI Scan ...
 * with REST API endpoints ... . This public preview gives teams ..."), and the
 * previous per-clause matching could never see both halves, which is why the
 * twelve signals had ZERO intersection with 98 real corpus items.
 *
 * The window is built by accumulating CONSECUTIVE material clauses until this
 * many characters are reached, then sliding forward by one clause. It is bounded
 * and word-safe (no mid-word windows), and maintenance clauses are already
 * removed, so a window cannot borrow significance from a "bug fix" line.
 *
 * Measured on the frozen real corpus (see
 * tests/fixtures/open-gambit/real-corpus-2026-09-11.json): 320 characters admits
 * the genuine strategic announcements while the version-noise pre-filter and the
 * broad-signal co-occurrence constraint keep routine release notes out.
 */
const WINDOW_TARGET_CHARS = 320;

/** A single clause longer than the window is split further, on commas only. */
const LONG_CLAUSE_CHARS = 480;

export function strategicSubstance(evidence: GambitEvidence[]): StrategicSubstance {
  const clauses = evidence.filter(item => item.sourceTier !== 'DISCOVERY_ONLY' && item.quote.trim().length >= 20)
    .flatMap(item => splitClauses(item.quote.slice(0, 12_000)));
  const materialClauses = clauses.filter(text => !MAINTENANCE.test(text));
  const windows = slidingWindows(materialClauses);
  let widest = 0;
  const signalTypes = new Set<string>();

  for (const window of windows) {
    const precise = PRECISE_SIGNALS.filter(([, matches]) => matches(window)).map(([name]) => name);
    const broad = BROAD_SIGNALS.filter(([, matches]) => matches(window)).map(([name]) => name);
    // A precise signal stands on its own, and corroborates any broad signal in
    // the same window. Broad signals alone need at least two of them.
    const admitted = precise.length > 0
      ? [...precise, ...broad]
      : broad.length >= 2 ? broad : [];
    if (admitted.length === 0) continue;
    widest = Math.max(widest, window.length);
    for (const name of admitted) signalTypes.add(name);
  }

  const matched = [...signalTypes];
  const obviousNoise = matched.length === 0 && clauses.some(text => MAINTENANCE.test(text));
  return {
    signalTypes: matched,
    obviousNoise,
    score: matched.length > 0 ? Math.min(0.85, 0.65 + (matched.length - 1) * 0.1) : 0.2,
    detail: matched.length > 0 ? 'CONCRETE_STRATEGIC_EVENT' : obviousNoise ? 'ROUTINE_MAINTENANCE' : 'INSUFFICIENT_STRATEGIC_SUBSTANCE',
    windowChars: widest,
  };
}

/** Split evidence text into clause-sized units; see `slidingWindows`. */
function splitClauses(text: string): string[] {
  const withoutUrls = text.replace(/https?:\/\/\S+/gu, ' ');
  const clauses: string[] = [];
  for (const clause of withoutUrls.split(/[\n;.!?]+/u)) {
    const trimmed = clause.trim();
    if (!trimmed) continue;
    if (trimmed.length <= LONG_CLAUSE_CHARS) {
      clauses.push(trimmed);
      continue;
    }
    // A very long clause (release-note prose with few sentence breaks) is split
    // on commas so one window cannot silently span thousands of characters.
    let buffer = '';
    for (const part of trimmed.split(',')) {
      const piece = part.trim();
      if (!piece) continue;
      if (buffer && buffer.length + piece.length > LONG_CLAUSE_CHARS) {
        clauses.push(buffer);
        buffer = piece;
      } else {
        buffer = buffer ? `${buffer}, ${piece}` : piece;
      }
    }
    if (buffer) clauses.push(buffer);
  }
  return clauses;
}

/**
 * Consecutive-clause windows of at least `WINDOW_TARGET_CHARS`, sliding by one
 * clause. A clause longer than the target is its own window, which matches the
 * previous clause-level behaviour for such text rather than expanding it.
 */
function slidingWindows(clauses: string[]): string[] {
  const windows: string[] = [];
  for (let start = 0; start < clauses.length; start += 1) {
    let text = '';
    for (let end = start; end < clauses.length; end += 1) {
      text = text ? `${text} ${clauses[end]}` : clauses[end];
      if (text.length >= WINDOW_TARGET_CHARS) break;
    }
    windows.push(text);
  }
  return windows;
}
