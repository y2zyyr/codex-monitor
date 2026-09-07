import type { GambitEvidence } from './types';

/** Analysis access, never publication approval. Signals must occur in the
 * preserved non-discovery evidence, not merely a headline or supplied score. */
export interface StrategicSubstance {
  signalTypes: string[];
  obviousNoise: boolean;
  score: number;
  detail: 'CONCRETE_STRATEGIC_EVENT' | 'ROUTINE_MAINTENANCE' | 'INSUFFICIENT_STRATEGIC_SUBSTANCE';
}

// Each rule combines an event/change with its strategic object or magnitude.
// Routine maintenance clauses are removed before matching: "fix protocol typo"
// must not acquire the significance of an actual protocol introduction.
const MAINTENANCE = /\b(?:chore|dependenc(?:y|ies)|typo|formatting|documentation[- ]only|docs?\s*:|bug\s*fix|fix(?:es|ed)?\b|minor\s+helper|helper\s+method|mime\s+enum|patch\s+release|updated\s+bundled|internal\/other\s+changes)\b/iu;
const EVENT = /\b(?:launch(?:es|ed)?|releas(?:e|es|ed|ing)|introduc(?:e|es|ed)|announc(?:e|es|ed)|unveil(?:s|ed)?|ship(?:s|ped)?|documents?)\b/iu;
const SIGNALS: Array<[string, (text: string) => boolean]> = [
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
  ['FORCED_MIGRATION', text => /\b(?:deprecat\w*|retir\w*|discontinu\w*)\b.{0,60}\bapi\b/iu.test(text) && /\b(?:migrat\w*|replac\w*|requires?)\b/iu.test(text)],
  ['CONTEXT_EXPANSION', text => /\b(?:increas\w*|expand\w*)\b.{0,60}\bcontext\s+window\b.{0,70}\bfrom\s+\d[\w.]*\s+to\s+\d/iu.test(text)],
];

export function strategicSubstance(evidence: GambitEvidence[]): StrategicSubstance {
  const clauses = evidence.filter(item => item.sourceTier !== 'DISCOVERY_ONLY' && item.quote.trim().length >= 20)
    .flatMap(item => item.quote.slice(0, 12_000).replace(/https?:\/\/\S+/gu, '').split(/[\n;.!?]+/u));
  const materialClauses = clauses.filter(text => !MAINTENANCE.test(text));
  const signalTypes = SIGNALS.filter(([, matches]) => materialClauses.some(matches)).map(([name]) => name);
  const obviousNoise = signalTypes.length === 0 && clauses.some(text => MAINTENANCE.test(text));
  return {
    signalTypes,
    obviousNoise,
    score: signalTypes.length > 0 ? Math.min(0.85, 0.65 + (signalTypes.length - 1) * 0.1) : 0.2,
    detail: signalTypes.length > 0 ? 'CONCRETE_STRATEGIC_EVENT' : obviousNoise ? 'ROUTINE_MAINTENANCE' : 'INSUFFICIENT_STRATEGIC_SUBSTANCE',
  };
}
