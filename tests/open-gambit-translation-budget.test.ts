import { describe, expect, it } from 'vitest';
import { gambitBudgetFromEnv, GambitRunBudget, type GambitBudgetLimits } from '../src/open-gambit/budget';
import { getGambitModelRoleConfig } from '../src/open-gambit/llm';
import { MockGambitProvider } from '../src/open-gambit/llm';
import { publishQualifiedGambit } from '../src/open-gambit/publication';
import { runGambitStages } from '../src/open-gambit/pipeline';
import type {
  GambitCandidate,
  GambitDraft,
  GambitEvidence,
  GambitLLMRequest,
  GambitLLMResponse,
  GambitModelRoleConfig,
  GambitPublicArticle,
  GambitTranslation,
} from '../src/open-gambit/types';
import type { GambitRepository } from '../src/open-gambit/repository';

/**
 * Open Gambit — T4 regression: translation budget (B1).
 *
 * Measured Phase 0 budget for the BEST case of one Workflow was 7 LLM calls /
 * 17,400 tokens against a single ceiling of 8 calls / 18,000 tokens: a 3.3%
 * token margin. One locale needing its already-implemented corrective second
 * attempt costs 2,000 more and failed the ENTIRE publication with
 * GAMBIT_LLM_BUDGET_EXCEEDED, and T2's analysis re-sample costs 4,000 more.
 *
 * The fix gives translation its own fail-closed quota (`gambit_translation`)
 * instead of raising a shared number, so the two sequential phases cannot
 * squeeze each other.
 */

/** Values as they exist in the live deployment configuration. */
const LIVE_ENV = {
  GAMBIT_MAX_LLM_CALLS_PER_RUN: '8',
  GAMBIT_MAX_LLM_TOKENS_PER_RUN: '18000',
  GAMBIT_MAX_HTTP_REQUESTS_PER_RUN: '20',
  GAMBIT_MAX_SOURCES_PER_RUN: '14',
  GAMBIT_MODEL_ROLES_JSON: '{"triage":{"timeoutMs":30000,"tokenBudget":2400},"gambit_analysis":{"timeoutMs":30000,"tokenBudget":4000},"critic":{"timeoutMs":30000,"tokenBudget":3000},"translation":{"timeoutMs":60000,"tokenBudget":2000}}',
};

const ROLES = getGambitModelRoleConfig(LIVE_ENV);

function role(name: string): GambitModelRoleConfig {
  const found = ROLES.find(item => item.role === name);
  if (!found) throw new Error(`missing role ${name}`);
  return found;
}

function llm<T>(value: T): GambitLLMResponse<T> {
  return { value, provider: 'TEST_ONLY_PROVIDER', modelId: 'TEST_ONLY_RUNTIME_MODEL', latencyMs: 1 };
}

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

const NATIVE_PROSE: Record<string, Record<string, unknown>> = {
  zh: {
    headline: '中文标题', surfaceEvent: '中文事件', facts: ['中文事实'],
    obviousLogic: '中文逻辑', thesis: '中文论点', mechanism: '中文机制',
    beneficiaries: ['开发者'], pressuredActors: ['现有平台'], countercase: '中文反方观点',
    falsifier: '中文反证条件', uncertainty: '中文不确定性',
    trajectory: { predictionStatement: '中文预测', reasoning: '中文理由', evidenceCriteria: '中文验证条件', falsifier: '中文反证条件' },
  },
  ja: {
    headline: '日本語の見出し', surfaceEvent: '日本語の出来事', facts: ['日本語の事実'],
    obviousLogic: '日本語の論理', thesis: '日本語の論旨', mechanism: '日本語の仕組み',
    beneficiaries: ['開発者'], pressuredActors: ['既存企業'], countercase: '日本語の反対の見方',
    falsifier: '日本語の反証条件', uncertainty: '日本語の不確実性',
    trajectory: { predictionStatement: '日本語の予測', reasoning: '日本語の理由', evidenceCriteria: '日本語の確認条件', falsifier: '日本語の反証条件' },
  },
  fr: {
    headline: 'Titre localisé', surfaceEvent: 'Événement localisé', facts: ['Fait localisé'],
    obviousLogic: 'La logique est documentée.', thesis: 'La thèse concerne la distribution.', mechanism: 'Le mécanisme réduit les coûts.',
    beneficiaries: ['Développeurs'], pressuredActors: ['Plateformes établies'], countercase: 'L’adoption peut rester limitée.',
    falsifier: 'La version est annulée.', uncertainty: 'L’exécution reste incertaine.',
    trajectory: { predictionStatement: 'La prévision est vérifiable.', reasoning: 'La raison est documentée.', evidenceCriteria: 'Une intégration est publiée.', falsifier: 'Aucune intégration n’est publiée.' },
  },
  es: {
    headline: 'Título localizado', surfaceEvent: 'Acontecimiento localizado', facts: ['Hecho localizado'],
    obviousLogic: 'La lógica está documentada.', thesis: 'La tesis afecta a la distribución.', mechanism: 'El mecanismo reduce los costes.',
    beneficiaries: ['Desarrolladores'], pressuredActors: ['Plataformas establecidas'], countercase: 'La adopción puede seguir limitada.',
    falsifier: 'La versión se cancela.', uncertainty: 'La ejecución sigue siendo incierta.',
    trajectory: { predictionStatement: 'La previsión es verificable.', reasoning: 'La razón está documentada.', evidenceCriteria: 'Se publica una integración.', falsifier: 'No se publica ninguna integración.' },
  },
};

/**
 * Identifies the corrective (second) attempt. Phase 1.7 reworded the corrective
 * prompt because it previously named ONLY a language-quality failure, while the
 * retry also fires for structural failures -- and a locale rejected for array
 * parity was being told to "fix the language", which is the wrong instruction.
 * This marker tracks the new wording.
 */
const CORRECTIVE_MARKER = 'The previous response was REJECTED by the publication validator.';

/**
 * Translation provider. When `failFirstAttemptLocales` is set, the initial
 * (non-corrective) attempt for those locales returns English prose, which fails
 * the target-language dominance check and forces the production corrective
 * retry path.
 */
function translationProvider(failFirstAttemptLocales: string[] = [], onCall?: (request: GambitLLMRequest) => void) {
  let calls = 0;
  const provider = new MockGambitProvider(async request => {
    calls += 1;
    onCall?.(request);
    const record = JSON.parse(request.user) as Record<string, unknown>;
    const locale = String(record.locale);
    const corrective = request.system.includes(CORRECTIVE_MARKER);
    const prose = NATIVE_PROSE[locale]!;
    const useEnglish = failFirstAttemptLocales.includes(locale) && !corrective;
    const value = {
      ...record,
      headline: useEnglish ? 'English headline for the release' : prose.headline,
      surfaceEvent: useEnglish ? 'English surface event describing the release.' : prose.surfaceEvent,
      facts: useEnglish ? ['English fact describing the documented standard.'] : prose.facts,
      obviousLogic: useEnglish ? 'English obvious logic sentence.' : prose.obviousLogic,
      thesis: useEnglish ? 'English thesis sentence about distribution.' : prose.thesis,
      mechanism: useEnglish ? 'English mechanism sentence about switching costs.' : prose.mechanism,
      beneficiaries: useEnglish ? ['Developers'] : prose.beneficiaries,
      pressuredActors: useEnglish ? ['Established platforms'] : prose.pressuredActors,
      countercase: useEnglish ? 'English countercase sentence.' : prose.countercase,
      falsifier: useEnglish ? 'English falsifier sentence.' : prose.falsifier,
      uncertainty: useEnglish ? 'English uncertainty sentence.' : prose.uncertainty,
      trajectories: Array.isArray(record.trajectories)
        ? record.trajectories.map(() => (useEnglish
          ? { predictionStatement: 'English prediction sentence.', reasoning: 'English reasoning sentence.', evidenceCriteria: 'English evidence criteria sentence.', falsifier: 'English falsifier sentence.' }
          : prose.trajectory))
        : [],
    };
    return llm(value);
  });
  return { provider, calls: () => calls };
}

class TranslationFixtureRepository {
  article: GambitPublicArticle | null = null;
  attempts: Array<{ stage: string; status: string; errorCode: string | null }> = [];
  published = false;

  async createArticleDraft(draft: GambitDraft) {
    this.article = {
      ...draft,
      articleId: 901,
      revisionId: 902,
      status: 'DRAFT',
      publishedAt: null,
      modifiedAt: draft.createdAt,
      translations: {},
    };
    return { articleId: 901, revisionId: 902 };
  }

  async getArticleById() {
    return this.article;
  }

  async saveTranslation(input: { translation: GambitTranslation }) {
    if (!this.article) return;
    this.article = { ...this.article, translations: { ...this.article.translations, [input.translation.locale]: input.translation } };
  }

  async publishAutomaticallyArticle() {
    if (!this.article) return false;
    this.published = true;
    this.article = { ...this.article, status: 'PUBLISHED', publishedAt: '2026-09-05T00:02:00.000Z' };
    return true;
  }

  async recordLLMAttempt(input: { stage: string; status: string; errorCode?: string | null }) {
    this.attempts.push({ stage: input.stage, status: input.status, errorCode: input.errorCode ?? null });
    return 1;
  }
}

/** Run the real analysis phase, then the real publication phase, on one budget. */
async function runFullPath(budget: GambitRunBudget, translationCalls?: (request: GambitLLMRequest) => void, failFirst: string[] = []) {
  const stages = await runGambitStages(candidate, [evidence], {
    roles: ROLES,
    budget,
    providers: {
      triage: new MockGambitProvider(async () => llm({
        eventImportance: 0.9,
        aiTechRelevance: true,
        politicsExcluded: false,
        evidenceSufficient: true,
        strategicMechanism: 'Compatibility lowers switching costs.',
        shouldDeepAnalysisRun: true,
        reason: 'TEST_ONLY',
      })),
      gambit_analysis: new MockGambitProvider(async () => llm(QUALIFIED_ANALYSIS)),
      critic: new MockGambitProvider(async () => llm({ accepted: true, politicalFraming: false })),
    },
  });
  expect(stages.status).toBe('AUTO_PUBLISH_ELIGIBLE');
  expect(stages.draft).toBeDefined();

  const translation = translationProvider(failFirst, translationCalls);
  const repository = new TranslationFixtureRepository();
  const published = await publishQualifiedGambit(repository as unknown as GambitRepository, stages.draft!, {
    translationProvider: translation.provider,
    translationRole: role('translation'),
    budget,
    runId: 1,
    now: new Date('2026-09-05T00:02:00.000Z'),
  });
  return { stages, translation, repository, published };
}

describe('Open Gambit translation budget (B1)', () => {
  it('completes the best path without a budget error', async () => {
    const budget = gambitBudgetFromEnv(LIVE_ENV);
    const { published, repository, translation } = await runFullPath(budget);

    expect(published.published).toBe(true);
    expect(published.translation.status).toBe('TRANSLATION_READY');
    expect(translation.calls()).toBe(4);
    expect(repository.attempts.some(attempt => attempt.errorCode === 'GAMBIT_LLM_BUDGET_EXCEEDED')).toBe(false);
    expect(budget.usage.llmTokens).toBe(9_400);
    expect(budget.usage.translationLlmTokens).toBe(8_000);
  });

  it('stays inside budget when one locale needs its corrective second attempt', async () => {
    const budget = gambitBudgetFromEnv(LIVE_ENV);
    const { published, repository, translation } = await runFullPath(budget, undefined, ['ja']);

    // This exact case failed the whole publication before the fix: 17,400 + 2,000
    // tokens exceeded the single 18,000-token ceiling.
    expect(translation.calls()).toBe(5);
    expect(published.published).toBe(true);
    expect(published.translation.status).toBe('TRANSLATION_READY');
    expect(repository.attempts.some(attempt => attempt.errorCode === 'GAMBIT_LLM_BUDGET_EXCEEDED')).toBe(false);
    expect(budget.usage.translationLlmTokens).toBe(10_000);
    expect(budget.remaining('gambit_translation')).toBeGreaterThan(0);
  });

  it('stays inside budget when every locale needs a corrective second attempt', async () => {
    const budget = gambitBudgetFromEnv(LIVE_ENV);
    const { published, repository, translation } = await runFullPath(budget, undefined, ['zh', 'ja', 'fr', 'es']);

    expect(translation.calls()).toBe(8);
    expect(published.published).toBe(true);
    expect(published.translation.status).toBe('TRANSLATION_READY');
    expect(repository.attempts.some(attempt => attempt.errorCode === 'GAMBIT_LLM_BUDGET_EXCEEDED')).toBe(false);
    // Exactly the measured worst case: 4 locales x 2 attempts x 2,000 tokens.
    expect(budget.usage.translationLlmTokens).toBe(16_000);
    expect(budget.remaining('gambit_translation')).toBe(0);
  });

  it('leaves room for the analysis re-sample alongside the worst-case translation', async () => {
    const budget = gambitBudgetFromEnv(LIVE_ENV);
    // Simulate the T2 re-sample on top of the measured deep-analysis spend.
    expect(budget.consume('gambit_llm', 2_400)).toBe(true);   // triage
    expect(budget.consume('gambit_llm', 4_000)).toBe(true);   // analysis
    expect(budget.consume('gambit_llm', 4_000)).toBe(true);   // analysis re-sample
    expect(budget.consume('gambit_llm', 3_000)).toBe(true);   // critic
    for (let attempt = 0; attempt < 8; attempt += 1) {
      expect(budget.consume('gambit_translation', 2_000)).toBe(true);
    }
    expect(budget.usage.llmTokens).toBe(13_400);
    expect(budget.usage.llmCalls).toBe(4);
    expect(budget.usage.translationLlmTokens).toBe(16_000);
    // The analysis quota keeps its exact remaining headroom: 4 calls (the
    // binding constraint) and 4,600 of 18,000 tokens.
    expect(budget.remaining('gambit_llm')).toBe(4);
    expect(budget.limits.maxLlmTokens - budget.usage.llmTokens).toBe(4_600);
    expect(budget.consume('gambit_llm', 4_600)).toBe(true);
    expect(budget.consume('gambit_llm', 1)).toBe(false);
    expect(budget.usage.llmTokens).toBe(18_000);
  });

  it('keeps translation out of the analysis quota', async () => {
    const budget = gambitBudgetFromEnv(LIVE_ENV);
    const { published } = await runFullPath(budget);
    expect(published.published).toBe(true);
    // Before the fix translation consumed gambit_llm; it now cannot squeeze it.
    expect(budget.usage.llmTokens).toBe(9_400);
    expect(budget.usage.llmCalls).toBe(3);
  });

  it('never treats a missing limit as an unbounded one', async () => {
    // tsconfig typechecks `src` only, so a stale object literal can omit a limit.
    // `usage + n > undefined` compares false, which would silently remove the
    // bound; the constructor must fall back to the documented default instead.
    const legacyLimits = {
      maxLlmCalls: 8,
      maxLlmTokens: 18_000,
      maxSearchRequests: 0,
      maxXRequests: 0,
      maxGithubRequests: 0,
      maxHttpRequests: 20,
    } as unknown as GambitBudgetLimits;

    const budget = new GambitRunBudget(legacyLimits);
    expect(budget.limits.maxTranslationLlmCalls).toBe(8);
    // Phase 1.7: the documented default must fund the real worst case,
    // 4 locales x 2 attempts x the 4,000-token translation role budget = 32,000.
    expect(budget.limits.maxTranslationLlmTokens).toBe(32_000);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      expect(budget.consume('gambit_translation', 4_000)).toBe(true);
    }
    expect(budget.consume('gambit_translation', 4_000)).toBe(false);

    const invalid = new GambitRunBudget({
      maxLlmCalls: Number.NaN,
      maxLlmTokens: 0,
      maxTranslationLlmCalls: Number.NaN,
      maxTranslationLlmTokens: Number.NaN,
      maxSearchRequests: 0,
      maxXRequests: 0,
      maxGithubRequests: 0,
      maxHttpRequests: 20,
    });
    expect(invalid.limits.maxLlmTokens).toBe(24_000);
    expect(invalid.limits.maxTranslationLlmTokens).toBe(32_000);
    expect(invalid.consume('gambit_llm', 24_000)).toBe(true);
    expect(invalid.consume('gambit_llm', 1)).toBe(false);
  });
});
