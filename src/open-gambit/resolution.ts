import { canonicalJson, sha256Hex } from './canonical';
import { GambitRepository, type GambitDuePrediction } from './repository';
import type { GambitEvidence, GambitResolutionInput, GambitResolutionState } from './types';

export interface ResolutionEvaluation {
  state: GambitResolutionState;
  evaluatorResult: GambitResolutionInput['evaluatorResult'];
  reviewState: GambitResolutionInput['reviewState'];
  explanation: string;
  evidenceIds: number[];
  supersededReason?: string | null;
}

/**
 * Deterministic resolution is intentionally conservative. A deadline alone
 * cannot turn an unavailable evaluator into MISS; ambiguous outcomes become
 * UNRESOLVED and wait for review.
 */
export function evaluatePredictionEvidence(
  prediction: Pick<GambitDuePrediction, 'originalPredictionStatement' | 'originalObservableCondition' | 'originalFalsifier' | 'originalDeadline'>,
  evidence: GambitEvidence[],
): ResolutionEvaluation {
  const text = evidence.map(item => `${item.title ?? ''}\n${item.quote}`).join('\n').toLocaleLowerCase('en-US');
  const condition = prediction.originalObservableCondition.toLocaleLowerCase('en-US').trim();
  const falsifier = prediction.originalFalsifier.toLocaleLowerCase('en-US').trim();
  const conditionMatched = claimMatches(text, condition);
  const falsifierMatched = claimMatches(text, falsifier);
  if (conditionMatched && !falsifierMatched) {
    return {
      state: 'HIT',
      evaluatorResult: 'DETERMINISTIC',
      reviewState: 'NOT_REQUIRED',
      explanation: 'The evidence contains the observable condition and does not contain the supplied falsifier.',
      evidenceIds: evidence.map(item => item.id).filter((id): id is number => typeof id === 'number'),
    };
  }
  if (falsifierMatched && !conditionMatched) {
    return {
      state: 'MISS',
      evaluatorResult: 'DETERMINISTIC',
      reviewState: 'WAITING_FOR_REVIEW',
      explanation: 'The evidence contains the supplied falsifier without enough support for the observable condition; human review is required before public MISS.',
      evidenceIds: evidence.map(item => item.id).filter((id): id is number => typeof id === 'number'),
    };
  }
  return {
    state: 'UNRESOLVED',
    evaluatorResult: 'DETERMINISTIC',
    reviewState: 'WAITING_FOR_REVIEW',
    explanation: 'The available evidence does not deterministically establish HIT or MISS. The deadline and evaluator state are preserved without forcing an outcome.',
    evidenceIds: evidence.map(item => item.id).filter((id): id is number => typeof id === 'number'),
  };
}

export async function appendResolution(
  repository: GambitRepository,
  predictionId: number,
  evaluation: ResolutionEvaluation,
  now = new Date().toISOString(),
): Promise<{ id: number; idempotent: boolean }> {
  if (evaluation.state === 'SUPERSEDED' && (!evaluation.supersededReason || evaluation.evidenceIds.length === 0 || evaluation.reviewState !== 'APPROVED')) {
    throw new Error('SUPERSEDED_REQUIRES_REASON_EVIDENCE_AND_APPROVAL');
  }
  return repository.appendResolutionEvent({
    predictionId,
    state: evaluation.state,
    evaluatorResult: evaluation.evaluatorResult,
    reviewState: evaluation.reviewState,
    explanation: evaluation.explanation,
    evidenceIds: evaluation.evidenceIds,
    supersededReason: evaluation.supersededReason ?? null,
    now,
  });
}

export async function resolveDuePredictions(
  repository: GambitRepository,
  evidenceForPrediction: (prediction: GambitDuePrediction) => Promise<GambitEvidence[]>,
  options: { now?: Date; limit?: number } = {},
): Promise<{ checked: number; appended: number; unresolved: number }> {
  const now = options.now ?? new Date();
  const due = await repository.listDuePredictions(now.toISOString(), options.limit ?? 100);
  let appended = 0;
  let unresolved = 0;
  for (const prediction of due) {
    const evidence = await evidenceForPrediction(prediction);
    const evaluation = evaluatePredictionEvidence(prediction, evidence);
    const result = await appendResolution(repository, prediction.id, evaluation, now.toISOString());
    if (!result.idempotent) appended += 1;
    if (evaluation.state === 'UNRESOLVED') unresolved += 1;
  }
  return { checked: due.length, appended, unresolved };
}

export function resolutionEventFingerprint(input: Omit<ResolutionEvaluation, 'evidenceIds'> & { predictionId: number; evidenceIds: number[] }): Promise<string> {
  return sha256Hex(canonicalJson(input));
}

function meaningfulTerms(value: string): string[] {
  const stopWords = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'will', 'was', 'are', 'has', 'have', 'from', 'into', 'before', 'after', '一般', '已经']);
  return value.split(/[^\p{L}\p{N}]+/gu).filter(term => term.length >= 3 && !stopWords.has(term)).slice(0, 16);
}

function claimMatches(text: string, claim: string): boolean {
  if (!claim) return false;
  const normalizedClaim = claim.replace(/\s+/gu, ' ').trim();
  if (text.includes(normalizedClaim)) return true;
  const terms = meaningfulTerms(normalizedClaim);
  if (terms.length === 0) return false;
  const matches = terms.filter(term => text.includes(term)).length;
  const threshold = terms.length === 1 ? 1 : Math.max(2, Math.ceil(terms.length * 0.75));
  return matches >= threshold;
}
