import {
  GAMBIT_PROBABILITY_BUCKETS,
  GAMBIT_REJECTION_REASONS,
  type GambitCandidate,
  type GambitEvidence,
  type GambitProbability,
  type GambitPublicationDecision,
  type GambitRejectionReason,
  type GambitTriageResult,
} from './types';

/**
 * This is deliberately a high-signal policy gate, not a claim that keyword
 * matching can understand every article. A candidate that looks political is
 * held out of publication and can be reviewed; it is never silently relabeled
 * as technology analysis.
 */
const POLITICAL_PATTERNS: Array<[string, RegExp]> = [
  ['politician', /\b(?:president|prime\s+minister|senator|congress(?:man|woman)?|governor|mayor|minister|politician|政党|总统|总理|议员|政治人物)\b/iu],
  ['party_or_election', /\b(?:political\s+party|party\s+leader|election|electoral|ballot|campaign|vote|voting|partisan|政党|选举|竞选|投票|党派)\b/iu],
  ['geopolitics_or_war', /\b(?:geopolitics?|geopolitical|diplomatic|diplomacy|foreign\s+policy|military|war|invasion|ceasefire|sanctions|geopolitics|地缘政治|外交|军事|战争|制裁)\b/iu],
  ['ideology_or_culture_war', /\b(?:ideolog(?:y|ical)|culture\s+war|partisan\s+controversy|left[-\s]wing|right[-\s]wing|极左|极右|意识形态|文化战争)\b/iu],
  ['legislative_conflict', /\b(?:parliament|congress|legislature|bill|legislation|lawmaker|impeach|filibuster|legislative\s+fight|议会|国会|立法|法案|议员|弹劾)\b/iu],
  ['government_strategy', /\b(?:government\s+strategy|state\s+strategy|government\s+as\s+(?:a\s+)?political\s+actor|政府战略|国家战略)\b/iu],
];

const TECHNOLOGY_CONTEXT = /\b(?:ai|artificial\s+intelligence|model|agent|api|protocol|software|developer|cloud|compute|open\s*source|repository|product|platform|acquisition|merger|regulator|regulatory|filing|company|lab|价格|模型|代理|软件|开发者|云|开源|产品|平台|收购|监管|申报)\b/iu;
const GOVERNMENT_POLICY_ONLY = /\b(?:government|regulator|regulation|regulatory|filing|agency|ministry|政府|监管机构|法规|申报|机构)\b/iu;

export interface PoliticalTopicDecision {
  politicalTopic: boolean;
  reasons: string[];
  matchedSignals: string[];
}

export function detectPoliticalTopic(...texts: Array<string | null | undefined>): PoliticalTopicDecision {
  const haystack = texts.filter(Boolean).join('\n').trim();
  const matchedSignals: string[] = [];
  for (const [name, pattern] of POLITICAL_PATTERNS) {
    if (pattern.test(haystack)) matchedSignals.push(name);
  }

  // Regulatory filings can be factual context for a company/product event.
  // A government-only item with no technology context remains excluded.
  const politicalTopic = matchedSignals.length > 0
    || (GOVERNMENT_POLICY_ONLY.test(haystack) && !TECHNOLOGY_CONTEXT.test(haystack));
  const reasons = politicalTopic
    ? matchedSignals.length > 0
      ? ['POLITICAL_TOPIC_EXCLUDED', ...matchedSignals]
      : ['POLITICAL_TOPIC_EXCLUDED', 'government_or_regulator_is_primary_subject']
    : [];
  return { politicalTopic, reasons, matchedSignals };
}

export function isProbabilityBucket(value: unknown): value is GambitProbability {
  return typeof value === 'number'
    && GAMBIT_PROBABILITY_BUCKETS.includes(value as GambitProbability);
}

export function normalizeProbabilityBucket(value: number): GambitProbability {
  const bounded = Math.min(80, Math.max(20, Number.isFinite(value) ? value : 50));
  let best: GambitProbability = GAMBIT_PROBABILITY_BUCKETS[0];
  let distance = Math.abs(bounded - best);
  for (const bucket of GAMBIT_PROBABILITY_BUCKETS) {
    const nextDistance = Math.abs(bounded - bucket);
    if (nextDistance < distance || (nextDistance === distance && bucket > best)) {
      best = bucket;
      distance = nextDistance;
    }
  }
  return best;
}

export function isAbsoluteDeadline(value: string): boolean {
  const parsed = new Date(value);
  return value.trim().length > 0 && Number.isFinite(parsed.getTime()) && /\d{4}/.test(value);
}

export interface QualificationInput {
  headline: string;
  summary: string;
  content: string;
  evidence: GambitEvidence[];
  strategicValue?: number;
  falsifiable?: boolean;
  politicalTopic?: boolean;
}

export interface QualificationDecision {
  qualified: boolean;
  reason: GambitRejectionReason | null;
  politicalTopic: boolean;
  politicalReasons: string[];
  evidenceSufficient: boolean;
  strategicValue: number;
  falsifiable: boolean;
  scores: {
    strategicLeverage: number;
    ecosystemEffect: number;
    competitorPressure: number;
    standardsDistribution: number;
    switchingCost: number;
    economicIncentive: number;
    evidenceQuality: number;
    novelty: number;
    falsifiability: number;
    readerRelevance: number;
  };
}

export function qualificationGate(input: QualificationInput): QualificationDecision {
  const political = detectPoliticalTopic(input.headline, input.summary, input.content);
  const politicalTopic = input.politicalTopic === true || political.politicalTopic;
  const evidenceSufficient = input.evidence.length > 0
    && input.evidence.some(evidence => evidence.sourceTier !== 'DISCOVERY_ONLY' && evidence.quote.trim().length >= 20);
  const quality = input.evidence.length === 0
    ? 0
    : Math.min(1, input.evidence.reduce((total, evidence) => total + (
      evidence.sourceTier === 'PRIMARY_OFFICIAL' ? 1
        : evidence.sourceTier === 'PRIMARY_REPOSITORY' ? 0.9
          : evidence.sourceTier === 'PRIMARY_DOCUMENTATION' ? 0.85
            : evidence.sourceTier === 'SECONDARY_HIGH_QUALITY' ? 0.65 : 0.25
    ), 0) / input.evidence.length);
  const strategicValue = Math.max(0, Math.min(1, input.strategicValue ?? inferStrategicValue(input)));
  const falsifiable = input.falsifiable ?? inferFalsifiability(input);
  const scores = {
    strategicLeverage: strategicValue,
    ecosystemEffect: strategicValue,
    competitorPressure: strategicValue * 0.9,
    standardsDistribution: strategicValue * 0.8,
    switchingCost: strategicValue * 0.75,
    economicIncentive: strategicValue * 0.8,
    evidenceQuality: quality,
    novelty: strategicValue,
    falsifiability: falsifiable ? 0.85 : 0.15,
    readerRelevance: strategicValue,
  };

  let reason: GambitRejectionReason | null = null;
  if (politicalTopic) reason = 'POLITICAL_TOPIC_EXCLUDED';
  else if (!evidenceSufficient) reason = 'INSUFFICIENT_EVIDENCE';
  else if (!falsifiable) reason = 'NON_FALSIFIABLE';
  else if (strategicValue < 0.45) reason = 'LOW_STRATEGIC_VALUE';

  return {
    qualified: reason === null,
    reason,
    politicalTopic,
    politicalReasons: political.reasons,
    evidenceSufficient,
    strategicValue,
    falsifiable,
    scores,
  };
}

function inferStrategicValue(input: QualificationInput): number {
  const text = `${input.headline} ${input.summary} ${input.content}`;
  const signals = [
    /\b(?:protocol|standard|api|platform|distribution|ecosystem|dependency|switching|pricing|acquisition|open\s*source|compute|agent)\b/iu,
    /\b(?:competitor|developer|enterprise|adoption|compatible|default|deprecate|launch|release)\b/iu,
  ];
  return Math.min(1, signals.reduce((score, pattern) => score + (pattern.test(text) ? 0.28 : 0), 0.2));
}

function inferFalsifiability(input: QualificationInput): boolean {
  const text = `${input.headline} ${input.summary} ${input.content}`;
  return /\b(?:before|by|after|within|support|adopt|release|launch|price|default|deprecat|officially|measur|confirm|deadline)\b/iu.test(text)
    || /(?:之前|截至|支持|采用|发布|上线|价格|默认|官方|期限|验证)/u.test(text);
}

export function validateTrajectoryCount(trajectories: unknown): trajectories is unknown[] {
  return Array.isArray(trajectories) && trajectories.length <= 3;
}

export function validatePublicForecast(
  trajectory: { probability: unknown; deadline: string; predictionStatement?: string; targetEntity?: string; reasoning?: string; evidenceCriteria?: string; falsifier?: string },
): string[] {
  const errors: string[] = [];
  if (!isProbabilityBucket(trajectory.probability)) errors.push('PROBABILITY_NOT_BUCKETED');
  if (!isAbsoluteDeadline(trajectory.deadline)) errors.push('DEADLINE_NOT_ABSOLUTE');
  for (const field of ['predictionStatement', 'targetEntity', 'reasoning', 'evidenceCriteria', 'falsifier'] as const) {
    if (typeof trajectory[field] !== 'string' || trajectory[field]!.trim().length < 3) errors.push(`${field.toUpperCase()}_MISSING`);
  }
  return errors;
}

export function validateAnalysisForPublication(
  candidate: Pick<GambitCandidate, 'politicalTopic'>,
  analysis: { trajectories: Array<{ probability: unknown; deadline: string; predictionStatement?: string; targetEntity?: string; reasoning?: string; evidenceCriteria?: string; falsifier?: string }>; thesis: string; facts: string[] },
  critic: { accepted: boolean; politicalFraming: boolean; motiveConcern?: boolean; causalConcern?: boolean; sensationalismConcern?: boolean; falsifiabilityConcern?: boolean },
): string[] {
  const errors: string[] = [];
  if (candidate.politicalTopic) errors.push('POLITICAL_TOPIC_EXCLUDED');
  if (critic.politicalFraming) errors.push('CRITIC_POLITICAL_FRAMING');
  if (critic.motiveConcern) errors.push('CRITIC_UNSUPPORTED_MOTIVE');
  if (critic.causalConcern) errors.push('CRITIC_WEAK_CAUSALITY');
  if (critic.sensationalismConcern) errors.push('CRITIC_SENSATIONALISM');
  if (critic.falsifiabilityConcern) errors.push('CRITIC_FALSIFIABILITY');
  if (!analysis.thesis.trim()) errors.push('THESIS_MISSING');
  if (!Array.isArray(analysis.facts) || analysis.facts.length === 0) errors.push('FACTS_MISSING');
  if (!validateTrajectoryCount(analysis.trajectories)) errors.push('TRAJECTORY_COUNT_OUT_OF_RANGE');
  for (const trajectory of analysis.trajectories) errors.push(...validatePublicForecast(trajectory));
  if (!critic.accepted) errors.push('CRITIC_REJECTED');
  return [...new Set(errors)];
}

/**
 * Map deterministic gate failures to the persisted/publication decision. The
 * only decision that may enter the automatic publication path is the explicit
 * success value; every other value is a hold or a no-publish outcome.
 */
export function publicationDecisionForErrors(errors: readonly string[]): GambitPublicationDecision {
  if (errors.includes('POLITICAL_TOPIC_EXCLUDED') || errors.includes('CRITIC_POLITICAL_FRAMING')) return 'POLITICAL_TOPIC_EXCLUDED';
  if (errors.some(error => error.includes('EVIDENCE'))) return 'INSUFFICIENT_EVIDENCE';
  if (errors.some(error => error.includes('MOTIVE'))) return 'UNSUPPORTED_MOTIVE';
  if (errors.some(error => error.includes('FALSIF') || error.includes('DEADLINE') || error.includes('TRAJECTORY'))) return 'NON_FALSIFIABLE';
  if (errors.some(error => error.startsWith('CRITIC_'))) return 'NEEDS_HUMAN_REVIEW';
  if (errors.some(error => error.includes('STRATEGIC') || error.includes('CAUSAL'))) return 'LOW_STRATEGIC_VALUE';
  return 'NEEDS_HUMAN_REVIEW';
}

export interface AutomaticPublicationGate {
  decision: GambitPublicationDecision;
  errors: string[];
}

export function publicationDecisionForReason(reason: string | null | undefined): GambitPublicationDecision {
  switch (reason) {
    case 'INSUFFICIENT_EVIDENCE': return 'INSUFFICIENT_EVIDENCE';
    case 'POLITICAL_TOPIC_EXCLUDED': return 'POLITICAL_TOPIC_EXCLUDED';
    case 'DUPLICATE':
    case 'DUPLICATE_EVENT': return 'DUPLICATE';
    case 'LOW_STRATEGIC_VALUE': return 'LOW_STRATEGIC_VALUE';
    case 'NON_FALSIFIABLE': return 'NON_FALSIFIABLE';
    case 'UNSUPPORTED_MOTIVE': return 'UNSUPPORTED_MOTIVE';
    case 'NEEDS_HUMAN_REVIEW': return 'NEEDS_HUMAN_REVIEW';
    case 'NO_GAMBIT_WORTH_PUBLISHING': return 'NO_GAMBIT_WORTH_PUBLISHING';
    default: return 'NO_GAMBIT_WORTH_PUBLISHING';
  }
}

export function deterministicPublicationGate(
  candidate: Pick<GambitCandidate, 'politicalTopic'>,
  analysis: { trajectories: Array<{ probability: unknown; deadline: string; predictionStatement?: string; targetEntity?: string; reasoning?: string; evidenceCriteria?: string; falsifier?: string }>; thesis: string; facts: string[] },
  critic: { accepted: boolean; politicalFraming: boolean; motiveConcern?: boolean; causalConcern?: boolean; sensationalismConcern?: boolean; falsifiabilityConcern?: boolean },
): AutomaticPublicationGate {
  const errors = validateAnalysisForPublication(candidate, analysis, critic);
  return {
    errors,
    decision: errors.length === 0 ? 'AUTO_PUBLISH_ELIGIBLE' : publicationDecisionForErrors(errors),
  };
}

export function rejectionReasonIsKnown(value: string): value is GambitRejectionReason {
  return GAMBIT_REJECTION_REASONS.includes(value as GambitRejectionReason);
}

export function makeCandidateFromDecision(input: {
  id?: number;
  fingerprint: string;
  headline: string;
  summary: string;
  canonicalUrl: string;
  snapshotIds: number[];
  sourceIds: string[];
  decision: QualificationDecision;
  discoveredAt: string;
}): GambitCandidate {
  return {
    id: input.id,
    fingerprint: input.fingerprint,
    headline: input.headline,
    summary: input.summary,
    canonicalUrl: input.canonicalUrl,
    snapshotIds: input.snapshotIds,
    sourceIds: input.sourceIds,
    politicalTopic: input.decision.politicalTopic,
    politicalReasons: input.decision.politicalReasons,
    evidenceSufficient: input.decision.evidenceSufficient,
    strategicValue: input.decision.strategicValue,
    falsifiable: input.decision.falsifiable,
    status: input.decision.qualified ? 'QUALIFIED' : 'REJECTED',
    rejectionReason: input.decision.reason,
    discoveredAt: input.discoveredAt,
  };
}

export function triageAllowsDeepAnalysis(result: GambitTriageResult): boolean {
  return result.shouldDeepAnalysisRun
    && result.aiTechRelevance
    && !result.politicsExcluded
    && result.evidenceSufficient
    && result.eventImportance >= 0.45;
}
