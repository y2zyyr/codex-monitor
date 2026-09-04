import { describe, expect, it } from 'vitest';
import { renderOpenGambitArticle } from '../src/open-gambit/renderer';
import { evaluatePredictionEvidence } from '../src/open-gambit/resolution';
import { MemorySnapshotBucket, R2SnapshotStore } from '../src/open-gambit/snapshots';
import { candidateFromDiscoveryItem } from '../src/open-gambit/sources';
import { runGambitStages } from '../src/open-gambit/pipeline';
import { MockGambitProvider } from '../src/open-gambit/llm';
import type {
  GambitEvidence,
  GambitLLMResponse,
  GambitPublicArticle,
  GambitTranslation,
  GambitSourceDefinition,
  GambitSourceSnapshot,
} from '../src/open-gambit/types';

/**
 * TEST_ONLY local demo: no network, API key, D1, R2, Workflow, or production
 * binding is used. The ledger mirrors the persisted state transitions closely
 * enough to exercise discovery -> draft -> approval -> publication -> review.
 */
class DemoLedger {
  private article: GambitPublicArticle | null = null;
  private originalPrediction: GambitPublicArticle['trajectories'][number] | null = null;
  private resolution: string | null = null;

  createDraft(draft: NonNullable<Awaited<ReturnType<typeof runGambitStages>>['draft']>): GambitPublicArticle {
    this.article = {
      ...draft,
      articleId: 1,
      status: 'WAITING_FOR_REVIEW',
      publishedAt: null,
      modifiedAt: draft.createdAt,
      translations: {},
    };
    this.originalPrediction = draft.trajectories[0] ? { ...draft.trajectories[0] } : null;
    return this.article;
  }

  approve(): void {
    if (!this.article) throw new Error('demo draft missing');
    this.article = { ...this.article, status: 'APPROVED', modifiedAt: '2026-09-04T00:05:00.000Z' };
  }

  translate(): void {
    if (!this.article) throw new Error('demo approval missing');
    const article = this.article;
    const makeTranslation = (locale: 'en' | 'zh'): GambitTranslation => ({
      locale,
      headline: locale === 'zh' ? 'TEST_ONLY 演示公司发布开放协议适配器' : article.headline,
      surfaceEvent: article.surfaceEvent,
      facts: [...article.facts],
      obviousLogic: article.obviousLogic,
      thesis: article.thesis,
      mechanism: article.mechanism,
      beneficiaries: [...article.beneficiaries],
      pressuredActors: [...article.pressuredActors],
      countercase: article.countercase,
      trajectories: article.trajectories.map(trajectory => ({ ...trajectory })),
      falsifier: article.falsifier,
      uncertainty: article.uncertainty,
      status: 'TRANSLATED',
      provider: 'TEST_ONLY_TRANSLATOR',
      translatedAt: '2026-09-04T00:05:30.000Z',
    });
    this.article = { ...article, translations: { en: makeTranslation('en'), zh: makeTranslation('zh') } };
  }

  publish(): GambitPublicArticle {
    if (!this.article || this.article.status !== 'APPROVED') throw new Error('demo approval missing');
    this.article = {
      ...this.article,
      status: 'PUBLISHED',
      publishedAt: '2026-09-04T00:06:00.000Z',
      modifiedAt: '2026-09-04T00:06:00.000Z',
    };
    return this.article;
  }

  appendResolution(state: string): void {
    this.resolution = state;
  }

  getArticle(): GambitPublicArticle {
    if (!this.article) throw new Error('demo article missing');
    return this.article;
  }

  getOriginalPrediction() {
    return this.originalPrediction;
  }

  getResolution(): string | null {
    return this.resolution;
  }
}

function llmResponse<T>(value: T): GambitLLMResponse<T> {
  return { value, provider: 'mock', modelId: 'TEST_ONLY', latencyMs: 1 };
}

describe('Open Gambit V1 local end-to-end demo', () => {
  it('runs a fictional non-political event through snapshot, analysis, approval, publication, and resolution', async () => {
    const source: GambitSourceDefinition = {
      id: 'demo-official',
      name: 'TEST_ONLY Demo Official Source',
      type: 'OFFICIAL_PRODUCT',
      url: 'https://demo.example/product',
      publisher: 'TEST_ONLY Demo Company',
      qualityTier: 'PRIMARY_OFFICIAL',
      enabled: true,
      allowedHosts: ['demo.example'],
    };
    const snapshot: GambitSourceSnapshot = {
      id: 1,
      sourceId: source.id,
      requestedUrl: source.url,
      finalUrl: source.url,
      canonicalUrl: source.url,
      title: 'TEST_ONLY Demo Company launches an open protocol adapter',
      publisher: source.publisher,
      publishedAt: '2026-09-01T00:00:00.000Z',
      retrievedAt: '2026-09-04T00:00:00.000Z',
      normalizedContent: 'TEST_ONLY Demo Company launches an open protocol adapter for developer tools before 2026-12-31. The adapter lowers switching costs and is documented for general availability.',
      contentHash: 'c'.repeat(64),
      extractorVersion: 'gambit-html-1',
      sourceQualityTier: source.qualityTier,
    };
    const bucket = new MemorySnapshotBucket();
    const snapshotStore = new R2SnapshotStore(bucket);
    const stored = await snapshotStore.put(snapshot);
    expect(stored.key).toContain('gambit/snapshots/sha256/');

    const discovered = await candidateFromDiscoveryItem({
      source,
      url: snapshot.canonicalUrl,
      title: snapshot.title!,
      summary: snapshot.normalizedContent,
      snapshot,
    }, snapshot.id);
    expect(discovered.candidate.status).toBe('QUALIFIED');
    const qualified = { ...discovered.candidate, id: 1 };
    const evidence: GambitEvidence[] = [{ ...discovered.evidence, id: 1 }];

    const triage = new MockGambitProvider(async () => llmResponse({
      eventImportance: 0.9,
      aiTechRelevance: true,
      politicsExcluded: false,
      evidenceSufficient: true,
      strategicMechanism: 'An open adapter changes distribution and switching costs.',
      shouldDeepAnalysisRun: true,
      reason: 'TEST_ONLY demo passes triage.',
    }));
    const analysis = new MockGambitProvider(async () => llmResponse({
      decision: 'QUALIFIED',
      facts: ['The fictional company announced an open protocol adapter.'],
      evidenceIds: [1],
      obviousLogic: 'An adapter can increase adoption of the company platform.',
      thesis: 'The adapter is a distribution gambit that makes the company a default integration point.',
      mechanism: 'Lower switching costs let more developer tools connect to the platform.',
      beneficiaries: ['Developers adopting the protocol'],
      pressuredActors: ['Closed integration vendors'],
      countercase: 'The adapter may remain a compatibility layer without meaningful default status.',
      trajectories: [{
        id: 'trajectory-1',
        predictionStatement: 'The adapter will be generally available to developers.',
        targetEntity: 'TEST_ONLY Demo Company adapter',
        probability: 70,
        deadline: '2026-12-31',
        reasoning: 'The source documents general availability work and a distribution incentive.',
        evidenceCriteria: 'The adapter is generally available to developers.',
        falsifier: 'A primary source says the adapter was cancelled.',
        status: 'WATCHING',
      }],
      uncertainty: 'Execution and adoption remain uncertain.',
    }));
    const staged = await runGambitStages(qualified, evidence, {
      providers: { triage, gambit_analysis: analysis },
      now: new Date('2026-09-04T00:00:00.000Z'),
    });
    expect(staged.status).toBe('WAITING_FOR_REVIEW');
    expect(staged.draft).toBeDefined();

    const ledger = new DemoLedger();
    ledger.createDraft(staged.draft!);
    ledger.approve();
    ledger.translate();
    const published = ledger.publish();
    const resolution = evaluatePredictionEvidence({
      originalPredictionStatement: published.trajectories[0].predictionStatement,
      originalObservableCondition: published.trajectories[0].evidenceCriteria,
      originalFalsifier: published.trajectories[0].falsifier,
      originalDeadline: published.trajectories[0].deadline,
    }, [{ ...evidence, quote: 'The adapter is now generally available to developers.' }]);
    ledger.appendResolution(resolution.state);

    expect(published.status).toBe('PUBLISHED');
    expect(ledger.getResolution()).toBe('HIT');
    expect(ledger.getOriginalPrediction()?.probability).toBe(70);
    expect(ledger.getOriginalPrediction()?.predictionStatement).toContain('generally available');
    expect(renderOpenGambitArticle(published, 'en')).toContain('Human-approved publication');
    expect(published.translations.zh?.status).toBe('TRANSLATED');
    expect(published.translations.zh?.trajectories[0].probability).toBe(70);
    expect(published.translations.zh?.trajectories[0].deadline).toBe('2026-12-31');
    expect(renderOpenGambitArticle(published, 'zh')).toContain('TEST_ONLY 演示公司发布开放协议适配器');
  });

  it('keeps political and no-Gambit branches out of the demo publication path', async () => {
    const politicalSource: GambitSourceDefinition = {
      id: 'demo-political',
      name: 'TEST_ONLY Political Fixture',
      type: 'SEARCH',
      url: 'https://demo.example/political',
      publisher: 'TEST_ONLY',
      qualityTier: 'SECONDARY_HIGH_QUALITY',
      enabled: true,
      allowedHosts: ['demo.example'],
    };
    const politicalSnapshot: GambitSourceSnapshot = {
      id: 2,
      sourceId: politicalSource.id,
      requestedUrl: politicalSource.url,
      finalUrl: politicalSource.url,
      canonicalUrl: politicalSource.url,
      title: 'Minister election campaign fixture',
      publisher: 'TEST_ONLY',
      publishedAt: null,
      retrievedAt: '2026-09-04T00:00:00.000Z',
      normalizedContent: 'A minister election campaign discusses software policy.',
      contentHash: 'd'.repeat(64),
      extractorVersion: 'gambit-html-1',
      sourceQualityTier: politicalSource.qualityTier,
    };
    const political = await candidateFromDiscoveryItem({ source: politicalSource, url: politicalSnapshot.canonicalUrl, title: politicalSnapshot.title!, summary: politicalSnapshot.normalizedContent, snapshot: politicalSnapshot }, 2);
    expect(political.candidate.status).toBe('REJECTED');
    expect(political.candidate.rejectionReason).toBe('POLITICAL_TOPIC_EXCLUDED');

    const noGambit = await candidateFromDiscoveryItem({ source: politicalSource, url: 'https://demo.example/empty', title: 'Unclear update', summary: 'Maybe something happened.', snapshot: { ...politicalSnapshot, canonicalUrl: 'https://demo.example/empty', normalizedContent: 'Maybe.' } }, 2);
    expect(noGambit.candidate.status).toBe('REJECTED');
    expect(noGambit.candidate.rejectionReason).toBe('INSUFFICIENT_EVIDENCE');
  });
});
