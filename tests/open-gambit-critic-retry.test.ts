import { describe, expect, it } from 'vitest';
import { runQualifiedGambitWorkflow, runGambitStages } from '../src/open-gambit/pipeline';
import { GambitProviderError, MockGambitProvider } from '../src/open-gambit/llm';
import { GambitRunBudget } from '../src/open-gambit/budget';
import type {
  GambitCandidate,
  GambitDraft,
  GambitEvidence,
  GambitLLMResponse,
  GambitSourceSnapshot,
} from '../src/open-gambit/types';

/**
 * Open Gambit — Phase 1.7 T2 regression: BOUNDED CRITIC OPERATIONAL re-sample.
 *
 * Phase 1.6 measured the critic truncated in 8 of 11 calls at a 3,000-token
 * budget and about 4 of 12 at 6,000. Phase 1.7 T1 diagnosed the residual tail:
 * at critic 6,000 the surviving failures are TOKEN walls, not deadline kills —
 * every one ended at `finish_reason=length` with
 * `reasoning = completion = 6,000` and 0-506 bytes of content, so the model was
 * still reasoning when the budget ran out and never emitted an answer. The run
 * died with `PROVIDER_EMPTY_RESPONSE` and the candidate was discarded before the
 * deterministic publication gate could rule on it at all.
 *
 * Neither limit can be raised (8,000-token clamp; 30,000 ms non-translation
 * clamp, with measured successes already at 29.7 s), so only a code change
 * absorbs the tail.
 *
 * Invariants under test, identical to the analysis (0027) and triage (0029)
 * re-samples:
 *
 *  1. ONE bounded re-sample, and only for an OPERATIONAL failure.
 *  2. A re-sample can only UPGRADE a sampling failure into a real verdict.
 *  3. A failed or unusable re-sample keeps the FIRST failure.
 *  4. A critic VERDICT — accepted, or accepted=false with concerns — is a policy
 *     judgement and is NEVER re-sampled.
 *  5. An unrecognised error code fails closed: no retry.
 *  6. Triage, analysis and critic retries are each bounded independently, so a
 *     candidate that triggers all three still has a bounded total call count.
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

/** A critique that accepts: the publication gate's happy path. */
const CRITIC_ACCEPTED = {
  accepted: true,
  rejectionReasons: [],
  simplerExplanation: 'The mechanism is documented in the primary source.',
  motiveConcern: false,
  causalConcern: false,
  politicalFraming: false,
  sensationalismConcern: false,
  falsifiabilityConcern: false,
  notes: 'TEST_ONLY acceptable.',
};

/**
 * A JUDGEMENT rejection: well-formed, with an evidence-backed concern. This is a
 * policy decision, not a sampling loss, and must never be re-sampled.
 */
const CRITIC_REJECTED_CAUSALITY = {
  accepted: false,
  rejectionReasons: ['TEST_ONLY weak causality.'],
  simplerExplanation: 'TEST_ONLY a simpler explanation exists.',
  motiveConcern: false,
  causalConcern: true,
  politicalFraming: false,
  sensationalismConcern: false,
  falsifiabilityConcern: false,
  notes: 'TEST_ONLY causalConcern.',
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
 * Critic provider that replays a fixed sequence and counts calls.
 * `new GambitProviderError(code)` entries simulate the provider's own bounded
 * operational error codes; `new Error(...)` simulates an unrecognised one.
 */
function sequencedCriticProvider(sequence: Array<unknown | Error>) {
  let index = 0;
  const provider = new MockGambitProvider(async () => {
    const next = sequence[Math.min(index, sequence.length - 1)];
    index += 1;
    if (next instanceof Error) throw next;
    return llm(next);
  });
  return { provider, calls: () => index };
}

function triageProvider(verdict: unknown = TRIAGE_APPROVED) {
  let index = 0;
  return {
    provider: new MockGambitProvider(async () => {
      index += 1;
      return llm(verdict);
    }),
    calls: () => index,
  };
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

class CriticRetryFixtureRepository {
  candidate = { ...fixtureCandidate };
  workflow: { status: string } | null = null;
  analysisAttempts: number | null = null;
  triageAttempts: number | null = null;
  criticAttempts: number | null = null;
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

  async recordCandidateCriticAttempts(_id: number, attempts: number) {
    this.criticAttempts = attempts;
  }

  async recordWorkflowResult(input: { result: { status: string } }) {
    this.workflow = { status: input.result.status };
  }

  async createArticleDraft(draft: GambitDraft) {
    return { articleId: 901, revisionId: 902, draft };
  }

  /**
   * Only enough for `publishQualifiedGambit` to reach its own decision. This
   * fixture asserts the RETRY TELEMETRY, which `runQualifiedGambitWorkflow`
   * writes before the publication path runs, so it deliberately does not model
   * translation readiness. A null article stops publication there.
   */
  async getArticleById() {
    return null;
  }
}

/** The production-shaped critic role with a retry bound enabled. */
function criticRoleWithRetry(retryLimit: number) {
  return {
    role: 'critic',
    runtimeProvider: 'TEST_ONLY_PROVIDER',
    runtimeModelId: 'TEST_ONLY_RUNTIME_MODEL',
    publicAiIdentity: 'Claude Fable 5',
    timeoutMs: 30_000,
    retryLimit,
    tokenBudget: 6_000,
  };
}

describe('Open Gambit critic bounded operational retry', () => {
  it('upgrades a first-attempt operational failure to a real verdict on one re-sample', async () => {
    const critic = sequencedCriticProvider([
      new GambitProviderError('empty_response'),
      CRITIC_ACCEPTED,
    ]);
    const result = await runGambitStages(fixtureCandidate, [fixtureEvidence], {
      providers: { triage: triageProvider().provider, gambit_analysis: analysisProvider().provider, critic: critic.provider },
      roles: [criticRoleWithRetry(1)],
    });

    expect(critic.calls()).toBe(2);
    expect(result.criticAttempts).toBe(1);
    expect(result.critic?.accepted).toBe(true);
    // The upgrade must actually clear the deterministic gate.
    expect(result.status).toBe('AUTO_PUBLISH_ELIGIBLE');
  });

  it('upgrades a deadline kill to a real verdict on one re-sample', async () => {
    // Phase 1.7 T1 measured 2 of 7 failures as deadline kills (`timeout`).
    const critic = sequencedCriticProvider([
      new GambitProviderError('timeout'),
      CRITIC_ACCEPTED,
    ]);
    const result = await runGambitStages(fixtureCandidate, [fixtureEvidence], {
      providers: { triage: triageProvider().provider, gambit_analysis: analysisProvider().provider, critic: critic.provider },
      roles: [criticRoleWithRetry(1)],
    });

    expect(critic.calls()).toBe(2);
    expect(result.criticAttempts).toBe(1);
    expect(result.status).toBe('AUTO_PUBLISH_ELIGIBLE');
  });

  it('upgrades a truncated structured JSON to a real verdict on one re-sample', async () => {
    const critic = sequencedCriticProvider([
      new GambitProviderError('invalid_structured_json'),
      CRITIC_ACCEPTED,
    ]);
    const result = await runGambitStages(fixtureCandidate, [fixtureEvidence], {
      providers: { triage: triageProvider().provider, gambit_analysis: analysisProvider().provider, critic: critic.provider },
      roles: [criticRoleWithRetry(1)],
    });

    expect(critic.calls()).toBe(2);
    expect(result.criticAttempts).toBe(1);
    expect(result.status).toBe('AUTO_PUBLISH_ELIGIBLE');
  });

  it('upgrades an http_* transport failure to a real verdict on one re-sample', async () => {
    const critic = sequencedCriticProvider([
      new GambitProviderError('http_502'),
      CRITIC_ACCEPTED,
    ]);
    const result = await runGambitStages(fixtureCandidate, [fixtureEvidence], {
      providers: { triage: triageProvider().provider, gambit_analysis: analysisProvider().provider, critic: critic.provider },
      roles: [criticRoleWithRetry(1)],
    });

    expect(critic.calls()).toBe(2);
    expect(result.criticAttempts).toBe(1);
    expect(result.status).toBe('AUTO_PUBLISH_ELIGIBLE');
  });

  it('stops after exactly one re-sample when the critic keeps failing operationally', async () => {
    const critic = sequencedCriticProvider([
      new GambitProviderError('empty_response'),
      new GambitProviderError('empty_response'),
      CRITIC_ACCEPTED,
    ]);
    const result = await runGambitStages(fixtureCandidate, [fixtureEvidence], {
      providers: { triage: triageProvider().provider, gambit_analysis: analysisProvider().provider, critic: critic.provider },
      roles: [criticRoleWithRetry(1)],
    });

    // Exactly two critic calls: the first plus one bounded re-sample, never more.
    expect(critic.calls()).toBe(2);
    expect(result.criticAttempts).toBe(1);
    expect(result.status).toBe('FAILED');
    expect(result.reason).toBe('PROVIDER_EMPTY_RESPONSE');
  });

  it('keeps the first failure when the re-sample fails harder', async () => {
    // The FIRST code is what cost the candidate the run, so it is the code that
    // must be reported -- a re-sample failing harder must not relabel the loss.
    const critic = sequencedCriticProvider([
      new GambitProviderError('timeout'),
      new GambitProviderError('empty_response'),
    ]);
    const result = await runGambitStages(fixtureCandidate, [fixtureEvidence], {
      providers: { triage: triageProvider().provider, gambit_analysis: analysisProvider().provider, critic: critic.provider },
      roles: [criticRoleWithRetry(1)],
    });

    expect(critic.calls()).toBe(2);
    expect(result.criticAttempts).toBe(1);
    expect(result.status).toBe('FAILED');
    expect(result.reason).toBe('PROVIDER_TIMEOUT');
  });

  it('keeps the first failure when the re-sample returns an unusable schema', async () => {
    // `null` normalizes to a missing critique object: not an upgrade.
    const critic = sequencedCriticProvider([new GambitProviderError('empty_response'), null]);
    const result = await runGambitStages(fixtureCandidate, [fixtureEvidence], {
      providers: { triage: triageProvider().provider, gambit_analysis: analysisProvider().provider, critic: critic.provider },
      roles: [criticRoleWithRetry(1)],
    });

    expect(critic.calls()).toBe(2);
    expect(result.criticAttempts).toBe(1);
    expect(result.status).toBe('FAILED');
    expect(result.reason).toBe('PROVIDER_EMPTY_RESPONSE');
  });

  it('NEVER re-samples a critic judgement rejection', async () => {
    // A well-formed `accepted=false` with an evidence-backed concern is a POLICY
    // decision about the thesis, not sampling noise. Re-rolling it would be
    // shopping for a different answer to a judgement question, which is the same
    // reason a political triage exclusion is never re-sampled.
    const critic = sequencedCriticProvider([CRITIC_REJECTED_CAUSALITY, CRITIC_ACCEPTED]);
    const result = await runGambitStages(fixtureCandidate, [fixtureEvidence], {
      providers: { triage: triageProvider().provider, gambit_analysis: analysisProvider().provider, critic: critic.provider },
      roles: [criticRoleWithRetry(1)],
    });

    expect(critic.calls()).toBe(1);
    expect(result.criticAttempts).toBe(0);
    expect(result.critic?.accepted).toBe(false);
    expect(result.status).not.toBe('AUTO_PUBLISH_ELIGIBLE');
  });

  it('NEVER re-samples an unrecognised error code', async () => {
    // An unknown code fails closed. `CRITIC_PROVIDER_UNAVAILABLE` is a
    // configuration fault, not a sampling loss, and a future provider error must
    // not silently acquire a retry.
    const critic = sequencedCriticProvider([
      new GambitProviderError('some_future_provider_error'),
      CRITIC_ACCEPTED,
    ]);
    const result = await runGambitStages(fixtureCandidate, [fixtureEvidence], {
      providers: { triage: triageProvider().provider, gambit_analysis: analysisProvider().provider, critic: critic.provider },
      roles: [criticRoleWithRetry(1)],
    });

    expect(critic.calls()).toBe(1);
    expect(result.criticAttempts).toBe(0);
    expect(result.status).toBe('FAILED');
  });

  it('NEVER re-samples when the critic provider is unavailable', async () => {
    const result = await runGambitStages(fixtureCandidate, [fixtureEvidence], {
      providers: {
        triage: triageProvider().provider,
        gambit_analysis: analysisProvider().provider,
        // Deliberately no critic provider: a configuration fault.
      },
      roles: [criticRoleWithRetry(1)],
    });

    expect(result.criticAttempts).toBe(0);
    expect(result.status).toBe('FAILED');
    expect(result.reason).toBe('PROVIDER_UNAVAILABLE');
  });

  it('never converts a definite verdict into a FAILED by re-sampling', async () => {
    // The first attempt returned a usable verdict, so there is nothing to
    // upgrade and no call may be spent -- even though a re-sample WOULD have
    // returned something different.
    const critic = sequencedCriticProvider([CRITIC_ACCEPTED, CRITIC_REJECTED_CAUSALITY]);
    const result = await runGambitStages(fixtureCandidate, [fixtureEvidence], {
      providers: { triage: triageProvider().provider, gambit_analysis: analysisProvider().provider, critic: critic.provider },
      roles: [criticRoleWithRetry(1)],
    });

    expect(critic.calls()).toBe(1);
    expect(result.criticAttempts).toBe(0);
    expect(result.critic?.accepted).toBe(true);
    expect(result.status).toBe('AUTO_PUBLISH_ELIGIBLE');
  });

  it('spends no re-sample when the critic role disables its retry bound', async () => {
    const critic = sequencedCriticProvider([new GambitProviderError('empty_response'), CRITIC_ACCEPTED]);
    const result = await runGambitStages(fixtureCandidate, [fixtureEvidence], {
      providers: { triage: triageProvider().provider, gambit_analysis: analysisProvider().provider, critic: critic.provider },
      roles: [criticRoleWithRetry(0)],
    });

    expect(critic.calls()).toBe(1);
    expect(result.criticAttempts).toBe(0);
    expect(result.status).toBe('FAILED');
  });

  it('keeps the total call count bounded when triage, analysis and critic all retry', async () => {
    const TRIAGE_REJECTED_ROUTINE = {
      eventImportance: 0.2,
      aiTechRelevance: true,
      politicsExcluded: false,
      evidenceSufficient: true,
      strategicMechanism: null,
      shouldDeepAnalysisRun: false,
      reason: 'TEST_ONLY routine maintenance.',
    };
    const NO_GAMBIT_ANALYSIS = { decision: 'NO_GAMBIT_WORTH_PUBLISHING' as const, reason: 'TEST_ONLY nothing publishable.' };

    let triageCalls = 0;
    const triage = new MockGambitProvider(async () => {
      triageCalls += 1;
      return llm(triageCalls === 1 ? TRIAGE_REJECTED_ROUTINE : TRIAGE_APPROVED);
    });
    let analysisCalls = 0;
    const analysis = new MockGambitProvider(async () => {
      analysisCalls += 1;
      return llm(analysisCalls === 1 ? NO_GAMBIT_ANALYSIS : QUALIFIED_ANALYSIS);
    });
    const critic = sequencedCriticProvider([new GambitProviderError('empty_response'), CRITIC_ACCEPTED]);

    const result = await runGambitStages(fixtureCandidate, [fixtureEvidence], {
      providers: { triage, gambit_analysis: analysis, critic: critic.provider },
      roles: [criticRoleWithRetry(1)],
    });

    // 2 triage + 2 analysis + 2 critic: each stage bounded at exactly one
    // re-sample, never compounding into an unbounded chain.
    expect(triageCalls).toBe(2);
    expect(analysisCalls).toBe(2);
    expect(critic.calls()).toBe(2);
    expect(result.triageAttempts).toBe(1);
    expect(result.analysisAttempts).toBe(1);
    expect(result.criticAttempts).toBe(1);
    expect(result.status).toBe('AUTO_PUBLISH_ELIGIBLE');
  });

  it('fails closed when the budget cannot fund the re-sample', async () => {
    // Worst-case declared-token path with the critic bound is
    // triage 2,400x2 + analysis 8,000x2 + critic 6,000x2 = 30,800. Here the
    // budget funds the first critic attempt and NOT the re-sample, so the
    // re-sample must fail closed with a budget stop -- deliberately read as
    // non-operational, so it is not itself re-sampled, and the run must report
    // the ORIGINAL operational loss that cost the candidate.
    const critic = sequencedCriticProvider([new GambitProviderError('empty_response')]);
    const result = await runGambitStages(fixtureCandidate, [fixtureEvidence], {
      providers: {
        triage: triageProvider().provider,
        gambit_analysis: analysisProvider().provider,
        critic: critic.provider,
      },
      roles: [
        criticRoleWithRetry(1),
        {
          role: 'triage', runtimeProvider: 'TEST_ONLY_PROVIDER', runtimeModelId: 'TEST_ONLY_RUNTIME_MODEL',
          publicAiIdentity: 'DeepSeek V4 Pro', timeoutMs: 30_000, retryLimit: 1, tokenBudget: 2_400,
        },
        {
          role: 'gambit_analysis', runtimeProvider: 'TEST_ONLY_PROVIDER', runtimeModelId: 'TEST_ONLY_RUNTIME_MODEL',
          publicAiIdentity: 'GPT-5.6 Sol', timeoutMs: 30_000, retryLimit: 1, tokenBudget: 8_000,
        },
      ],
      // `consume` is a PRE-FLIGHT check, so the ceiling is what may be spent in
      // total. 2,400 (triage) + 8,000 (analysis) + 6,000 (first critic) = 16,400
      // succeeds; a second 6,000 would reach 22,400 and is refused exactly one
      // token short at 22,399.
      budget: new GambitRunBudget({
        maxLlmCalls: 12, maxLlmTokens: 22_399,
        maxTranslationLlmCalls: 8, maxTranslationLlmTokens: 16_000,
        maxSearchRequests: 6, maxXRequests: 6, maxGithubRequests: 6, maxHttpRequests: 20,
      }),
    });

    expect(critic.calls()).toBe(1);
    expect(result.status).toBe('FAILED');
    // The budget stop cannot overwrite the first failure's code.
    expect(result.reason).toBe('PROVIDER_EMPTY_RESPONSE');
    // A budget stop is not an operational loss, so the bound is released rather
    // than banked.
    expect(result.criticAttempts).toBe(0);
  });

  it('fails closed on an exhausted budget before the critic runs at all', async () => {
    const critic = sequencedCriticProvider([CRITIC_ACCEPTED]);
    const result = await runGambitStages(fixtureCandidate, [fixtureEvidence], {
      providers: {
        triage: triageProvider().provider,
        gambit_analysis: analysisProvider().provider,
        critic: critic.provider,
      },
      roles: [
        criticRoleWithRetry(1),
        {
          role: 'triage', runtimeProvider: 'TEST_ONLY_PROVIDER', runtimeModelId: 'TEST_ONLY_RUNTIME_MODEL',
          publicAiIdentity: 'DeepSeek V4 Pro', timeoutMs: 30_000, retryLimit: 1, tokenBudget: 2_400,
        },
        {
          role: 'gambit_analysis', runtimeProvider: 'TEST_ONLY_PROVIDER', runtimeModelId: 'TEST_ONLY_RUNTIME_MODEL',
          publicAiIdentity: 'GPT-5.6 Sol', timeoutMs: 30_000, retryLimit: 1, tokenBudget: 8_000,
        },
      ],
      // Enough for triage + analysis, not enough for the critic.
      budget: new GambitRunBudget({
        maxLlmCalls: 12, maxLlmTokens: 10_400,
        maxTranslationLlmCalls: 8, maxTranslationLlmTokens: 16_000,
        maxSearchRequests: 6, maxXRequests: 6, maxGithubRequests: 6, maxHttpRequests: 20,
      }),
    });

    expect(critic.calls()).toBe(0);
    expect(result.status).toBe('FAILED');
    expect(result.reason).toBe('PROVIDER_BUDGET_EXCEEDED');
    // A DETERMINISTIC stop must never buy a re-sample: the budget check runs
    // before every request, so an exhausted budget is still exhausted next time.
    // Re-sampling it would burn wall clock and a call slot for nothing.
    expect(result.criticAttempts).toBe(0);
  });

  it('persists the critic retry spend through the workflow', async () => {
    const critic = sequencedCriticProvider([new GambitProviderError('empty_response'), CRITIC_ACCEPTED]);
    const repository = new CriticRetryFixtureRepository();

    const result = await runQualifiedGambitWorkflow(
      { workflowId: 'workflow-1', candidateId: 901, runId: 1 },
      {
        providers: { triage: triageProvider().provider, gambit_analysis: analysisProvider().provider, critic: critic.provider },
        roles: [criticRoleWithRetry(1)],
        repository: repository as never,
        now: new Date('2026-09-05T00:02:00.000Z'),
      },
    );

    expect(repository.criticAttempts).toBe(1);
    // The retry telemetry is written before the publication path runs, so this
    // fixture asserts the counter, not publication success (see
    // `CriticRetryFixtureRepository.getArticleById`).
    expect(result.status).toBe('FAILED');
    expect(result.reason).toBe('CANONICAL_FALLBACK_NOT_READY');
  });

  it('persists a zero critic retry counter when the first attempt decides', async () => {
    const critic = sequencedCriticProvider([CRITIC_ACCEPTED]);
    const repository = new CriticRetryFixtureRepository();

    await runQualifiedGambitWorkflow(
      { workflowId: 'workflow-2', candidateId: 901, runId: 1 },
      {
        providers: { triage: triageProvider().provider, gambit_analysis: analysisProvider().provider, critic: critic.provider },
        roles: [criticRoleWithRetry(1)],
        repository: repository as never,
        now: new Date('2026-09-05T00:02:00.000Z'),
      },
    );

    // 0 is falsy, so the repository write is skipped; the column default is 0.
    expect(repository.criticAttempts).toBeNull();
    expect(critic.calls()).toBe(1);
  });
});
