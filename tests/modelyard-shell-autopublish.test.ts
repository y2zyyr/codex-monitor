import { describe, expect, it } from 'vitest';
import { renderSharedFooter, renderSharedHeader } from '../src/site-shell';
import { renderAiDisclosurePage, renderOpenGambitArticle, renderOpenGambitLanding } from '../src/open-gambit/renderer';
import { renderCommunityPage, renderHomepage } from '../src/renderer';
import { runGambitStages, runQualifiedGambitWorkflow } from '../src/open-gambit/pipeline';
import { MockGambitProvider } from '../src/open-gambit/llm';
import type {
  GambitCandidate,
  GambitDraft,
  GambitEvidence,
  GambitLLMResponse,
  GambitPublicArticle,
  GambitSourceSnapshot,
  GambitWorkflowResult,
} from '../src/open-gambit/types';
import type { GambitRepository } from '../src/open-gambit/repository';

function llm<T>(value: T): GambitLLMResponse<T> {
  return { value, provider: 'TEST_ONLY_PROVIDER', modelId: 'TEST_ONLY_RUNTIME_MODEL', latencyMs: 1 };
}

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

class AutoPublishFixtureRepository {
  candidate = { ...fixtureCandidate };
  article: GambitPublicArticle | null = null;
  workflow: { status: string; articleId: number | null; revisionId: number | null; resultHash: string | null } | null = null;
  publication: string | null = null;
  approvalCount = 0;

  async getWorkflowResult() {
    return this.workflow;
  }

  async getCandidate() {
    return this.candidate;
  }

  async setCandidateStatus(_id: number, status: GambitCandidate['status'], rejectionReason: string | null = null) {
    this.candidate.status = status;
    this.candidate.rejectionReason = rejectionReason as GambitCandidate['rejectionReason'];
  }

  async getSnapshots() {
    return [fixtureSnapshot];
  }

  async recordLLMAttempt() {
    return 1;
  }

  async createArticleDraft(draft: GambitDraft, options: { publication?: 'REVIEW' | 'AUTO_PUBLISH' | 'AUTO_PUBLISH_PENDING'; now?: string } = {}) {
    this.publication = options.publication ?? 'REVIEW';
    const published = this.publication === 'AUTO_PUBLISH';
    this.article = {
      ...draft,
      articleId: 901,
      revisionId: 902,
      status: published ? 'PUBLISHED' : this.publication === 'AUTO_PUBLISH_PENDING' ? 'DRAFT' : 'WAITING_FOR_REVIEW',
      publishedAt: published ? options.now ?? draft.createdAt : null,
      modifiedAt: options.now ?? draft.createdAt,
      translations: {},
    };
    return { articleId: 901, revisionId: 902 };
  }

  async publishAutomaticallyArticle() {
    if (!this.article) return false;
    this.article = { ...this.article, status: 'PUBLISHED', publishedAt: '2026-09-05T00:02:00.000Z' };
    return true;
  }

  async getArticleById() {
    return this.article;
  }

  async saveTranslation(input: Parameters<GambitRepository['saveTranslation']>[0]) {
    if (!this.article) return;
    this.article = { ...this.article, translations: { ...this.article.translations, [input.translation.locale]: input.translation } };
  }

  async recordWorkflowResult(input: Parameters<GambitRepository['recordWorkflowResult']>[0]) {
    this.workflow = {
      status: input.result.status,
      articleId: input.result.articleId ?? null,
      revisionId: input.result.revisionId ?? null,
      resultHash: input.resultHash,
    };
  }
}

function qualifyingProviders() {
  return {
    triage: new MockGambitProvider(async () => llm({
      eventImportance: 0.9,
      aiTechRelevance: true,
      politicsExcluded: false,
      evidenceSufficient: true,
      strategicMechanism: 'Compatibility lowers switching costs.',
      shouldDeepAnalysisRun: true,
      reason: 'TEST_ONLY',
    })),
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
    translation: new MockGambitProvider(async request => {
      const record = JSON.parse(request.user) as Record<string, unknown>;
      const labels: Record<string, Record<string, unknown>> = {
        ja: {
          headline: '日本語の見出し', surfaceEvent: '日本語の出来事', facts: ['日本語の事実'],
          obviousLogic: '日本語の論理', thesis: '日本語の論旨', mechanism: '日本語の仕組み',
          beneficiaries: ['開発者'], pressuredActors: ['既存企業'], countercase: '日本語の反対の見方',
          falsifier: '日本語の反証条件', uncertainty: '日本語の不確実性',
        },
        zh: {
          headline: '中文标题', surfaceEvent: '中文事件', facts: ['中文事实'],
          obviousLogic: '中文逻辑', thesis: '中文论点', mechanism: '中文机制',
          beneficiaries: ['开发者'], pressuredActors: ['现有平台'], countercase: '中文反方观点',
          falsifier: '中文反证条件', uncertainty: '中文不确定性',
        },
        fr: {
          headline: 'Titre localisé', surfaceEvent: 'Événement localisé', facts: ['Fait localisé'],
          obviousLogic: 'La logique est documentée.', thesis: 'La thèse concerne la distribution.', mechanism: 'Le mécanisme réduit les coûts.',
          beneficiaries: ['Développeurs'], pressuredActors: ['Plateformes établies'], countercase: 'L’adoption peut rester limitée.',
          falsifier: 'La version est annulée.', uncertainty: 'L’exécution reste incertaine.',
        },
        es: {
          headline: 'Título localizado', surfaceEvent: 'Acontecimiento localizado', facts: ['Hecho localizado'],
          obviousLogic: 'La lógica está documentada.', thesis: 'La tesis afecta a la distribución.', mechanism: 'El mecanismo reduce los costes.',
          beneficiaries: ['Desarrolladores'], pressuredActors: ['Plataformas establecidas'], countercase: 'La adopción puede seguir limitada.',
          falsifier: 'La versión se cancela.', uncertainty: 'La ejecución sigue siendo incierta.',
        },
      };
      const locale = String(record.locale);
      const value = {
        ...record,
        ...(labels[locale] ?? {}),
        trajectories: Array.isArray(record.trajectories)
          ? record.trajectories.map(item => ({
            ...(item as Record<string, unknown>),
            ...(locale === 'ja'
              ? { predictionStatement: '日本語の予測', reasoning: '日本語の理由', evidenceCriteria: '日本語の確認条件', falsifier: '日本語の反証条件' }
              : locale === 'zh'
                ? { predictionStatement: '中文预测', reasoning: '中文理由', evidenceCriteria: '中文验证条件', falsifier: '中文反证条件' }
                : locale === 'fr'
                  ? { predictionStatement: 'La prévision est vérifiable.', reasoning: 'La raison est documentée.', evidenceCriteria: 'Une intégration est publiée.', falsifier: 'Aucune intégration n’est publiée.' }
                  : { predictionStatement: 'La previsión es verificable.', reasoning: 'La razón está documentada.', evidenceCriteria: 'Se publica una integración.', falsifier: 'No se publica ninguna integración.' }),
          }))
          : [],
      };
      return llm(value);
    }),
  };
}

describe('ModelYard shell and Open Gambit automatic publication', () => {
  it('uses ModelYard as the site brand and one shared shell for Gambit pages', () => {
    const sharedHeader = renderSharedHeader('en', { alternatePath: '/open-gambit/' });
    const sharedFooter = renderSharedFooter('en');
    const article = {
      ...fixtureCandidate,
      articleId: 1,
      revisionId: 2,
      slug: 'test-only-standard',
      surfaceEvent: fixtureCandidate.summary,
      facts: ['The standard was documented.'],
      obviousLogic: 'Compatibility can expand distribution.',
      thesis: 'The standard is a distribution wedge.',
      mechanism: 'It lowers switching costs.',
      beneficiaries: ['Developers'],
      pressuredActors: ['Closed vendors'],
      countercase: 'Adoption could remain limited.',
      trajectories: [],
      falsifier: 'The standard is cancelled.',
      evidence: [],
      uncertainty: 'Execution is uncertain.',
      politicalTopic: false,
      critic: { accepted: true, rejectionReasons: [], simplerExplanation: 'Normal execution.', motiveConcern: false, causalConcern: false, politicalFraming: false, sensationalismConcern: false, falsifiabilityConcern: false, notes: 'TEST_ONLY' },
      modelRoleProvenance: {},
      modelPromptVersion: 'gambit-prompts-v1',
      aiDisclosureVersion: 'v1',
      draftVersion: 1,
      createdAt: '2026-09-05T00:00:00.000Z',
      status: 'PUBLISHED' as const,
      publishedAt: '2026-09-05T00:00:00.000Z',
      modifiedAt: '2026-09-05T00:00:00.000Z',
      translations: {},
    } satisfies GambitPublicArticle;

    const renderedPages = [
      renderHomepage({ events: [], latestEvent: null, lastReset: null, lastPolicy: null, lastCheckedAt: null, totalEvents: 0 }, 'en'),
      renderHomepage({ events: [], latestEvent: null, lastReset: null, lastPolicy: null, lastCheckedAt: null, totalEvents: 0, gambitArticles: [article] }, 'zh'),
      renderCommunityPage({ posts: [], nextCursor: null, total: 0, postingEnabled: false, turnstileSiteKey: null, maxNicknameLength: 32, maxContentLength: 2_000 }, 'en'),
      renderOpenGambitLanding([], 'en'),
      renderOpenGambitArticle(article, 'en'),
      renderAiDisclosurePage('en'),
    ];
    for (const rendered of renderedPages) {
      expect(rendered).toContain('class="header"');
      expect(rendered).toContain('class="footer"');
      expect(rendered).toContain('ModelYard');
      expect(rendered).not.toContain('class="gambit-header"');
      expect(rendered).not.toContain('class="gambit-footer"');
      expect(rendered).not.toMatch(/Tibo (?:is|AI|system|publication|experimental)/i);
      expect(rendered).not.toContain('Tibo 是');
    }
    expect(sharedFooter.match(/class="footer-links"/g)).toHaveLength(1);
    const chineseLanding = renderOpenGambitLanding([], 'zh');
    expect(chineseLanding).toContain('<h1 id="gambitTitle">阳谋</h1>');
    expect(chineseLanding).not.toContain('Open Gambit：AI 战略分析');
    expect(chineseLanding).not.toContain('AI 运营说明');
    const chineseHomepage = renderHomepage({ events: [], latestEvent: null, lastReset: null, lastPolicy: null, lastCheckedAt: null, totalEvents: 0, gambitArticles: [article] }, 'zh');
    expect(chineseHomepage).toContain('<h2 id="homepageGambitTitle">阳谋</h2>');
    expect(chineseHomepage).toContain('分析 · 阳谋');
    expect(chineseHomepage).not.toContain('<h2 id="homepageGambitTitle">Open Gambit</h2>');
  });

  it('renders singular and plural trajectory labels without the trajectorys typo', () => {
    const base = {
      ...fixtureCandidate,
      articleId: 1,
      revisionId: 2,
      slug: 'test-only-labels',
      facts: [],
      obviousLogic: '',
      thesis: '',
      mechanism: '',
      beneficiaries: [],
      pressuredActors: [],
      countercase: '',
      falsifier: '',
      evidence: [],
      uncertainty: '',
      critic: {} as GambitPublicArticle['critic'],
      modelRoleProvenance: {},
      modelPromptVersion: 'gambit-prompts-v1',
      aiDisclosureVersion: 'v1',
      draftVersion: 1,
      createdAt: '2026-09-05T00:00:00.000Z',
      status: 'PUBLISHED' as const,
      publishedAt: '2026-09-05T00:00:00.000Z',
      modifiedAt: '2026-09-05T00:00:00.000Z',
      translations: {},
    };
    for (const count of [1, 2, 3]) {
      const rendered = renderOpenGambitLanding([{ ...base, trajectories: Array.from({ length: count }, (_, index) => ({
        id: `trajectory-${index + 1}`,
        predictionStatement: 'A measurable release will occur.',
        targetEntity: 'TEST_ONLY target',
        probability: 70,
        deadline: '2026-12-31',
        reasoning: 'The source documents a release plan.',
        evidenceCriteria: 'The release is documented.',
        falsifier: 'The release is cancelled.',
        status: 'WATCHING' as const,
      })) } as GambitPublicArticle], 'en');
      expect(rendered).toContain(`${count} ${count === 1 ? 'trajectory' : 'trajectories'}`);
      expect(rendered).not.toContain('trajectorys');
    }
  });

  it('publishes a qualifying workflow without an approval record and blocks a weak candidate', async () => {
    const repository = new AutoPublishFixtureRepository();
    const first = await runQualifiedGambitWorkflow({ workflowId: 'test-only-auto-901', candidateId: 901, snapshotIds: [901] }, {
      repository: repository as unknown as GambitRepository,
      providers: qualifyingProviders(),
      now: new Date('2026-09-05T00:02:00.000Z'),
    });
    expect(first.status).toBe('COMPLETED');
    expect(first.publicationDecision).toBe('AUTO_PUBLISH_ELIGIBLE');
    expect(repository.publication).toBe('AUTO_PUBLISH_PENDING');
    expect(repository.article?.status).toBe('PUBLISHED');
    expect(repository.candidate.status).toBe('PUBLISHED');
    expect(repository.approvalCount).toBe(0);

    const retry = await runQualifiedGambitWorkflow({ workflowId: 'test-only-auto-901', candidateId: 901, snapshotIds: [901] }, {
      repository: repository as unknown as GambitRepository,
      providers: qualifyingProviders(),
    });
    expect(retry.status).toBe('COMPLETED');
    expect(retry.reason).toBe('DUPLICATE_WORKFLOW_RESULT');
    expect(repository.approvalCount).toBe(0);

    const weakEvidence: GambitEvidence = {
      snapshotId: fixtureSnapshot.id!,
      sourceId: fixtureSnapshot.sourceId,
      sourceTier: fixtureSnapshot.sourceQualityTier,
      canonicalUrl: fixtureSnapshot.canonicalUrl,
      title: fixtureSnapshot.title,
      publisher: fixtureSnapshot.publisher,
      publishedAt: fixtureSnapshot.publishedAt,
      quote: fixtureSnapshot.normalizedContent,
      role: 'FACT',
      contentHash: fixtureSnapshot.contentHash,
    };
    const weak = await runGambitStages({ ...fixtureCandidate, id: 902, strategicValue: 0.2 }, [weakEvidence], { now: new Date('2026-09-05T00:02:00.000Z') });
    expect(weak.status).toBe('NO_GAMBIT');
    expect(weak.publicationDecision).toBe('LOW_STRATEGIC_VALUE');
    expect(weak.draft).toBeUndefined();
  });
});
