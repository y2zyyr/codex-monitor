import { describe, expect, it } from 'vitest';
import {
  GAMBIT_LEGACY_PROMPT_VERSION,
  GAMBIT_PROMPT_REVISIONS,
  GAMBIT_PROMPT_ROLES,
  GAMBIT_PROMPT_VERSION,
  gambitPromptVersion,
  isGambitPromptRole,
  parseGambitPromptVersion,
} from '../src/open-gambit/prompts';
import { analysisSystemPrompt, criticSystemPrompt, triageSystemPrompt, runGambitStages } from '../src/open-gambit/pipeline';
import { translationRequest } from '../src/open-gambit/publication';
import { MockGambitProvider } from '../src/open-gambit/llm';
import type { GambitCandidate, GambitEvidence, GambitLLMResponse, GambitPublicArticle } from '../src/open-gambit/types';

/**
 * Open Gambit — T5 regression: prompt provenance.
 *
 * Phase 0 established that the single constant `gambit-prompts-v2` was recorded
 * as `promptVersion` for triage, analysis, critic AND translation, and stamped
 * onto every published draft, even though those are four different prompt texts
 * (the `v2` bump was carried by a triage-only text change). A stored version
 * therefore could not identify the text that produced an article.
 *
 * The fix records `<role revision>@<fingerprint of the exact system text>`, so
 * the version is self-verifying. The FROZEN table below is the reviewed
 * revision-to-text pairing: changing a prompt's wording fails this test until
 * the revision is bumped and this table is updated in the same commit.
 *
 * Phase 1.7 updated `gambit-translation-v1` (bffe71fb -> f6c34a28) to state two
 * parts of the contract the validator already enforced but the prompt omitted:
 *   - array parity for `facts`/`beneficiaries`/`pressuredActors`, previously
 *     stated only for `trajectories`, which is why `es` failed with
 *     FACTS_COUNT_OR_TYPE;
 *   - that every prose field must actually be TRANSLATED, because the model was
 *     echoing the English headline verbatim inside otherwise-target-language
 *     prose, which the language-quality rule correctly rejects as
 *     CROSS_LANGUAGE_SENTENCE_CONTAMINATION.
 * The REVISION stays v1 -- the schema and the enforced contract are unchanged,
 * only wording that had under-specified it -- and the fingerprint records the edit.
 */

/** Reviewed revision -> fingerprint of the prompt text as of Phase 1. */
const FROZEN_PROMPT_FINGERPRINTS: Record<string, string> = {
  'gambit-triage-v1': '7e189e15',
  'gambit-analysis-v1': '8aaa1e73',
  'gambit-critic-v1': '3eb0e79b',
  'gambit-translation-v1': 'f6c34a28',
};

const candidate: GambitCandidate = {
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

const evidence: GambitEvidence = {
  snapshotId: 901,
  sourceId: 'test-only-source',
  sourceTier: 'PRIMARY_OFFICIAL',
  canonicalUrl: 'https://test-only.example/standard',
  title: 'TEST_ONLY compatibility standard',
  publisher: 'TEST_ONLY publisher',
  publishedAt: '2026-09-05T00:00:00.000Z',
  quote: 'TEST_ONLY publisher documents a compatibility standard that will be available to developers before 2026-12-31 and lowers switching costs.',
  role: 'FACT',
  contentHash: 'e'.repeat(64),
};

const article = {
  articleId: 1,
  revisionId: 1,
  candidateId: 901,
  slug: 'test-only',
  headline: 'TEST_ONLY headline',
  surfaceEvent: 'TEST_ONLY surface event',
  facts: ['TEST_ONLY fact'],
  obviousLogic: 'TEST_ONLY obvious logic',
  thesis: 'TEST_ONLY thesis',
  mechanism: 'TEST_ONLY mechanism',
  beneficiaries: ['Developers'],
  pressuredActors: ['Incumbents'],
  countercase: 'TEST_ONLY countercase',
  trajectories: [{
    id: 'trajectory-1',
    predictionStatement: 'TEST_ONLY prediction',
    targetEntity: 'TEST_ONLY entity',
    probability: 70,
    deadline: '2026-12-31',
    reasoning: 'TEST_ONLY reasoning',
    evidenceCriteria: 'TEST_ONLY evidence criteria',
    falsifier: 'TEST_ONLY falsifier',
    status: 'WATCHING',
  }],
  falsifier: 'TEST_ONLY falsifier',
  evidence: [],
  uncertainty: 'TEST_ONLY uncertainty',
  politicalTopic: false,
  critic: {
    accepted: true,
    rejectionReasons: [],
    simplerExplanation: '',
    motiveConcern: false,
    causalConcern: false,
    politicalFraming: false,
    sensationalismConcern: false,
    falsifiabilityConcern: false,
    notes: '',
  },
  modelRoleProvenance: {},
  modelPromptVersion: 'v1',
  aiDisclosureVersion: 'v1',
  draftVersion: 1,
  createdAt: '2026-09-05T00:00:00.000Z',
  status: 'DRAFT',
  publishedAt: null,
  modifiedAt: '2026-09-05T00:00:00.000Z',
  translations: {},
} as unknown as GambitPublicArticle;

describe('Open Gambit prompt provenance', () => {
  it('records a distinct per-role revision instead of one family constant', () => {
    expect(GAMBIT_PROMPT_ROLES).toEqual(['triage', 'gambit_analysis', 'critic', 'translation']);
    const revisions = Object.values(GAMBIT_PROMPT_REVISIONS);
    expect(new Set(revisions).size).toBe(4);
    // The family marker describes the SCHEME and must never be presented as the
    // text that ran.
    expect(GAMBIT_PROMPT_VERSION).toBe('gambit-prompts-per-role-v1');
    expect(revisions).not.toContain(GAMBIT_PROMPT_VERSION);
    expect(GAMBIT_LEGACY_PROMPT_VERSION).toBe('gambit-prompts-v2');
  });

  it('binds each revision to the fingerprint of its exact prompt text', async () => {
    const versions: Record<string, string> = {
      triage: await gambitPromptVersion('triage', triageSystemPrompt()),
      gambit_analysis: await gambitPromptVersion('gambit_analysis', analysisSystemPrompt()),
      critic: await gambitPromptVersion('critic', criticSystemPrompt()),
      translation: await gambitPromptVersion('translation', translationRequest(article, 'ja').system),
    };
    for (const [role, version] of Object.entries(versions)) {
      const { revision, fingerprint } = parseGambitPromptVersion(version);
      expect(revision, role).toBe(GAMBIT_PROMPT_REVISIONS[role as keyof typeof GAMBIT_PROMPT_REVISIONS]);
      expect(fingerprint, `${role} must carry a text fingerprint`).not.toBeNull();
      expect(version, `${role}: prompt text changed without a revision bump`).toBe(`${revision}@${FROZEN_PROMPT_FINGERPRINTS[revision]}`);
    }
  });

  it('proves the four prompts are genuinely different texts', async () => {
    const fingerprints = await Promise.all([
      gambitPromptVersion('triage', triageSystemPrompt()),
      gambitPromptVersion('gambit_analysis', analysisSystemPrompt()),
      gambitPromptVersion('critic', criticSystemPrompt()),
      gambitPromptVersion('translation', translationRequest(article, 'ja').system),
    ]);
    // Identical texts would make the old single family version harmless; they are
    // not identical, which is exactly why the old constant was not auditable.
    expect(new Set(fingerprints).size).toBe(4);
  });

  it('makes an unbumped prompt edit visible rather than silently reusing a revision', async () => {
    const original = await gambitPromptVersion('triage', triageSystemPrompt());
    const edited = await gambitPromptVersion('triage', `${triageSystemPrompt()} Routine maintenance does not merit analysis.`);
    const originalParts = parseGambitPromptVersion(original);
    const editedParts = parseGambitPromptVersion(edited);
    expect(editedParts.revision).toBe(originalParts.revision);
    expect(editedParts.fingerprint).not.toBe(originalParts.fingerprint);
  });

  it('distinguishes the corrective translation prompt from the initial one', async () => {
    const initial = await gambitPromptVersion('translation', translationRequest(article, 'ja').system);
    const corrective = await gambitPromptVersion('translation', translationRequest(article, 'ja', undefined, { corrective: true }).system);
    expect(parseGambitPromptVersion(corrective).revision).toBe(parseGambitPromptVersion(initial).revision);
    expect(corrective).not.toBe(initial);
  });

  it('parses only a well-formed fingerprint and never invents one', () => {
    expect(parseGambitPromptVersion('gambit-analysis-v1@8aaa1e73')).toEqual({ revision: 'gambit-analysis-v1', fingerprint: '8aaa1e73' });
    expect(parseGambitPromptVersion('gambit-prompts-v2')).toEqual({ revision: 'gambit-prompts-v2', fingerprint: null });
    expect(parseGambitPromptVersion('gambit-analysis-v1@NOT_A_HASH')).toEqual({ revision: 'gambit-analysis-v1@NOT_A_HASH', fingerprint: null });
  });

  it('narrows prompt roles without fabricating one', () => {
    expect(isGambitPromptRole('triage')).toBe(true);
    expect(isGambitPromptRole('gambit_analysis')).toBe(true);
    expect(isGambitPromptRole('unknown_role')).toBe(false);
    expect(isGambitPromptRole('')).toBe(false);
  });

  it('stamps the per-role, text-bound versions on the draft and the attempts', async () => {
    const attempts: Array<{ stage: string; promptVersion: string }> = [];
    const repository = {
      recordLLMAttempt: async (input: { stage: string; promptVersion: string }) => {
        attempts.push({ stage: input.stage, promptVersion: input.promptVersion });
        return 1;
      },
    };
    const llm = <T>(value: T): GambitLLMResponse<T> => ({ value, provider: 'TEST_ONLY_PROVIDER', modelId: 'TEST_ONLY_RUNTIME_MODEL', latencyMs: 1 });

    const result = await runGambitStages(candidate, [evidence], {
      repository: repository as never,
      providers: {
        triage: new MockGambitProvider(async () => llm({
          eventImportance: 0.9,
          aiTechRelevance: true,
          politicsExcluded: false,
          evidenceSufficient: true,
          strategicMechanism: 'TEST_ONLY',
          shouldDeepAnalysisRun: true,
          reason: 'TEST_ONLY',
        })),
        // A gate-passing analysis so a draft is actually composed; the point of
        // this test is the provenance stamped on that draft.
        gambit_analysis: new MockGambitProvider(async () => llm({
          decision: 'QUALIFIED',
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
            status: 'WATCHING',
          }],
          uncertainty: 'Execution and adoption remain uncertain.',
        })),
        critic: new MockGambitProvider(async () => llm({ accepted: true, politicalFraming: false })),
      },
    });

    expect(result.draft).toBeDefined();
    expect(result.draft!.modelPromptVersion).toBe(`gambit-analysis-v1@${FROZEN_PROMPT_FINGERPRINTS['gambit-analysis-v1']}`);
    expect(result.draft!.modelRoleProvenance.triage?.promptVersion).toBe(`gambit-triage-v1@${FROZEN_PROMPT_FINGERPRINTS['gambit-triage-v1']}`);
    expect(result.draft!.modelRoleProvenance.critic?.promptVersion).toBe(`gambit-critic-v1@${FROZEN_PROMPT_FINGERPRINTS['gambit-critic-v1']}`);

    // The recorded attempt versions are derived from the request payload, so they
    // are the same values the stages actually sent.
    expect(attempts.map(attempt => attempt.stage)).toEqual(['TRIAGE', 'ANALYSIS', 'CRITIC']);
    expect(attempts[0]!.promptVersion).toBe(result.draft!.modelRoleProvenance.triage?.promptVersion);
    expect(attempts[1]!.promptVersion).toBe(result.draft!.modelPromptVersion);
    expect(attempts[2]!.promptVersion).toBe(result.draft!.modelRoleProvenance.critic?.promptVersion);
    // No attempt may fall back to the family marker while these roles run.
    expect(attempts.some(attempt => attempt.promptVersion === GAMBIT_PROMPT_VERSION)).toBe(false);
  });
});
