import { describe, expect, it } from 'vitest';
import { runQualifiedGambitWorkflow, runGambitStages } from '../src/open-gambit/pipeline';
import { MockGambitProvider } from '../src/open-gambit/llm';
import type {
  GambitCandidate,
  GambitDraft,
  GambitEvidence,
  GambitLLMResponse,
  GambitSourceSnapshot,
} from '../src/open-gambit/types';

/**
 * Open Gambit — Phase 1.5 T2 regression: BOUNDED TRIAGE re-sample.
 *
 * Triage is a sampling call over identical input, exactly like the analysis
 * stage. Phase 1 measured 4 admitted candidates of which only 1 passed triage
 * (`shouldDeepAnalysisRun=false` for two of them, `evidenceSufficient=false` for
 * the third), and Phase 1.5 measured the SAME request returning
 * `eventImportance` 0.5 on one replay and 0.62 on another. Before this change a
 * single unlucky sample discarded a candidate before any expensive work ran.
 *
 * Invariant under test, identical to the analysis re-sample: a re-sample can
 * only UPGRADE a rejection into an approval. A rejected re-sample keeps the
 * FIRST verdict, and a re-sample that errors or returns an unusable schema also
 * keeps the first verdict, so retrying can never turn a definite answer into an
 * operational failure.
 */

function llm<T>(value: T): GambitLLMResponse<T> {
  return { value, provider: 'TEST_ONLY_PROVIDER', modelId: 'TEST_ONLY_RUNTIME_MODEL', latencyMs: 1 };
}

const TRIAGE_APPROVED = {
  eventImportance: 0.9,
  aiTechRelevance: true,
  politicsExcluded: false,
  evidenceSufficient: true,
  strategicMechanism: 'Compatibility lowers switching costs.',
  shouldDeepAnalysisRun: true,
  reason: 'TEST_ONLY approved.',
};

/** Rejected because the model judged the event unimportant to analyse. */
const TRIAGE_REJECTED_ROUTINE = {
  eventImportance: 0.2,
  aiTechRelevance: true,
  politicsExcluded: false,
  evidenceSufficient: true,
  strategicMechanism: null,
  shouldDeepAnalysisRun: false,
  reason: 'TEST_ONLY routine maintenance.',
};

/** Rejected because the model judged the evidence insufficient. */
const TRIAGE_REJECTED_EVIDENCE = {
  eventImportance: 0.7,
  aiTechRelevance: true,
  politicsExcluded: false,
  evidenceSufficient: false,
  strategicMechanism: 'TEST_ONLY mechanism.',
  shouldDeepAnalysisRun: true,
  reason: 'TEST_ONLY content is truncated.',
};

/** Rejected below the frozen 0.45 importance threshold. */
const TRIAGE_REJECTED_LOW_IMPORTANCE = {
  eventImportance: 0.3,
  aiTechRelevance: true,
  politicsExcluded: false,
  evidenceSufficient: true,
  strategicMechanism: null,
  shouldDeepAnalysisRun: true,
  reason: 'TEST_ONLY low importance.',
};

/** A deterministic POLITICAL exclusion: a policy decision, not sampling noise. */
const TRIAGE_POLITICALLY_EXCLUDED = {
  eventImportance: 0.9,
  aiTechRelevance: true,
  politicsExcluded: true,
  political: { excluded: true, reasons: ['TEST_ONLY electoral subject'], confidence: 0.9 },
  evidenceSufficient: true,
  strategicMechanism: null,
  shouldDeepAnalysisRun: true,
  reason: 'TEST_ONLY political subject.',
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

/**
 * Triage provider that replays a fixed verdict sequence and counts calls.
 * `new Error(...)` entries simulate a provider/transport failure.
 */
function sequencedTriageProvider(sequence: Array<unknown | Error>) {
  let index = 0;
  const provider = new MockGambitProvider(async () => {
    const next = sequence[Math.min(index, sequence.length - 1)];
    index += 1;
    if (next instanceof Error) throw next;
    return llm(next);
  });
  return { provider, calls: () => index };
}

function analysisProvider(verdict: unknown = QUALIFIED_ANALYSIS) {
  let index = 0;
  return {
    provider: new MockGambitProvider(async () => {
      index += 1;
      return llm(verdict);
    }),
    calls: () => index,
  };
}

class TriageRetryFixtureRepository {
  candidate = { ...fixtureCandidate };
  workflow: { status: string } | null = null;
  analysisAttempts: number | null = null;
  triageAttempts: number | null = null;
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

  async recordCandidateTriageAttempts(_id: number, attempts: number) {
    this.triageAttempts = attempts;
  }

  async recordWorkflowResult(input: { result: { status: string } }) {
    this.workflow = { status: input.result.status };
  }

  async createArticleDraft(draft: GambitDraft) {
    return { articleId: 901, revisionId: 902, draft };
  }
}

describe('Open Gambit triage bounded retry', () => {
  it('upgrades a first-attempt rejection to approval on one bounded re-sample', async () => {
    const triage = sequencedTriageProvider([TRIAGE_REJECTED_ROUTINE, TRIAGE_APPROVED]);
    const analysis = analysisProvider();
    const result = await runGambitStages(fixtureCandidate, [fixtureEvidence], {
      providers: { triage: triage.provider, gambit_analysis: analysis.provider },
    });

    expect(triage.calls()).toBe(2);
    expect(result.triageAttempts).toBe(1);
    expect(result.triage.shouldDeepAnalysisRun).toBe(true);
    expect(result.triage.eventImportance).toBe(0.9);
    // The upgrade must actually admit the candidate to analysis.
    expect(analysis.calls()).toBeGreaterThanOrEqual(1);
    expect(result.status).not.toBe('NO_GAMBIT');
  });

  it('upgrades a first-attempt evidence rejection to approval on one re-sample', async () => {
    const triage = sequencedTriageProvider([TRIAGE_REJECTED_EVIDENCE, TRIAGE_APPROVED]);
    const analysis = analysisProvider();
    const result = await runGambitStages(fixtureCandidate, [fixtureEvidence], {
      providers: { triage: triage.provider, gambit_analysis: analysis.provider },
    });

    expect(triage.calls()).toBe(2);
    expect(result.triageAttempts).toBe(1);
    expect(result.triage.evidenceSufficient).toBe(true);
  });

  it('upgrades a first-attempt sub-threshold importance to approval on one re-sample', async () => {
    const triage = sequencedTriageProvider([TRIAGE_REJECTED_LOW_IMPORTANCE, TRIAGE_APPROVED]);
    const analysis = analysisProvider();
    const result = await runGambitStages(fixtureCandidate, [fixtureEvidence], {
      providers: { triage: triage.provider, gambit_analysis: analysis.provider },
    });

    expect(triage.calls()).toBe(2);
    expect(result.triageAttempts).toBe(1);
    expect(result.triage.eventImportance).toBe(0.9);
  });

  it('stops after exactly one retry when the model insists on rejecting', async () => {
    const triage = sequencedTriageProvider([TRIAGE_REJECTED_ROUTINE, TRIAGE_REJECTED_ROUTINE]);
    const analysis = analysisProvider();
    const result = await runGambitStages(fixtureCandidate, [fixtureEvidence], {
      providers: { triage: triage.provider, gambit_analysis: analysis.provider },
    });

    // Exactly two triage calls: the first plus one bounded re-sample, never more.
    expect(triage.calls()).toBe(2);
    expect(result.triageAttempts).toBe(1);
    expect(result.status).toBe('NO_GAMBIT');
    expect(result.publicationDecision).toBe('NO_GAMBIT_WORTH_PUBLISHING');
    // A doubly-rejected candidate must never reach expensive analysis.
    expect(analysis.calls()).toBe(0);
  });

  it('keeps the first valid rejection when the re-sample fails operationally', async () => {
    const triage = sequencedTriageProvider([TRIAGE_REJECTED_ROUTINE, new Error('TEST_ONLY_PROVIDER_FAILURE')]);
    const analysis = analysisProvider();
    const result = await runGambitStages(fixtureCandidate, [fixtureEvidence], {
      providers: { triage: triage.provider, gambit_analysis: analysis.provider },
    });

    // A failing re-sample must never convert a definite rejection into FAILED.
    expect(result.status).toBe('NO_GAMBIT');
    expect(result.triageAttempts).toBe(1);
    expect(result.triage.shouldDeepAnalysisRun).toBe(false);
    expect(analysis.calls()).toBe(0);
  });

  it('keeps the first valid rejection when the re-sample returns an unusable schema', async () => {
    const triage = sequencedTriageProvider([TRIAGE_REJECTED_ROUTINE, null]);
    const analysis = analysisProvider();
    const result = await runGambitStages(fixtureCandidate, [fixtureEvidence], {
      providers: { triage: triage.provider, gambit_analysis: analysis.provider },
    });

    expect(result.status).toBe('NO_GAMBIT');
    expect(result.triageAttempts).toBe(1);
    expect(analysis.calls()).toBe(0);
  });

  it('never re-samples a deterministic political exclusion', async () => {
    // A political exclusion is a policy decision about scope, not sampling
    // noise. Re-rolling it would be shopping for a different answer to a policy
    // question, which the fail-closed political contract forbids.
    const triage = sequencedTriageProvider([TRIAGE_POLITICALLY_EXCLUDED, TRIAGE_APPROVED]);
    const analysis = analysisProvider();
    const result = await runGambitStages(fixtureCandidate, [fixtureEvidence], {
      providers: { triage: triage.provider, gambit_analysis: analysis.provider },
    });

    expect(triage.calls()).toBe(1);
    expect(result.triageAttempts).toBe(0);
    expect(result.status).toBe('NO_GAMBIT');
    expect(result.publicationDecision).toBe('POLITICAL_TOPIC_EXCLUDED');
    expect(analysis.calls()).toBe(0);
  });

  it('spends no retry when the first triage attempt already approves', async () => {
    const triage = sequencedTriageProvider([TRIAGE_APPROVED]);
    const analysis = analysisProvider();
    const result = await runGambitStages(fixtureCandidate, [fixtureEvidence], {
      providers: { triage: triage.provider, gambit_analysis: analysis.provider },
    });

    expect(triage.calls()).toBe(1);
    expect(result.triageAttempts).toBe(0);
  });

  it('keeps the total call count bounded when triage and analysis both retry', async () => {
    const triage = sequencedTriageProvider([TRIAGE_REJECTED_ROUTINE, TRIAGE_APPROVED]);
    const NO_GAMBIT_ANALYSIS = { decision: 'NO_GAMBIT_WORTH_PUBLISHING' as const, reason: 'TEST_ONLY nothing publishable.' };
    let analysisCalls = 0;
    const analysis = new MockGambitProvider(async () => {
      analysisCalls += 1;
      return llm(analysisCalls === 1 ? NO_GAMBIT_ANALYSIS : QUALIFIED_ANALYSIS);
    });
    const result = await runGambitStages(fixtureCandidate, [fixtureEvidence], {
      providers: { triage: triage.provider, gambit_analysis: analysis },
    });

    // 2 triage (1 + 1 re-sample) and 2 analysis (1 + 1 re-sample): both bounded
    // independently at exactly one re-sample each, never compounding.
    expect(triage.calls()).toBe(2);
    expect(analysisCalls).toBe(2);
    expect(result.triageAttempts).toBe(1);
    expect(result.analysisAttempts).toBe(1);
  });

  it('persists the triage retry spend through the workflow', async () => {
    const triage = sequencedTriageProvider([TRIAGE_REJECTED_ROUTINE, TRIAGE_APPROVED]);
    const analysis = analysisProvider();
    const repository = new TriageRetryFixtureRepository();

    const result = await runQualifiedGambitWorkflow(
      { workflowId: 'workflow-1', candidateId: 901, runId: 1 },
      {
        providers: { triage: triage.provider, gambit_analysis: analysis.provider },
        repository: repository as never,
        now: new Date('2026-09-05T00:02:00.000Z'),
      },
    );

    expect(repository.triageAttempts).toBe(1);
    expect(result.status).not.toBe('NO_GAMBIT');
  });

  it('persists a zero triage retry counter when the first attempt decides', async () => {
    const triage = sequencedTriageProvider([TRIAGE_APPROVED]);
    const analysis = analysisProvider();
    const repository = new TriageRetryFixtureRepository();

    await runQualifiedGambitWorkflow(
      { workflowId: 'workflow-2', candidateId: 901, runId: 1 },
      {
        providers: { triage: triage.provider, gambit_analysis: analysis.provider },
        repository: repository as never,
        now: new Date('2026-09-05T00:02:00.000Z'),
      },
    );

    // 0 is falsy, so the repository write is skipped; the column default is 0.
    expect(repository.triageAttempts).toBeNull();
    expect(triage.calls()).toBe(1);
  });

  it('does not spend an analysis retry when triage never admits the candidate', async () => {
    const triage = sequencedTriageProvider([TRIAGE_REJECTED_ROUTINE, TRIAGE_REJECTED_EVIDENCE]);
    const analysis = analysisProvider();
    const result = await runGambitStages(fixtureCandidate, [fixtureEvidence], {
      providers: { triage: triage.provider, gambit_analysis: analysis.provider },
    });

    expect(result.status).toBe('NO_GAMBIT');
    expect(analysis.calls()).toBe(0);
    expect(result.analysisAttempts).toBeUndefined();
  });
});
