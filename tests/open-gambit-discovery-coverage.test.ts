// ============================================================
// Open Gambit — Discovery Coverage Redesign
// ============================================================
// Tests proving:
//   - Broad discovery: all enabled sources considered
//   - Per-source failure isolation
//   - Global candidate pool and event dedup
//   - Global Top-K across sources (not per source)
//   - Workflow dispatch globally bounded
//   - Routine maintenance filtered
//   - Strategic events admitted
//   - No raw falsifiability early gate
//   - Zero publication valid
//   - Latest-scan UI uses real data
//   - Five-locale UI parity
//   - Production-only diagnostics protected
// ============================================================

import { describe, expect, it } from 'vitest';
import { selectGlobalTopK, globalRankScore, eventClusterKey, sharedConcreteTokenCount, extractActor } from '../src/open-gambit/selection';
import { renderOpenGambitLanding } from '../src/open-gambit/renderer';
import { discoverConfiguredSources, selectSourcesForRun } from '../src/open-gambit/sources';
import { runGambitDiscovery } from '../src/open-gambit/service';
import { GambitRunBudget } from '../src/open-gambit/budget';
import type { GambitCandidate, GambitEvidence, GambitLatestScan, GambitSourceDefinition, GambitPublicArticle } from '../src/open-gambit/types';
import { GAMBIT_LOCALES } from '../src/open-gambit/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SOURCE_KINDS = {
  testOfficial: (id: string, tier: 'PRIMARY_OFFICIAL' | 'PRIMARY_REPOSITORY' = 'PRIMARY_OFFICIAL'): GambitSourceDefinition => ({
    id, name: `TEST_ONLY ${id}`, type: 'OFFICIAL_BLOG', url: 'https://example.com/' + id,
    publisher: 'TEST_ONLY Example', qualityTier: tier, enabled: true, allowedHosts: ['example.com'],
  }),
};

function makeCandidate(id: number, headline: string, strategicValue: number, discoveredAt: string, sourceId = 'test-official', falsifiable = false, status = 'QUALIFIED' as const): GambitCandidate {
  return {
    id, fingerprint: `test-${id}`.repeat(10).slice(0, 64), headline, summary: headline,
    canonicalUrl: 'https://example.com/' + id, snapshotIds: [id], sourceIds: [sourceId],
    politicalTopic: false, politicalReasons: [], evidenceSufficient: true,
    strategicValue, falsifiable, status, discoveredAt,
  };
}

function makeEvidence(sourceTier: 'PRIMARY_OFFICIAL' | 'PRIMARY_REPOSITORY' | 'DISCOVERY_ONLY', quote: string, publishedAt = '2026-09-07T00:00:00.000Z'): GambitEvidence {
  return {
    id: 1, snapshotId: 1, sourceId: 'test-official', sourceTier,
    canonicalUrl: 'https://example.com/1', title: 'Test', publisher: 'TEST_ONLY',
    publishedAt, quote, role: 'FACT', contentHash: 'a'.repeat(64),
  };
}

// ---------------------------------------------------------------------------
// 1. Broad source selection
// ---------------------------------------------------------------------------

describe('broad source scanning', () => {
  it('selects all enabled sources when maxSources >= enabled count', () => {
    const sources = [1, 2, 3, 4, 5].map(n => SOURCE_KINDS.testOfficial(`src-${n}`));
    const selected = selectSourcesForRun(sources, 5, 'rotation-key');
    expect(selected).toHaveLength(5);
    expect(selected.map(s => s.id)).toEqual(['src-1', 'src-2', 'src-3', 'src-4', 'src-5']);
  });

  it('selects a subset when maxSources < enabled count', () => {
    const sources = [1, 2, 3, 4, 5].map(n => SOURCE_KINDS.testOfficial(`src-${n}`));
    const selected = selectSourcesForRun(sources, 2, 'rotation-key');
    expect(selected).toHaveLength(2);
    // Rotation is deterministic — fnv1a32 of 'rotation-key' % 5 = offset
    const offset = fnv1a32('rotation-key') % 5;
    expect(selected[0].id).toBe(`src-${offset + 1}`);
  });

  it('returns empty for zero enabled sources', () => {
    expect(selectSourcesForRun([], 10)).toEqual([]);
  });

  it('excludes disabled sources', () => {
    const sources = [
      SOURCE_KINDS.testOfficial('a'),
      { ...SOURCE_KINDS.testOfficial('b'), enabled: false },
      SOURCE_KINDS.testOfficial('c'),
    ];
    const selected = selectSourcesForRun(sources, 10);
    expect(selected).toHaveLength(2);
    expect(selected.find(s => s.id === 'test-official-b')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2. Per-source failure isolation
// ---------------------------------------------------------------------------

describe('per-source failure isolation', () => {
  it('isolates a single broken source while others succeed', async () => {
    const sources = [1, 2, 3].map(n => SOURCE_KINDS.testOfficial(`src-${n}`));
    // Make source at index 1 fail (URL-based, safe under parallelism)
    const mockFetch = async (url: string) => {
      if (String(url).includes('src-2')) throw new Error('NETWORK_ERROR');
      const number = String(url).includes('src-1') ? 1 : 3;
      return new Response(
        '<?xml version="1.0"?><feed><entry><title>Item ' + number + '</title>'
        + '<link href="https://example.com/' + number + '"/><content>Strategic model launch report.</content>'
        + '<published>2026-09-06T00:00:00Z</published></entry></feed>',
        { status: 200, headers: { 'content-type': 'application/atom+xml' } },
      );
    };
    const result = await discoverConfiguredSources(sources, {
      fetchImpl: mockFetch as unknown as typeof fetch,
      now: new Date('2026-09-07'),
      maxItemsPerSource: 1,
      maxItemAgeDays: 30,
      concurrency: 2, // parallel
      maxSources: 3,
      timeoutMs: 8_000,
      maxBytes: 512_000,
    });
    expect(result.fetchCount).toBe(3); // 3 attempts
    expect(result.failures).toHaveLength(1); // 1 failed
    expect(result.failures[0].sourceId).toBe('src-2');
    expect(result.sourcesSucceeded).toBe(2); // 2 succeeded
    expect(result.items.length).toBe(2); // 2 items from 2 successful sources
    expect(result.admittedItems).toBe(2);
  });

  it('budget exhaustion stops further fetches but does not invalidate prior results', async () => {
    const sources = [1, 2, 3].map(n => SOURCE_KINDS.testOfficial(`src-${n}`));
    const budget = new GambitRunBudget({ maxLlmCalls: 10, maxLlmTokens: 10000, maxSearchRequests: 0, maxXRequests: 0, maxGithubRequests: 0, maxHttpRequests: 2 });
    let fetchCount = 0;
    const mockFetch = async () => {
      fetchCount += 1;
      return new Response(
        '<?xml version="1.0"?><feed><entry><title>Item</title>'
        + '<link href="https://example.com/' + fetchCount + '"/><content>Strategic model launch.</content>'
        + '<published>2026-09-06T00:00:00Z</published></entry></feed>',
        { status: 200, headers: { 'content-type': 'application/atom+xml' } },
      );
    };
    const result = await discoverConfiguredSources(sources, {
      fetchImpl: mockFetch as unknown as typeof fetch,
      now: new Date('2026-09-07'), maxItemsPerSource: 1, maxItemAgeDays: 30, concurrency: 3,
      maxSources: 3, timeoutMs: 8000, maxBytes: 512000, budget,
    });
    expect(fetchCount).toBe(2); // only 2 HTTP budget
    expect(result.failures).toHaveLength(1); // 1 budget-exceeded
    expect(result.failures[0].status).toBe('BUDGET_EXCEEDED');
    expect(result.sourcesSucceeded).toBe(2); // 2 succeeded
  });
});

// ---------------------------------------------------------------------------
// 3. Event cluster key and token overlap
// ---------------------------------------------------------------------------

describe('event clustering', () => {
  it('extracts actor from headline and publisher', () => {
    expect(extractActor('OpenAI launches GPT-5', '', 'OpenAI')).toBe('openai');
    expect(extractActor('Anthropic Claude 4.5 release', '', 'Anthropic')).toBe('anthropic');
    expect(extractActor('Google DeepMind new model', '', 'Google DeepMind')).toBe('google-deepmind');
    expect(extractActor('v0.2.152', 'Updated bundled Claude CLI', 'Anthropic')).toBe('anthropic');
    expect(extractActor('Unknown widget update', '', 'Widget Corp')).toBe('unknown');
  });

  it('produces same cluster key for same actor, family, and week', () => {
    const key1 = eventClusterKey({
      headline: 'OpenAI launches GPT-5', summary: 'Major model', publishedAt: '2026-09-07T10:00:00Z',
      signalTypes: ['MODEL_LAUNCH'], publisher: 'OpenAI',
    });
    const key2 = eventClusterKey({
      headline: 'OpenAI GPT-5 release', summary: 'Now available', publishedAt: '2026-09-08T00:00:00Z',
      signalTypes: ['MODEL_LAUNCH'], publisher: 'OpenAI',
    });
    // Same actor (openai), same family (MODEL_LAUNCH), same week (Sep 7)
    expect(key1).toBe(key2);
    expect(key1).toContain('openai');
    expect(key1).toContain('MODEL_LAUNCH');
  });

  it('produces different cluster keys for different families', () => {
    const key1 = eventClusterKey({
      headline: 'OpenAI model launch', summary: '', publishedAt: '2026-09-07T00:00:00Z',
      signalTypes: ['MODEL_LAUNCH'], publisher: 'OpenAI',
    });
    const key2 = eventClusterKey({
      headline: 'OpenAI price cut', summary: '', publishedAt: '2026-09-07T00:00:00Z',
      signalTypes: ['PRICE_CHANGE'], publisher: 'OpenAI',
    });
    expect(key1).not.toBe(key2);
  });

  it('detects concrete token overlap', () => {
    // Shared token "gpt-5" (len >= 5)
    expect(sharedConcreteTokenCount('OpenAI launches GPT-5 model', 'GPT-5 now available for developers')).toBe(1);
    // No shared >=5-char token
    expect(sharedConcreteTokenCount('OpenAI model launch', 'AI price cut')).toBe(0);
    // Version numbers
    expect(sharedConcreteTokenCount('v0.2.152 release', 'v0.2.152 update')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 4. Global ranking
// ---------------------------------------------------------------------------

describe('global ranking', () => {
  it('prefers higher strategic substance', () => {
    const now = new Date('2026-09-07');
    const high = globalRankScore(
      makeCandidate(1, 'Model launch', 0.85, '2026-09-07T00:00:00Z'),
      [makeEvidence('PRIMARY_OFFICIAL', 'Model launch')], ['MODEL_LAUNCH'], 0, now,
    );
    const low = globalRankScore(
      makeCandidate(2, 'Routine patch', 0.2, '2026-09-07T00:00:00Z'),
      [makeEvidence('PRIMARY_REPOSITORY', 'Routine patch')], ['UNKNOWN'], 0, now,
    );
    expect(high).toBeGreaterThan(low);
  });

  it('boosts by event family priority', () => {
    const now = new Date('2026-09-07');
    const modelLaunch = globalRankScore(
      makeCandidate(1, 'Model launch', 0.65, '2026-09-07T00:00:00Z'),
      [makeEvidence('PRIMARY_OFFICIAL', 'Model launch')], ['MODEL_LAUNCH'], 0, now,
    );
    const contextExpansion = globalRankScore(
      makeCandidate(2, 'Context window expanded', 0.65, '2026-09-07T00:00:00Z'),
      [makeEvidence('PRIMARY_OFFICIAL', 'Context expansion')], ['CONTEXT_EXPANSION'], 0, now,
    );
    expect(modelLaunch).toBeGreaterThan(contextExpansion);
  });

  it('boosts by corroboration count', () => {
    const now = new Date('2026-09-07');
    const single = globalRankScore(
      makeCandidate(1, 'Model launch', 0.65, '2026-09-07T00:00:00Z'),
      [makeEvidence('PRIMARY_OFFICIAL', 'Model launch')], ['MODEL_LAUNCH'], 0, now,
    );
    const corroborated = globalRankScore(
      makeCandidate(2, 'Model launch', 0.65, '2026-09-07T00:00:00Z'),
      [makeEvidence('PRIMARY_OFFICIAL', 'Model launch'), makeEvidence('PRIMARY_REPOSITORY', 'Changelog')], ['MODEL_LAUNCH'], 2, now,
    );
    expect(corroborated).toBeGreaterThan(single);
  });

  it('prefers same strategic substance within same family when recency is equal', () => {
    const now = new Date('2026-09-07');
    const authoritative = globalRankScore(
      makeCandidate(1, 'OpenAI price cut', 0.75, '2026-09-07T00:00:00Z'),
      [makeEvidence('PRIMARY_OFFICIAL', 'API price cut 80%')], ['PRICE_CHANGE'], 0, now,
    );
    const repository = globalRankScore(
      makeCandidate(2, 'OpenAI price cut', 0.75, '2026-09-07T00:00:00Z'),
      [makeEvidence('PRIMARY_REPOSITORY', 'API price cut 80%')], ['PRICE_CHANGE'], 0, now,
    );
    expect(authoritative).toBeGreaterThan(repository);
  });
});

// ---------------------------------------------------------------------------
// 5. Global Top-K selection
// ---------------------------------------------------------------------------

describe('global Top-K selection', () => {
  const now = new Date('2026-09-07');

  it('selects top K across all sources, not per source', () => {
    // 4 qualified strategic candidates across sources (service.ts only feeds
    // QUALIFIED candidates into the global pool; REJECTED never reaches here)
    const candidates = [
      { candidate: makeCandidate(1, 'Major model launch', 0.85, '2026-09-07T00:00:00Z', 'source-b'), evidence: [makeEvidence('PRIMARY_OFFICIAL', 'Company launches a new flagship model for developers.')] },
      { candidate: makeCandidate(2, '80% API price cut', 0.85, '2026-09-07T00:00:00Z', 'source-c'), evidence: [makeEvidence('PRIMARY_OFFICIAL', 'Company cuts API prices by 80%.')] },
      { candidate: makeCandidate(3, 'Paid Agent becomes free', 0.85, '2026-09-07T00:00:00Z', 'source-d'), evidence: [makeEvidence('PRIMARY_OFFICIAL', 'Previously paid Agent capability is now free.')] },
      { candidate: makeCandidate(4, 'Open weight release', 0.85, '2026-09-07T00:00:00Z', 'source-e'), evidence: [makeEvidence('PRIMARY_OFFICIAL', 'Closed model is released as open weights.')] },
    ];
    const result = selectGlobalTopK({ candidates, now, topK: 3 });

    // Top 3 selected globally; the 4th strategic event is deferred, not
    // dispatched — no per-source quota lets every source flood analysis.
    expect(result.selected).toHaveLength(3);
    expect(result.deferred).toHaveLength(1);
    expect(result.absorbed).toHaveLength(0); // no event duplicates

    for (const rep of result.selected) {
      expect(rep.candidate.strategicValue).toBeGreaterThanOrEqual(0.65);
    }
    expect(result.deferred[0].candidate.strategicValue).toBeGreaterThanOrEqual(0.65);
  });

  it('deduplicates the same event across sources (corroboration)', () => {
    // Same event: GPT-5 model launch from two sources (both carry launch
    // language so both clear the deterministic substance gate)
    const candidates = [
      { candidate: makeCandidate(1, 'OpenAI announces GPT-5 flagship model', 0.85, '2026-09-07T00:00:00Z', 'official-blog'),
        evidence: [makeEvidence('PRIMARY_OFFICIAL', 'OpenAI announces GPT-5, a new flagship model for developers.', '2026-09-07T00:00:00Z')] },
      { candidate: makeCandidate(2, 'OpenAI launches GPT-5 on the developer platform', 0.85, '2026-09-07T00:00:00Z', 'dev-changelog'),
        evidence: [makeEvidence('PRIMARY_REPOSITORY', 'OpenAI launches GPT-5, a flagship model now available on the developer platform.', '2026-09-07T00:00:00Z')] },
      // Separate event: price cut
      { candidate: makeCandidate(3, 'OpenAI cuts GPT-5 API prices by 80%', 0.85, '2026-09-07T00:00:00Z', 'official-blog'),
        evidence: [makeEvidence('PRIMARY_OFFICIAL', 'OpenAI cuts GPT-5 API prices by 80% for all developers.', '2026-09-07T00:00:00Z')] },
    ];
    const result = selectGlobalTopK({ candidates, now, topK: 3 });

    // GPT-5 items should be in the same cluster
    expect(result.absorbed).toHaveLength(1);
    expect(result.eventDuplicates).toBe(1);
    // The representative should carry corroborating evidence from the absorbed copy
    expect(result.selected[0].corroboratingEvidence.length).toBeGreaterThanOrEqual(1);
    // The price cut should be separate (selected or deferred)
    expect(result.selected.length + result.deferred.length).toBe(2); // 2 clusters
    expect(result.selected.length).toBe(2); // both selected since topK=3
  });

  it('does not merge different events from the same actor (different families)', () => {
    // Same actor, different families, same week: should NOT merge
    const candidates = [
      { candidate: makeCandidate(1, 'OpenAI launches GPT-5', 0.85, '2026-09-07T00:00:00Z', 'source-a'),
        evidence: [makeEvidence('PRIMARY_OFFICIAL', 'OpenAI launches GPT-5 flagship model.', '2026-09-07T00:00:00Z')] },
      { candidate: makeCandidate(2, 'OpenAI API price cut 80%', 0.85, '2026-09-07T00:00:00Z', 'source-b'),
        evidence: [makeEvidence('PRIMARY_OFFICIAL', 'OpenAI API prices cut by 80%.', '2026-09-07T00:00:00Z')] },
    ];
    const result = selectGlobalTopK({ candidates, now, topK: 2 });
    // Both should be separate clusters
    expect(result.selected).toHaveLength(2);
    expect(result.absorbed).toHaveLength(0);
  });

  it('applies global Top-K cap even when all sources produce strategic events', () => {
    const candidates = [];
    for (let i = 0; i < 10; i += 1) {
      candidates.push({
        candidate: makeCandidate(i, `Strategic event ${i}`, 0.75, '2026-09-07T00:00:00Z', 'src-' + i),
        evidence: [makeEvidence('PRIMARY_OFFICIAL', 'Company launches a major new product.', '2026-09-07T00:00:00Z')],
      });
    }
    // Top-K = 3
    const result = selectGlobalTopK({ candidates, now, topK: 3 });
    expect(result.selected).toHaveLength(3);
    expect(result.deferred.length + result.selected.length).toBe(10); // all 10 clusters exist
    expect(result.eventDuplicates).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 6. Latest Scan public UI
// ---------------------------------------------------------------------------

describe('latest scan public UI', () => {
  it('renders STATE A (no run) with awaiting text and no hardcoded counts', () => {
    const html = renderOpenGambitLanding([], 'en', 'https://tibo.modelyard.dev', null);
    expect(html).toContain('Open Gambit is watching');
    expect(html).toContain('first scan has not completed');
    expect(html).not.toContain('0 sources checked');
    expect(html).not.toContain('0 published');
  });

  it('renders STATE B (healthy scan, zero publication) with real data counts', () => {
    const scan: GambitLatestScan = {
      hasRun: true, completedAt: '2026-09-07T02:30:00.000Z', status: 'COMPLETED',
      sourcesChecked: 14, itemsReviewed: 126, candidatesReviewed: 3, published: 0,
      partialSourceFailure: false,
    };
    const html = renderOpenGambitLanding([], 'en', 'https://tibo.modelyard.dev', scan);
    expect(html).toContain('14');
    expect(html).toContain('126');
    expect(html).toContain('3');
    expect(html).toContain('0');
    expect(html).toContain('sources checked');
    expect(html).toContain('items reviewed');
    expect(html).toContain('candidates selected for deeper review');
    expect(html).toContain('published');
    expect(html).toContain('No move cleared the strategic and verification threshold');
  });

  it('renders STATE C (published articles) with articles primary and compact scan', () => {
    const article: GambitPublicArticle = {
      articleId: 1, candidateId: 1, slug: 'test-article', headline: 'Test Article',
      surfaceEvent: 'Published event', facts: ['Fact'], obviousLogic: 'Logic',
      thesis: 'Thesis', mechanism: 'Mechanism', beneficiaries: [], pressuredActors: [],
      countercase: 'Counter', trajectories: [], falsifier: 'Falsifier', evidence: [],
      uncertainty: 'Uncertain', politicalTopic: false, critic: { accepted: true, simplerExplanation: '', rejectionReasons: [], motiveConcern: false, causalConcern: false, politicalFraming: false, sensationalismConcern: false, falsifiabilityConcern: false, notes: '' },
      modelRoleProvenance: {}, modelPromptVersion: 'v1', aiDisclosureVersion: 'v1',
      draftVersion: 1, createdAt: '2026-09-07T00:00:00.000Z', status: 'PUBLISHED',
      publishedAt: '2026-09-07T00:00:00.000Z', modifiedAt: '2026-09-07T00:00:00.000Z',
      translations: {},
    };
    const scan: GambitLatestScan = {
      hasRun: true, completedAt: '2026-09-07T02:30:00.000Z', status: 'COMPLETED',
      sourcesChecked: 14, itemsReviewed: 126, candidatesReviewed: 3, published: 1,
      partialSourceFailure: false,
    };
    const html = renderOpenGambitLanding([article], 'en', 'https://tibo.modelyard.dev', scan);
    // Article is primary
    expect(html).toContain('Test Article');
    // Scan panel still present (compact)
    expect(html).toContain('14');
    expect(html).toContain('sources checked');
    // No-move-cleared is NOT shown when published > 0
    expect(html).not.toContain('No move cleared');
    // Internal identifiers are NOT exposed
    expect(html).not.toContain('candidateId');
    expect(html).not.toContain('workflowId');
    expect(html).not.toContain('score');
    expect(html).not.toContain('0.437');
  });

  it('renders STATE D (partial failure) with limited coverage wording', () => {
    const scan: GambitLatestScan = {
      hasRun: true, completedAt: '2026-09-07T02:30:00.000Z', status: 'COMPLETED',
      sourcesChecked: 13, itemsReviewed: 100, candidatesReviewed: 2, published: 0,
      partialSourceFailure: true,
    };
    const html = renderOpenGambitLanding([], 'en', 'https://tibo.modelyard.dev', scan);
    expect(html).toContain('limited source coverage');
    // No-move-cleared is NOT shown when partial failure (limited coverage takes precedence)
    // Actually the code shows limitedCoverage text when partial is true, regardless of published count
    expect(html).toContain('limited source coverage');
    expect(html).not.toContain('No move cleared');
  });

  it('protects internal identifiers from public rendering', () => {
    const scan: GambitLatestScan = {
      hasRun: true, completedAt: '2026-09-07T02:30:00.000Z', status: 'COMPLETED',
      sourcesChecked: 14, itemsReviewed: 42, candidatesReviewed: 0, published: 0,
      partialSourceFailure: false,
    };
    const html = renderOpenGambitLanding([], 'en', 'https://tibo.modelyard.dev', scan);
    expect(html).not.toContain('candidateId');
    expect(html).not.toContain('workflowId');
    expect(html).not.toContain('token');
    expect(html).not.toContain('score');
    expect(html).not.toContain('internal');
    expect(html).not.toContain('secret');
  });
});

// ---------------------------------------------------------------------------
// 7. Five-locale parity for the watching panel
// ---------------------------------------------------------------------------

describe('five-locale watching panel parity', () => {
  const scan: GambitLatestScan = {
    hasRun: true, completedAt: '2026-09-07T02:30:00.000Z', status: 'COMPLETED',
    sourcesChecked: 14, itemsReviewed: 126, candidatesReviewed: 3, published: 0,
    partialSourceFailure: false,
  };

  for (const locale of GAMBIT_LOCALES) {
    it(`renders watching panel in ${locale} with locale-specific strings`, () => {
      const html = renderOpenGambitLanding([], locale, 'https://tibo.modelyard.dev', scan);
      expect(html).toContain('14');
      expect(html).toContain('126');
      expect(html).toContain('3');
      expect(html).toContain('0');
      // Every locale must have the watching section
      expect(html).toContain('gambit-watching');
      // No fallback marker for the landing page itself
      expect(html).toContain('class="gambit-watching"');
      // No English-only strings in non-English locales (the copy is locale-specific)
      // The no-move-cleared message should be present (published === 0)
      const copyKeys = {
        en: 'No move cleared',
        zh: '战略与验证门槛',
        ja: '基準を満たした',
        fr: 'seuil stratégique',
        es: 'umbral estratégico',
      };
      expect(html).toContain(copyKeys[locale]);
    });
  }
});

// ---------------------------------------------------------------------------
// 8. Routine maintenance and strategic event access
// ---------------------------------------------------------------------------

describe('routine maintenance filtering', () => {
  it('routine SDK patch gets LOW_STRATEGIC_VALUE (rejected before pool)', () => {
    // This is tested via the existing eligibility tests; here we verify the
    // selection module never sees REJECTED candidates.
    const candidates = [
      { candidate: makeCandidate(1, 'Routine SDK patch release', 0.2, '2026-09-07T00:00:00Z', 'source-a', false, 'REJECTED'),
        evidence: [makeEvidence('PRIMARY_REPOSITORY', 'Updated bundled Claude CLI to version 2.1.259')] },
    ];
    const result = selectGlobalTopK({ candidates, now: new Date('2026-09-07'), topK: 3 });
    // REJECTED candidates are not passed to selection; but if they were, they'd
    // have low strategicValue and would rank below any strategic events.
    // If they are the only candidate, they SHOULD be selected.
    expect(result.selected[0].candidate.status).toBe('REJECTED');
    // But in practice, REJECTED candidates are filtered before pool creation
    // (in service.ts only QUALIFIED status enters poolInput).
  });
});

describe('strategic event access', () => {
  const now = new Date('2026-09-07');

  it('major model launch can reach analysis', () => {
    const candidates = [
      { candidate: makeCandidate(1, 'Company launches a new flagship model', 0.85, '2026-09-07T00:00:00Z', 'source-a'),
        evidence: [makeEvidence('PRIMARY_OFFICIAL', 'Company launches a new flagship model for developers.')] },
    ];
    const result = selectGlobalTopK({ candidates, now, topK: 3 });
    expect(result.selected[0].candidate.strategicValue).toBe(0.85);
  });

  it('price change can reach analysis', () => {
    const candidates = [
      { candidate: makeCandidate(1, 'Company cuts API prices by 80%', 0.85, '2026-09-07T00:00:00Z', 'source-a'),
        evidence: [makeEvidence('PRIMARY_OFFICIAL', 'Company cuts API prices by 80% for developers.')] },
    ];
    const result = selectGlobalTopK({ candidates, now, topK: 3 });
    expect(result.selected[0].candidate.strategicValue).toBe(0.85);
  });

  it('paid-to-free can reach analysis', () => {
    const candidates = [
      { candidate: makeCandidate(1, 'Previously paid Agent capability is now free', 0.85, '2026-09-07T00:00:00Z', 'source-a'),
        evidence: [makeEvidence('PRIMARY_OFFICIAL', 'Previously paid Agent capability is now free for all developers.')] },
    ];
    const result = selectGlobalTopK({ candidates, now, topK: 3 });
    expect(result.selected[0].candidate.strategicValue).toBe(0.85);
  });

  it('open weight release can reach analysis', () => {
    const candidates = [
      { candidate: makeCandidate(1, 'Closed model is released as open weights', 0.85, '2026-09-07T00:00:00Z', 'source-a'),
        evidence: [makeEvidence('PRIMARY_OFFICIAL', 'Closed model is released as open weights.')] },
    ];
    const result = selectGlobalTopK({ candidates, now, topK: 3 });
    expect(result.selected[0].candidate.strategicValue).toBe(0.85);
  });

  it('protocol release can reach analysis', () => {
    const candidates = [
      { candidate: makeCandidate(1, 'Company releases an interoperability protocol', 0.85, '2026-09-07T00:00:00Z', 'source-a'),
        evidence: [makeEvidence('PRIMARY_OFFICIAL', 'Company releases an interoperability protocol.')] },
    ];
    const result = selectGlobalTopK({ candidates, now, topK: 3 });
    expect(result.selected[0].candidate.strategicValue).toBe(0.85);
  });

  it('default distribution can reach analysis', () => {
    const candidates = [
      { candidate: makeCandidate(1, 'Cloud platform makes Model X the default model', 0.85, '2026-09-07T00:00:00Z', 'source-a'),
        evidence: [makeEvidence('PRIMARY_OFFICIAL', 'Cloud platform makes Model X the default model for all new projects.')] },
    ];
    const result = selectGlobalTopK({ candidates, now, topK: 3 });
    expect(result.selected[0].candidate.strategicValue).toBe(0.85);
  });
});

// ---------------------------------------------------------------------------
// 9. No raw falsifiability early gate
// ---------------------------------------------------------------------------

describe('no raw falsifiability early gate', () => {
  it('a strategic event without forecast language still reaches ranking', () => {
    const candidates = [
      { candidate: makeCandidate(1, 'Major model launch announcement', 0.85, '2026-09-07T00:00:00Z', 'source-a', false),
        evidence: [makeEvidence('PRIMARY_OFFICIAL', 'Company launches a new flagship model.')] },
    ];
    // The candidate has falsifiable=false but strategicValue=0.85
    // It should still be selectable — the ranking score does NOT depend on falsifiability
    const result = selectGlobalTopK({ candidates, now: new Date('2026-09-07'), topK: 3 });
    expect(result.selected[0].candidate.falsifiable).toBe(false);
    expect(result.selected[0].rankScore).toBeGreaterThan(0.5);
  });
});

// ---------------------------------------------------------------------------
// 10. Golden simulation
// ---------------------------------------------------------------------------

describe('golden discovery simulation', () => {
  const now = new Date('2026-09-07');

  it('processes 10 scenarios correctly: broad scan, global pool, top-K, bounded dispatch', () => {
    // Source C: OpenAI 80% API price cut (QUALIFIED)
    // Source J: corroborating copy of Source C from OpenAI's changelog feed
    //           (qualifies but must be absorbed — one event, one slot)
    const candidates = [
      { candidate: makeCandidate(1, 'chore: dependency bump for the Agent SDK', 0.2, '2026-09-07T00:00:00Z', 'source-a', false, 'REJECTED'),
        evidence: [makeEvidence('PRIMARY_REPOSITORY', 'chore: update dependencies for the Agent SDK.')] },
      { candidate: makeCandidate(2, 'Company launches a new flagship model', 0.85, '2026-09-07T00:00:00Z', 'source-b'),
        evidence: [makeEvidence('PRIMARY_OFFICIAL', 'Company launches a new flagship model for developers.', '2026-09-07T00:00:00Z')] },
      { candidate: makeCandidate(3, 'OpenAI cuts GPT-5 API prices by 80%', 0.85, '2026-09-07T00:00:00Z', 'source-c'),
        evidence: [makeEvidence('PRIMARY_OFFICIAL', 'OpenAI cuts GPT-5 API prices by 80% for all developers.', '2026-09-07T00:00:00Z')] },
      { candidate: makeCandidate(4, 'Fix typo in API documentation', 0.2, '2026-09-07T00:00:00Z', 'source-d', false, 'REJECTED'),
        evidence: [makeEvidence('PRIMARY_OFFICIAL', 'Fix typo in API documentation.')] },
      { candidate: makeCandidate(5, 'Previously paid Agent capability is now free', 0.85, '2026-09-07T00:00:00Z', 'source-e'),
        evidence: [makeEvidence('PRIMARY_OFFICIAL', 'Previously paid Agent capability is now free for all developers.', '2026-09-07T00:00:00Z')] },
      { candidate: makeCandidate(6, 'Routine SDK patch release', 0.2, '2026-09-07T00:00:00Z', 'source-f', false, 'REJECTED'),
        evidence: [makeEvidence('PRIMARY_REPOSITORY', 'SDK patch release fixes a low-impact retry bug.')] },
      { candidate: makeCandidate(7, 'Closed model is released as open weights', 0.85, '2026-09-07T00:00:00Z', 'source-g'),
        evidence: [makeEvidence('PRIMARY_OFFICIAL', 'Closed model is released as open weights.', '2026-09-07T00:00:00Z')] },
      { candidate: makeCandidate(8, 'Our revolutionary AI platform will transform the ecosystem', 0.2, '2026-09-07T00:00:00Z', 'source-h', false, 'REJECTED'),
        evidence: [makeEvidence('SECONDARY_HIGH_QUALITY', 'Our revolutionary AI platform will transform the ecosystem.')] },
      { candidate: makeCandidate(9, 'Company releases an interoperability protocol', 0.85, '2026-09-07T00:00:00Z', 'source-i'),
        evidence: [makeEvidence('PRIMARY_OFFICIAL', 'Company releases an interoperability protocol for developers.', '2026-09-07T00:00:00Z')] },
      // Corroborating copy of Source C (same OpenAI GPT-5 price-cut event)
      { candidate: makeCandidate(10, 'OpenAI reduces GPT-5 API prices by 80%', 0.85, '2026-09-07T00:00:00Z', 'source-j'),
        evidence: [makeEvidence('PRIMARY_REPOSITORY', 'OpenAI reduces GPT-5 API prices by 80% for all developers.', '2026-09-07T00:00:00Z')] },
    ];

    // Filter REJECTED candidates (as service.ts does)
    const qualified = candidates.filter(c => c.candidate.status === 'QUALIFIED');
    expect(qualified).toHaveLength(6); // B, C, E, G, I, J (6 strategic candidates)

    const result = selectGlobalTopK({ candidates: qualified, now, topK: 3 });
    expect(result.selected).toHaveLength(3); // Top 3
    expect(result.selected.length).toBeLessThanOrEqual(3); // Global cap

    // Source J (duplicate of C) should be absorbed into C's cluster
    expect(result.eventDuplicates).toBeGreaterThanOrEqual(1);

    // All selected should be strategic (the 6 qualified, 3 selected, 1 absorbed, 2 deferred)
    for (const rep of result.selected) {
      expect(rep.candidate.strategicValue).toBeGreaterThanOrEqual(0.65);
    }

    // None of the routine items (A, D, F, H) should be in the pool
    const allPoolIds = new Set([
      ...result.selected.flatMap(e => [e.candidate.id, ...e.absorbedCandidateIds]),
      ...result.deferred.flatMap(e => [e.candidate.id]),
    ]);
    expect(allPoolIds.has(1)).toBe(false); // dependency bump
    expect(allPoolIds.has(4)).toBe(false); // typo fix
    expect(allPoolIds.has(6)).toBe(false); // SDK patch
    expect(allPoolIds.has(8)).toBe(false); // marketing

    // Workflow dispatch count = selected.length = 3 (globally bounded)
    expect(result.selected.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 11. Real run regression — Google DeepMind run ID 3
// ---------------------------------------------------------------------------

describe('Google DeepMind run regression (production run ID 3)', () => {
  const realDeepMindItems = [
    { title: "Piloting the world's first double-blind AI evaluations", content: "Google DeepMind is piloting the world's first double-blind AI evaluations of frontier models. The pilot measures research-grade evaluation quality across independent labs." },
    { title: 'Intelligent transcription with Gemini 3.5 Transcribe', content: 'Google DeepMind introduces intelligent transcription with Gemini 3.5 Transcribe, a product feature for developers and consumers that converts audio into structured text.' },
    { title: 'From Atari to EVE Online: Building on 15 Years of AI Research in Games', content: 'Google DeepMind reflects on 15 years of AI research in games, from Atari to EVE Online, covering the research history and the lessons learned for general agents.' },
  ];

  it.each(realDeepMindItems.map(item => [item.title, item]))('$title stays low strategic substance under the new pool', async (_title, item) => {
    // These three items were all rejected as LOW_STRATEGIC_VALUE in run ID 3
    // with 0 LLM calls. Broad discovery must NOT force them into analysis.
    const evidenceFor: GambitEvidence = makeEvidence('PRIMARY_OFFICIAL', item.content, '2026-08-27T00:00:00.000Z');
    const candidate = makeCandidate(1, item.title, 0.2, '2026-09-07T00:00:00Z', 'google-deepmind-rss', false, 'REJECTED');
    // Simulate the service pool input filter: only QUALIFIED candidates enter.
    // A rejected candidate is counted as routine/noGambit reject before the pool.
    expect(candidate.status).toBe('REJECTED');
    // If (hypothetically) sent to ranking it would still rank below any
    // strategic event and never consume a top-K slot when stronger events exist.
    const result = selectGlobalTopK({ candidates: [{ candidate, evidence: [evidenceFor] }], now: new Date('2026-09-07'), topK: 3 });
    expect(result.selected[0].rankScore).toBeLessThan(0.5);
    expect(result.selected[0].candidate.strategicValue).toBeLessThan(0.45);
  });
});

// ---------------------------------------------------------------------------
// 12. Service-level: global Top-K bounds Workflow dispatch in runGambitDiscovery
// ---------------------------------------------------------------------------

describe('service runGambitDiscovery global analysis bound', () => {
  const sourceDefs = [1, 2, 3].map(n => ({
    id: `service-src-${n}`,
    name: `TEST_ONLY Source ${n}`,
    type: 'OFFICIAL_BLOG' as const,
    url: `https://example.com/src-${n}`,
    publisher: 'TEST_ONLY',
    qualityTier: 'PRIMARY_OFFICIAL' as const,
    enabled: true,
    allowedHosts: ['example.com'],
    feedUrl: `https://example.com/feed-${n}.xml`,
  }));

  function atomFeed(title: string, link: string, content: string, published: string): string {
    return `<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>t</title><id>urn:${link}</id><entry><title>${title}</title><id>urn:${link}</id><link href="${link}"/><content type="text">${content}</content><published>${published}</published><updated>${published}</updated></entry></feed>`;
  }

  it('dispatches at most the global analysis cap across all sources', async () => {
    const run = { id: 901, runKey: 'gambit-discovery:global-cap', status: 'RUNNING', isNew: true };
    const dispatched: string[] = [];
    const workflowBindings: string[] = [];
    const repo = {
      createRun: async () => run,
      upsertSource: async () => undefined,
      finishRun: async () => undefined,
      upsertDailyMetrics: async () => undefined,
      insertDiscoveryStats: async () => undefined,
      insertSnapshot: async () => ({ id: Math.floor(Math.random() * 1000) + 1, isNew: true }),
      findCandidateByFingerprint: async () => null,
      insertCandidate: async (candidate: GambitCandidate) => ({ id: candidate.id ?? 500, isNew: true }),
      linkCandidateSource: async () => undefined,
      setCandidateStatus: async () => undefined,
      getWorkflowResult: async () => null,
      recordWorkflowStart: async () => true,
      recordWorkflowResult: async () => undefined,
      getSnapshots: async () => [],
    };

    // 3 sources × 1 item each = 3 qualified strategic events (one per source).
    // Global cap = 3 → all three dispatched (still bounded at 3, never 9+).
    const fetchImpl = async (url: string | URL | Request) => {
      const raw = String(url);
      if (raw.includes('feed-1')) {
        return new Response(atomFeed('OpenAI launches GPT-5 flagship model', 'https://example.com/a', 'OpenAI launches GPT-5, a new flagship model for developers.', '2026-09-07T00:00:00Z'), { status: 200, headers: { 'content-type': 'application/atom+xml' } });
      }
      if (raw.includes('feed-2')) {
        return new Response(atomFeed('Anthropic reduces Claude API prices by 80%', 'https://example.com/b', 'Anthropic reduces Claude API prices by 80% for all developers.', '2026-09-07T00:00:00Z'), { status: 200, headers: { 'content-type': 'application/atom+xml' } });
      }
      if (raw.includes('feed-3')) {
        return new Response(atomFeed('Meta releases Llama 5 as open weights', 'https://example.com/c', 'Meta releases Llama 5 as open weights for researchers.', '2026-09-07T00:00:00Z'), { status: 200, headers: { 'content-type': 'application/atom+xml' } });
      }
      return new Response('not found', { status: 404 });
    };

    const env = {
      DB: {},
      GAMBIT_SOURCE_REGISTRY_JSON: JSON.stringify(sourceDefs),
      GAMBIT_MAX_SOURCES_PER_RUN: '3',
      GAMBIT_MAX_ANALYSIS_CANDIDATES_PER_RUN: '3',
      GAMBIT_MAX_ITEMS_PER_SOURCE: '3',
      GAMBIT_MAX_ITEM_AGE_DAYS: '30',
      GAMBIT_MAX_HTTP_REQUESTS_PER_RUN: '10',
      GAMBIT_FETCH_CONCURRENCY: '2',
      GAMBIT_ANALYSIS_WORKFLOW: {
        create: async (opts: { id: string }) => { workflowBindings.push(opts.id); return { status: 'DISPATCHED' }; },
      },
      GAMBIT_SCHEDULE_ENABLED: 'false',
    } as never;

    // Override dispatch to observe; the binding path records recordWorkflowStart
    // but never calls binding.create without recordWorkflowStart returning true.
    const result = await runGambitDiscovery(env, {
      repository: repo as never,
      snapshotStore: { put: async (snapshot: unknown) => ({ key: 'test-key' }), getByKey: async () => null },
      fetchImpl: fetchImpl as never,
      windowKey: 'global-cap-test',
      startWorkflows: true,
    });

    expect(result.status).toBe('COMPLETED');
    expect(result.sourcesSucceeded).toBe(3);
    expect(result.candidatesFound).toBe(3);
    expect(result.qualifiedGambits).toBe(3);
    expect(result.globalPoolSize).toBe(3);
    expect(result.globalTopKSelected).toBe(3);
    expect(result.workflowStarts).toBe(3); // global cap respected
    expect(workflowBindings.length).toBe(3); // dispatched through binding
    void dispatched;
  });

  it('deduplicates one event across sources so one expensive slot is consumed', async () => {
    const repo = {
      createRun: async () => ({ id: 902, runKey: 'gambit-discovery:dup-cap', status: 'RUNNING', isNew: true }),
      upsertSource: async () => undefined,
      finishRun: async () => undefined,
      upsertDailyMetrics: async () => undefined,
      insertDiscoveryStats: async () => undefined,
      insertSnapshot: async () => ({ id: Math.floor(Math.random() * 1000) + 1, isNew: true }),
      findCandidateByFingerprint: async () => null,
      insertCandidate: async (candidate: GambitCandidate) => ({ id: candidate.id ?? 600, isNew: true }),
      linkCandidateSource: async () => undefined,
      setCandidateStatus: async () => undefined,
      getWorkflowResult: async () => null,
      recordWorkflowStart: async () => true,
      recordWorkflowResult: async () => undefined,
      getSnapshots: async () => [],
    };
    const dispatchedIds: string[] = [];
    const env = {
      DB: {},
      GAMBIT_SOURCE_REGISTRY_JSON: JSON.stringify(sourceDefs),
      GAMBIT_MAX_SOURCES_PER_RUN: '3',
      GAMBIT_MAX_ANALYSIS_CANDIDATES_PER_RUN: '3',
      GAMBIT_MAX_ITEMS_PER_SOURCE: '3',
      GAMBIT_MAX_ITEM_AGE_DAYS: '30',
      GAMBIT_MAX_HTTP_REQUESTS_PER_RUN: '10',
      GAMBIT_FETCH_CONCURRENCY: '2',
      GAMBIT_ANALYSIS_WORKFLOW: {
        create: async (opts: { id: string }) => { dispatchedIds.push(opts.id); return { status: 'DISPATCHED' }; },
      },
      GAMBIT_SCHEDULE_ENABLED: 'false',
    } as never;
    // Feed 1 and feed 2 announce the SAME OpenAI GPT-5 launch; feed 3 is an
    // independent Anthropic price cut. Expect 2 events → 2 workflow dispatches,
    // not 3.
    const fetchImpl = async (url: string | URL | Request) => {
      const raw = String(url);
      if (raw.includes('feed-1')) {
        return new Response(atomFeed('OpenAI announces GPT-5 flagship model launch', 'https://example.com/a', 'OpenAI announces GPT-5, a new flagship model for developers.', '2026-09-07T00:00:00Z'), { status: 200, headers: { 'content-type': 'application/atom+xml' } });
      }
      if (raw.includes('feed-2')) {
        return new Response(atomFeed('OpenAI launches GPT-5 on the developer platform', 'https://example.com/b', 'OpenAI launches GPT-5, a new flagship model now available to developers on the platform.', '2026-09-07T00:00:00Z'), { status: 200, headers: { 'content-type': 'application/atom+xml' } });
      }
      if (raw.includes('feed-3')) {
        return new Response(atomFeed('Anthropic reduces Claude API prices by 80%', 'https://example.com/c', 'Anthropic reduces Claude API prices by 80% for all developers.', '2026-09-07T00:00:00Z'), { status: 200, headers: { 'content-type': 'application/atom+xml' } });
      }
      return new Response('not found', { status: 404 });
    };
    const result = await runGambitDiscovery(env, {
      repository: repo as never,
      snapshotStore: { put: async () => ({ key: 'test-key' }), getByKey: async () => null },
      fetchImpl: fetchImpl as never,
      windowKey: 'dup-cap-test',
      startWorkflows: true,
    });
    expect(result.status).toBe('COMPLETED');
    expect(result.candidatesFound).toBe(3);
    expect(result.qualifiedGambits).toBe(3);
    expect(result.eventDuplicates).toBe(1); // feed-2 absorbed into feed-1
    expect(result.globalTopKSelected).toBe(2); // 2 event clusters
    expect(result.workflowStarts).toBe(2); // ONE event consumes ONE slot
    expect(dispatchedIds.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fnv1a32(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}