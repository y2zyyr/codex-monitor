import { describe, expect, it } from 'vitest';
import { extractEvidenceDocument, fetchEvidence } from '../src/open-gambit/evidence';
import { dispatchQualifiedGambit } from '../src/open-gambit/workflow';
import { discoverConfiguredSources, selectSourcesForRun } from '../src/open-gambit/sources';
import { translateGambit } from '../src/open-gambit/publication';
import type { GambitPublicArticle, GambitSourceDefinition } from '../src/open-gambit/types';

const feedSource: GambitSourceDefinition = {
  id: 'completion-feed',
  name: 'TEST_ONLY completion feed',
  type: 'RSS',
  url: 'https://example.com/changelog',
  publisher: 'TEST_ONLY publisher',
  qualityTier: 'PRIMARY_OFFICIAL',
  enabled: true,
  allowedHosts: ['example.com'],
  feedUrl: 'https://example.com/changelog/feed.xml',
};

const rss = `<?xml version="1.0"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel><title>TEST_ONLY Changelog</title>
    <item><guid isPermaLink="false">release-2</guid><title>Release 2 &amp; distribution</title><link>https://example.com/releases/2</link><pubDate>Sat, 05 Sep 2026 12:00:00 GMT</pubDate><content:encoded><![CDATA[<p>A compatibility release changes developer distribution.</p><script>ignore me</script>]]></content:encoded></item>
    <item><guid>release-1</guid><title>Release 1</title><link>https://example.com/releases/1</link><pubDate>Fri, 04 Sep 2026 12:00:00 GMT</pubDate><description>Earlier release content.</description></item>
  </channel>
</rss>`;

const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><title>TEST_ONLY Releases</title>
  <entry><id>tag:example.com,2026:2</id><title>Release 2</title><link rel="self" href="https://example.com/api/2"/><link rel="alternate" href="https://example.com/releases/2"/><updated>2026-09-05T12:00:00Z</updated><summary>API compatibility changes distribution.</summary></entry>
</feed>`;

describe('Open Gambit feed item completion', () => {
  it('parses RSS items and Atom entries as bounded item records', async () => {
    const parsedRss = extractEvidenceDocument(rss, 'application/rss+xml', 20_000);
    expect(parsedRss.isFeed).toBe(true);
    expect(parsedRss.feedItems).toHaveLength(2);
    expect(parsedRss.feedItems[0]).toMatchObject({
      stableId: 'release-2',
      title: 'Release 2 & distribution',
      canonicalUrl: 'https://example.com/releases/2',
      publishedAt: '2026-09-05T12:00:00.000Z',
    });
    expect(parsedRss.feedItems[0].content).toContain('compatibility release');
    expect(parsedRss.feedItems[0].content).not.toContain('ignore me');

    const parsedAtom = extractEvidenceDocument(atom, 'application/atom+xml', 20_000);
    expect(parsedAtom.isFeed).toBe(true);
    expect(parsedAtom.feedItems).toMatchObject([{
      stableId: 'tag:example.com,2026:2',
      canonicalUrl: 'https://example.com/releases/2',
      publishedAt: '2026-09-05T12:00:00.000Z',
    }]);
  });

  it('rejects XML declarations that could enable external entities', () => {
    const unsafe = extractEvidenceDocument('<!DOCTYPE feed [<!ENTITY x SYSTEM "https://evil.example/secret">]><rss><channel><item><title>x</title></item></channel></rss>', 'application/rss+xml');
    expect(unsafe.isFeed).toBe(false);
    expect(unsafe.feedItems).toEqual([]);
  });

  it('selects recent allowlisted items, never follows item URLs, and rotates sources deterministically', async () => {
    const fetched: string[] = [];
    const result = await discoverConfiguredSources([feedSource], {
      now: new Date('2026-09-06T00:00:00.000Z'),
      maxSources: 1,
      maxItemsPerSource: 1,
      maxItemAgeDays: 30,
      rotationKey: 'completion-window',
      fetchImpl: async url => {
        fetched.push(String(url));
        return new Response(rss, { status: 200, headers: { 'content-type': 'application/rss+xml' } });
      },
    });
    expect(fetched).toEqual([feedSource.feedUrl]);
    expect(result.rawItemsFound).toBe(2);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].snapshot.canonicalUrl).toBe('https://example.com/releases/2');
    expect(result.items[0].snapshot.extractorVersion).toBe('gambit-feed-item-1');
    expect(result.items[0].snapshot.requestedUrl).toBe(feedSource.feedUrl);

    const sources = Array.from({ length: 4 }, (_, index) => ({ ...feedSource, id: `source-${index}` }));
    const selected = new Set(['completion-a', 'completion-b', 'completion-c', 'completion-d']
      .flatMap(key => selectSourcesForRun(sources, 1, key).map(source => source.id)));
    expect(selected.size).toBeGreaterThan(1);
  });

  it('fetches only the configured feed endpoint', async () => {
    const urls: string[] = [];
    const result = await fetchEvidence(feedSource.feedUrl!, feedSource, {
      fetchImpl: async url => {
        urls.push(String(url));
        return new Response(atom, { status: 200, headers: { 'content-type': 'application/atom+xml' } });
      },
    });
    expect(result.ok).toBe(true);
    expect(urls).toEqual([feedSource.feedUrl]);
    if (result.ok) expect(result.feedItems[0].canonicalUrl).toBe('https://example.com/releases/2');
  });
});

describe('Open Gambit Workflow and locale publication contracts', () => {
  it('fails closed without a production/staging Workflow binding and reserves one idempotent instance', async () => {
    const calls: string[] = [];
    const workflows = new Map<string, { status: string; articleId: number | null; revisionId: number | null; resultHash: string | null; reason: string | null }>();
    const repository = {
      getWorkflowResult: async (id: string) => workflows.get(id) ?? null,
      recordWorkflowStart: async (input: { workflowId: string }) => {
        calls.push('reserve');
        if (workflows.has(input.workflowId)) return false;
        workflows.set(input.workflowId, { status: 'RUNNING', articleId: null, revisionId: null, resultHash: null, reason: null });
        return true;
      },
      recordWorkflowResult: async () => undefined,
    };
    const binding = { create: async () => { calls.push('create'); } };
    const env = { DB: {}, BUILD_ENVIRONMENT: 'staging' } as never;
    await expect(dispatchQualifiedGambit({ workflowId: 'completion-workflow-1', candidateId: 1, snapshotIds: [] }, env, { repository: repository as never, binding })).resolves.toMatchObject({ status: 'DISPATCHED' });
    await expect(dispatchQualifiedGambit({ workflowId: 'completion-workflow-1', candidateId: 1, snapshotIds: [] }, env, { repository: repository as never, binding })).resolves.toMatchObject({ status: 'DISPATCHED' });
    expect(calls).toEqual(['reserve', 'create']);
    await expect(dispatchQualifiedGambit({ workflowId: 'completion-workflow-2', candidateId: 2, snapshotIds: [] }, env, { repository: repository as never })).rejects.toThrow('WORKFLOW_BINDING_UNAVAILABLE');
  });

  it('produces all locale renderings from one canonical record and preserves provenance', async () => {
    const saved: Array<{ locale: string; translationState?: string }> = [];
    const article = {
      articleId: 7,
      candidateId: 8,
      headline: 'Canonical headline',
      surfaceEvent: 'Canonical event',
      facts: ['A fact'],
      obviousLogic: 'The obvious logic',
      thesis: 'The thesis',
      mechanism: 'The mechanism',
      beneficiaries: ['Developers'],
      pressuredActors: ['Incumbents'],
      countercase: 'The countercase',
      trajectories: [{ id: 'trajectory-1', predictionStatement: 'The release will ship.', targetEntity: 'TEST_ONLY project', probability: 70, deadline: '2026-12-31', reasoning: 'Reasoning', evidenceCriteria: 'A release is observed.', falsifier: 'The release is cancelled.', status: 'WATCHING' as const }],
      falsifier: 'The release is cancelled.',
      evidence: [{ id: 11, snapshotId: 12, sourceId: 'official-source', sourceTier: 'PRIMARY_OFFICIAL' as const, canonicalUrl: 'https://example.com/release', title: 'Release', publisher: 'Official', publishedAt: '2026-09-05T00:00:00.000Z', quote: 'Evidence', role: 'FACT' as const, contentHash: 'a'.repeat(64) }],
      uncertainty: 'Execution is uncertain.',
      politicalTopic: false,
      critic: {} as GambitPublicArticle['critic'],
      modelRoleProvenance: {},
      modelPromptVersion: 'gambit-prompts-v1',
      aiDisclosureVersion: 'v1',
      draftVersion: 1,
      createdAt: '2026-09-05T00:00:00.000Z',
      status: 'DRAFT' as const,
      publishedAt: null,
      modifiedAt: '2026-09-05T00:00:00.000Z',
      translations: {},
    } as GambitPublicArticle;
    const repository = {
      saveTranslation: async (input: { translation: { locale: string; translationState?: string } }) => saved.push(input.translation),
      recordLLMAttempt: async () => 1,
    };
    const translationCalls: Record<string, number> = {};
    const provider = {
      name: 'TEST_ONLY_PROVIDER',
      complete: async <T>(request: { user: string }) => {
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
        const label = labels[String(record.locale)] ?? {};
        const locale = String(record.locale);
        translationCalls[locale] = (translationCalls[locale] ?? 0) + 1;
        const value = {
          ...record,
          ...label,
          trajectories: Array.isArray(record.trajectories)
            ? record.trajectories.map(item => ({
              ...(item as Record<string, unknown>),
              ...(String(record.locale) === 'ja'
                ? { predictionStatement: '日本語の予測', reasoning: '日本語の理由', evidenceCriteria: '日本語の確認条件', falsifier: '日本語の反証条件' }
                : String(record.locale) === 'zh'
                  ? { predictionStatement: '中文预测', reasoning: '中文理由', evidenceCriteria: '中文验证条件', falsifier: '中文反证条件' }
                  : String(record.locale) === 'fr'
                    ? { predictionStatement: 'La prévision est vérifiable.', reasoning: 'La raison est documentée.', evidenceCriteria: 'Une intégration est publiée.', falsifier: 'Aucune intégration n’est publiée.' }
                    : { predictionStatement: 'La previsión es verificable.', reasoning: 'La razón está documentada.', evidenceCriteria: 'Se publica una integración.', falsifier: 'No se publica ninguna integración.' }),
            }))
            : [],
        };
        if (locale === 'ja' && translationCalls[locale] === 1) {
          value.countercase = '日本語の文に完全な英語の節が混在しています。 The platform will expand adoption.';
        }
        return { value: value as T, provider: 'TEST_ONLY_PROVIDER', modelId: 'TEST_ONLY_RUNTIME', latencyMs: 1 };
      },
    };
    const result = await translateGambit(repository as never, article, 13, provider, { role: 'translation', runtimeProvider: 'actual', runtimeModelId: 'actual-model', publicAiIdentity: 'DeepSeek V4 Pro', timeoutMs: 1000, retryLimit: 0, tokenBudget: 100 }, new Date('2026-09-05T00:01:00.000Z'));
    expect(result.status).toBe('TRANSLATION_READY');
    expect(Object.keys(result.localeStates)).toEqual(['en', 'zh', 'ja', 'fr', 'es']);
    expect(saved).toHaveLength(5);
    expect(saved.every(item => item.translationState === 'TRANSLATION_READY')).toBe(true);
    expect(translationCalls).toEqual({ zh: 1, ja: 2, fr: 1, es: 1 });
  });
});
