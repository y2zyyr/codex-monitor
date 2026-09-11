import { describe, expect, it } from 'vitest';
import { runQualifiedGambitWorkflow, runGambitStages } from '../src/open-gambit/pipeline';
import { MockGambitProvider } from '../src/open-gambit/llm';
import { GAMBIT_ELIGIBILITY_RULES_VERSION } from '../src/open-gambit/eligibility';
import { fingerprintCandidate } from '../src/open-gambit/sources';
import type {
  GambitCandidate,
  GambitDraft,
  GambitEvidence,
  GambitLLMResponse,
  GambitSourceSnapshot,
} from '../src/open-gambit/types';
import type { GambitRepository } from '../src/open-gambit/repository';

/**
 * Open Gambit — T2 regression: analysis determinism and rule-version re-admission.
 *
 * Phase 0 measured the analysis stage flipping between QUALIFIED and NO_GAMBIT
 * on roughly half of replays of an IDENTICAL request with identical evidence
 * (the client samples at temperature 0.1). Two production properties turned that
 * flip into permanent loss:
 *
 *   1. there was no retry path -- the first NO_GAMBIT was terminal;
 *   2. candidate fingerprints are stable, so the item was never seen again.
 *
 * These tests pin the bounded re-sample, the verdict-preserving failure rule,
 * the persisted retry counter, and rule-version-driven re-admission.
 */

function llm<T>(value: T): GambitLLMResponse<T> {
  return { value, provider: 'TEST_ONLY_PROVIDER', modelId: 'TEST_ONLY_RUNTIME_MODEL', latencyMs: 1 };
}

const TRIAGE = {
  eventImportance: 0.9,
  aiTechRelevance: true,
  politicsExcluded: false,
  evidenceSufficient: true,
  strategicMechanism: 'Compatibility lowers switching costs.',
  shouldDeepAnalysisRun: true,
  reason: 'TEST_ONLY',
};

const QUALIFIED_ANALYSIS = {
  decision: 'QUALIFIED' as const,
  facts: ['The primary source documents the compatibility standard.'],
  evidenceIds: [901],
  obviousLogic: 'Compatibility expands reachable distribution.',
  thesis: 'The standard is a distribution wedge across developer tools.',
  mechanism: 'Lower switching costs encourage ecosystem adoption.',
  beneficiaries: ['Developers'],
  pressuredActors: ['Closed integration vendors'],
  countercase: 'Adoption may remain limited despite the standard.',
  trajectories: [{
    id: 'trajectory-1',
    predictionStatement: 'The standard will be available to developers.',
    targetEntity: 'TEST_ONLY compatibility standard',
    probability: 70,
    deadline: '2026-12-31',
    reasoning: 'The source documents availability work and a distribution incentive.',
    evidenceCriteria: 'A primary source confirms availability to developers.',
    falsifier: 'A primary source says the standard was cancelled.',
    status: 'WATCHING' as const,
  }],
  uncertainty: 'Execution and adoption remain uncertain.',
};

const NO_GAMBIT_ANALYSIS = { decision: 'NO_GAMBIT_WORTH_PUBLISHING' as const, reason: 'TEST_ONLY nothing publishable.' };

const fixtureCandidate: GambitCandidate = {
  id: 901,
  fingerprint: 'd'.repeat(64),
  headline: 'TEST_ONLY compatibility standard changes developer distribution',
  summary: 'A documented compatibility standard will be available to developers before 2026-12-31.',
  canonicalUrl: 'https://test-only.example/standard',
  snapshotIds: [901],
  sourceIds: ['test-only-source'],
  politicalTopic: false,
  politicalReasons: [],
  evidenceSufficient: true,
  strategicValue: 0.9,
  falsifiable: true,
  status: 'QUALIFIED',
  rejectionReason: null,
  discoveredAt: '2026-09-05T00:00:00.000Z',
};

const fixtureSnapshot: GambitSourceSnapshot = {
  id: 901,
  sourceId: 'test-only-source',
  requestedUrl: 'https://test-only.example/standard',
  finalUrl: 'https://test-only.example/standard',
  canonicalUrl: 'https://test-only.example/standard',
  title: 'TEST_ONLY compatibility standard',
  publisher: 'TEST_ONLY publisher',
  publishedAt: '2026-09-05T00:00:00.000Z',
  retrievedAt: '2026-09-05T00:01:00.000Z',
  normalizedContent: 'TEST_ONLY publisher documents a compatibility standard that will be available to developers before 2026-12-31 and lowers switching costs.',
  contentHash: 'e'.repeat(64),
  extractorVersion: 'gambit-html-1',
  sourceQualityTier: 'PRIMARY_OFFICIAL',
};

/**
 * Analysis provider that replays a fixed verdict sequence and counts calls.
 * `new Error(...)` entries simulate a provider/transport failure.
 */
function sequencedAnalysisProvider(sequence: Array<unknown | Error>) {
  let index = 0;
  const provider = new MockGambitProvider(async () => {
    const next = sequence[Math.min(index, sequence.length - 1)];
    index += 1;
    if (next instanceof Error) throw next;
    return llm(next);
  });
  return { provider, calls: () => index };
}

const fixtureEvidence: GambitEvidence = {
  snapshotId: 901,
  sourceId: 'test-only-source',
  sourceTier: 'PRIMARY_OFFICIAL',
  canonicalUrl: 'https://test-only.example/standard',
  title: 'TEST_ONLY compatibility standard',
  publisher: 'TEST_ONLY publisher',
  publishedAt: '2026-09-05T00:00:00.000Z',
  quote: fixtureSnapshot.normalizedContent,
  role: 'FACT',
  contentHash: 'e'.repeat(64),
};

function triageProvider() {
  return new MockGambitProvider(async () => llm(TRIAGE));
}

class AnalysisRetryFixtureRepository {
  candidate = { ...fixtureCandidate };
  workflow: { status: string } | null = null;
  analysisAttempts: number | null = null;
  statuses: string[] = [];

  async getWorkflowResult() {
    return this.workflow;
  }

  async getCandidate() {
    return this.candidate;
  }

  async setCandidateStatus(_id: number, status: GambitCandidate['status'], rejectionReason: string | null = null) {
    this.candidate.status = status;
    this.candidate.rejectionReason = rejectionReason as GambitCandidate['rejectionReason'];
    this.statuses.push(status);
  }

  async getSnapshots() {
    return [fixtureSnapshot];
  }

  async recordLLMAttempt() {
    return 1;
  }

  async recordCandidateAnalysisAttempts(_id: number, attempts: number) {
    this.analysisAttempts = attempts;
  }

  async recordWorkflowResult(input: { result: { status: string } }) {
    this.workflow = { status: input.result.status };
  }

  async createArticleDraft(draft: GambitDraft) {
    return { articleId: 901, revisionId: 902, draft };
  }
}

describe('Open Gambit analysis bounded retry', () => {
  it('upgrades a first-attempt NO_GAMBIT to QUALIFIED on one bounded re-sample', async () => {
    const analysis = sequencedAnalysisProvider([NO_GAMBIT_ANALYSIS, QUALIFIED_ANALYSIS]);
    const result = await runGambitStages(fixtureCandidate, [fixtureEvidence], {
      providers: { triage: triageProvider(), gambit_analysis: analysis.provider },
    });

    expect(analysis.calls()).toBe(2);
    expect(result.analysisAttempts).toBe(1);
    expect(result.analysis?.decision).toBe('QUALIFIED');
    expect(result.status).not.toBe('NO_GAMBIT');
  });

  it('stops after exactly one retry when the model insists on NO_GAMBIT', async () => {
    const analysis = sequencedAnalysisProvider([NO_GAMBIT_ANALYSIS, NO_GAMBIT_ANALYSIS]);
    const result = await runGambitStages(fixtureCandidate, [fixtureEvidence], {
      providers: { triage: triageProvider(), gambit_analysis: analysis.provider },
    });

    expect(analysis.calls()).toBe(2);
    expect(result.analysisAttempts).toBe(1);
    expect(result.status).toBe('NO_GAMBIT');
    expect(result.publicationDecision).toBe('NO_GAMBIT_WORTH_PUBLISHING');
  });

  it('spends no retry when the first attempt already qualifies', async () => {
    const analysis = sequencedAnalysisProvider([QUALIFIED_ANALYSIS]);
    const result = await runGambitStages(fixtureCandidate, [fixtureEvidence], {
      providers: { triage: triageProvider(), gambit_analysis: analysis.provider },
    });

    expect(analysis.calls()).toBe(1);
    expect(result.analysisAttempts).toBe(0);
    expect(result.analysis?.decision).toBe('QUALIFIED');
  });

  it('keeps the first valid NO_GAMBIT verdict when the retry fails operationally', async () => {
    const analysis = sequencedAnalysisProvider([NO_GAMBIT_ANALYSIS, new Error('TEST_ONLY_PROVIDER_FAILURE')]);
    const result = await runGambitStages(fixtureCandidate, [fixtureEvidence], {
      providers: { triage: triageProvider(), gambit_analysis: analysis.provider },
    });

    expect(analysis.calls()).toBe(2);
    expect(result.analysisAttempts).toBe(1);
    // A retry can only upgrade. It must never convert a definite verdict into
    // FAILED, and it must never be mistaken for a provider outage.
    expect(result.status).toBe('NO_GAMBIT');
  });

  it('keeps the first valid NO_GAMBIT verdict when the retry returns an unusable schema', async () => {
    const analysis = sequencedAnalysisProvider([NO_GAMBIT_ANALYSIS, { decision: 'QUALIFIED' }]);
    const result = await runGambitStages(fixtureCandidate, [fixtureEvidence], {
      providers: { triage: triageProvider(), gambit_analysis: analysis.provider },
    });

    expect(analysis.calls()).toBe(2);
    expect(result.analysisAttempts).toBe(1);
    expect(result.status).toBe('NO_GAMBIT');
  });

  it('persists the retry spend on the candidate for both terminal outcomes', async () => {
    const repository = new AnalysisRetryFixtureRepository();
    const published = await runQualifiedGambitWorkflow(
      { workflowId: 'wf-retry-upgrade', candidateId: 901 },
      {
        repository: repository as unknown as GambitRepository,
        providers: { triage: triageProvider(), gambit_analysis: sequencedAnalysisProvider([NO_GAMBIT_ANALYSIS, QUALIFIED_ANALYSIS]).provider },
      },
    );
    expect(repository.analysisAttempts).toBe(1);
    expect(published.status).not.toBe('NO_GAMBIT');

    const rejectedRepository = new AnalysisRetryFixtureRepository();
    const rejected = await runQualifiedGambitWorkflow(
      { workflowId: 'wf-retry-terminal', candidateId: 901 },
      {
        repository: rejectedRepository as unknown as GambitRepository,
        providers: { triage: triageProvider(), gambit_analysis: sequencedAnalysisProvider([NO_GAMBIT_ANALYSIS, NO_GAMBIT_ANALYSIS]).provider },
      },
    );
    expect(rejectedRepository.analysisAttempts).toBe(1);
    expect(rejected.status).toBe('NO_GAMBIT');
    expect(rejectedRepository.candidate.status).toBe('REJECTED');
    expect(rejectedRepository.candidate.rejectionReason).toBe('NO_GAMBIT_WORTH_PUBLISHING');
  });

  it('does not record a retry when no retry was spent', async () => {
    const repository = new AnalysisRetryFixtureRepository();
    await runQualifiedGambitWorkflow(
      { workflowId: 'wf-no-retry', candidateId: 901 },
      {
        repository: repository as unknown as GambitRepository,
        providers: { triage: triageProvider(), gambit_analysis: sequencedAnalysisProvider([QUALIFIED_ANALYSIS]).provider },
      },
    );
    expect(repository.analysisAttempts).toBeNull();
  });
});

describe('Open Gambit candidate fingerprint rule versioning', () => {
  it('is stable for a fixed rule version so re-runs stay idempotent', async () => {
    const first = await fingerprintCandidate('TEST_ONLY headline', 'https://test-only.example/a', 'body', 'stable-1');
    const second = await fingerprintCandidate('TEST_ONLY headline', 'https://test-only.example/a', 'body', 'stable-1');
    expect(first).toBe(second);
    expect(first).toHaveLength(64);
  });

  it('changes when the admission rules change so rejected items become re-evaluable', async () => {
    const before = await fingerprintCandidate('TEST_ONLY headline', 'https://test-only.example/a', 'body', 'stable-1', 'gambit-eligibility-v1');
    const after = await fingerprintCandidate('TEST_ONLY headline', 'https://test-only.example/a', 'body', 'stable-1', 'gambit-eligibility-v2');
    expect(after).not.toBe(before);
  });

  it('defaults to the exported rules version rather than an implicit one', async () => {
    const implicit = await fingerprintCandidate('TEST_ONLY headline', 'https://test-only.example/a', 'body', 'stable-1');
    const explicit = await fingerprintCandidate('TEST_ONLY headline', 'https://test-only.example/a', 'body', 'stable-1', GAMBIT_ELIGIBILITY_RULES_VERSION);
    expect(implicit).toBe(explicit);
  });

  it('never collides with a legacy fingerprint computed without a rule version', async () => {
    // The pre-Phase-1 identity for a stable id was `stable:<id>`; the new
    // identity prefixes the rule version so no historical row can be matched by
    // accident and no new row can shadow an old one.
    const legacyInput = 'stable:stable-1';
    const { sha256Hex } = await import('../src/open-gambit/canonical');
    const legacy = await sha256Hex(legacyInput);
    const current = await fingerprintCandidate('TEST_ONLY headline', 'https://test-only.example/a', 'body', 'stable-1');
    expect(current).not.toBe(legacy);
  });
});
