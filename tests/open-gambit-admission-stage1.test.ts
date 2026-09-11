import { describe, expect, it } from 'vitest';
import stage1 from './fixtures/open-gambit/real-corpus-2026-09-11-stage1.json';
import { GAMBIT_ELIGIBILITY_RULES_VERSION, strategicSubstance } from '../src/open-gambit/eligibility';
import { qualificationGate } from '../src/open-gambit/policy';
import { isVersionNoiseItem } from '../src/open-gambit/sources';
import type { GambitEvidence, GambitSourceTier } from '../src/open-gambit/types';

/**
 * Open Gambit — T6 (Phase 1 admission repair) regression.
 *
 * Phase 0 established the defect precisely: the twelve strategic signals had
 * ZERO intersection with 98 real corpus entries, because matching was
 * per-CLAUSE (`split(/[\n;.!?]+/)`) while real announcement prose routinely puts
 * the event word and its strategic object in different sentences:
 *
 *   "You can now manage GitHub code scanning's AI Scan ... with REST API
 *    endpoints ... . This public preview gives teams a programmatic ..."
 *
 * Phase 1 keeps the 0.45 threshold, the publication gate and the no-canonical-
 * fallback rule untouched. It ONLY changes how the same evidence is matched, and
 * adds signals for wording that real first-party announcements actually use.
 * Zero publication remains a healthy result: 94 of 98 real entries still reject.
 */

const RULES_VERSION_AT_PHASE0 = 'gambit-eligibility-v1';

function evidence(quote: string, tier: GambitSourceTier = 'PRIMARY_OFFICIAL'): GambitEvidence {
  return {
    snapshotId: 0,
    sourceId: 'test-only-source',
    sourceTier: tier,
    canonicalUrl: 'https://test-only.example/a',
    title: 'TEST_ONLY',
    publisher: 'TEST ONLY',
    publishedAt: '2026-09-11T00:00:00.000Z',
    quote,
    role: 'FACT',
    contentHash: 'a'.repeat(64),
  };
}

function signalsFor(quote: string, tier: GambitSourceTier = 'PRIMARY_OFFICIAL'): string[] {
  return strategicSubstance([evidence(quote, tier)]).signalTypes;
}

function admits(quote: string, tier: GambitSourceTier = 'PRIMARY_OFFICIAL'): boolean {
  return qualificationGate({
    headline: 'TEST_ONLY',
    summary: 'TEST_ONLY',
    content: quote,
    evidence: [evidence(quote, tier)],
  }).qualified;
}

describe('Open Gambit admission: sliding-window granularity (T6.1)', () => {
  it('matches an event and its object split across two sentences', () => {
    // The real Phase 0 failure: "You can now" ends sentence one, and the
    // strategic object appears in sentence two.
    const quote = 'You can now manage code scanning enablement for a repository. This work is delivered through REST API endpoints at the organization level, which lets teams automate the whole flow.';
    const signals = signalsFor(quote);
    expect(signals).toContain('ANNOUNCED_CAPABILITY');
    expect(admits(quote)).toBe(true);
  });

  it('does not match when the two halves are separated beyond the window', () => {
    // Same two signals, pushed far apart by unrelated prose. A bounded window
    // must not join them.
    const filler = Array.from({ length: 12 }, (_, index) => `Unrelated paragraph ${index + 1} describes general product context without any strategic content and keeps running.`).join(' ');
    const quote = `You can now manage code scanning enablement for a repository. ${filler} This work is delivered through REST API endpoints at the organization level.`;
    expect(signalsFor(quote)).not.toContain('ANNOUNCED_CAPABILITY');
    expect(admits(quote)).toBe(false);
  });

  it('keeps a sliding window bounded so long release notes cannot pool unrelated facts', () => {
    const substance = strategicSubstance([evidence('A short clause about a release. A second clause about a helper method.')]);
    expect(substance.windowChars).toBeLessThanOrEqual(1_200);
  });

  it('still strips maintenance clauses before matching', () => {
    // A maintenance clause must not lend its significance to a neighbour.
    expect(signalsFor('This patch release bumps a dependency and updates bundled types.')).toEqual([]);
    expect(strategicSubstance([evidence('Fixed a typo in the documentation for the helper method.')]).detail).toBe('ROUTINE_MAINTENANCE');
  });

  it('ignores DISCOVERY_ONLY evidence and short quotes exactly as before', () => {
    expect(signalsFor('You can now use the REST API endpoints at organization level.', 'DISCOVERY_ONLY')).toEqual([]);
    // Under 20 characters, the same evidence rule as Phase 0.
    expect('The API is now'.length).toBeLessThan(20);
    expect(signalsFor('The API is now')).toEqual([]);
  });

  it('is versioned so a rules change can reopen already-rejected candidates', () => {
    expect(GAMBIT_ELIGIBILITY_RULES_VERSION).toBe('gambit-eligibility-v2');
    expect(GAMBIT_ELIGIBILITY_RULES_VERSION).not.toBe(RULES_VERSION_AT_PHASE0);
  });
});

describe('Open Gambit admission: precise availability signals (T6.2)', () => {
  it('admits "you can now" plus a strategic object', () => {
    expect(signalsFor('You can now manage the AI Scan setting with REST API endpoints.')).toContain('ANNOUNCED_CAPABILITY');
  });

  it('admits general availability plus a platform object', () => {
    expect(signalsFor('The assistant SDK is now generally available for enterprise integrations.')).toContain('GENERAL_AVAILABILITY');
  });

  it('admits a capability becoming available on a strategic object', () => {
    expect(signalsFor('Managed engine images are now available for Inference endpoints in every region.')).toContain('CAPABILITY_AVAILABILITY');
  });

  it('admits an availability expansion that names an access tier', () => {
    expect(signalsFor('Eligibility has expanded from enterprises to every organization with a paid plan.')).toContain('AVAILABILITY_EXPANSION');
    expect(signalsFor('Customers can now start a self-serve trial of the security platform.')).toContain('ACCESS_OPENING');
  });

  it('admits a platform migration only when a strategic object moved', () => {
    expect(signalsFor('The agent runtime now runs on the new inference platform.')).toContain('PLATFORM_MIGRATION');
  });

  it('does NOT admit a tooling detail that merely became available', () => {
    // The Phase 0 negative target, reduced to its essential sentence. No
    // API/SDK/platform/agent object, no event verb: this is a tooling detail.
    const quote = 'CodeQL 2.27.0 is now available on Linux ARM64, adds a new Rust security query, expanded framework coverage for Java/Kotlin and C#, and analysis accuracy improvements across multiple languages.';
    expect(signalsFor(quote)).toEqual([]);
    expect(admits(quote)).toBe(false);
  });

  it('does NOT admit a UI refresh described as being in public preview', () => {
    const quote = 'A refreshed repository-level pull request listing page is now in public preview for all GitHub users. It brings powerful filtering, compact presentation mode, and more.';
    expect(admits(quote)).toBe(false);
  });

  it('does NOT treat a release stage alone as an access tier', () => {
    // "available in public preview" is on nearly every changelog post. Treating
    // it as an access tier admitted "Xcode 27 runner image now runs on macOS 27".
    const quote = 'You can now validate your Apple apps against macOS 27 using the Xcode 27 runner image for GitHub-hosted macOS runners, available in public preview.';
    expect(signalsFor(quote)).not.toContain('ACCESS_OPENING');
    expect(admits(quote)).toBe(false);
  });

  it('does NOT admit a minor SDK helper announced through the CLI', () => {
    // Real corpus row that the first draft of this change wrongly admitted.
    const quote = 'Bucket visibility used to be a create-time-only setting. You can now update it with the new HfApi.update_bucket_settings() method (also exported as update_bucket_settings) or from the CLI with hf buckets settings.';
    expect(admits(quote)).toBe(false);
  });
});

describe('Open Gambit admission: broad signals need corroboration (T6.3)', () => {
  it('never admits on a broad signal alone', () => {
    // "released ... SDK": a broad signal with no other signal in its window.
    const quote = 'We released version 0.124.0 of the SDK with several internal changes and updated type definitions for the client.';
    const signals = signalsFor(quote);
    expect(signals).not.toContain('DEVELOPER_PLATFORM_CAPABILITY');
    expect(admits(quote)).toBe(false);
  });

  it('counts a broad signal when a precise signal corroborates it in the same window', () => {
    const quote = 'The platform is now generally available for enterprise developers, and the release adds a documented SDK integration path.';
    const signals = signalsFor(quote);
    expect(signals).toContain('GENERAL_AVAILABILITY');
    expect(signals).toContain('DEVELOPER_PLATFORM_CAPABILITY');
  });

  it('never admits on a rate-limit or quota change alone', () => {
    const quote = 'We increased the usage limit for the tool and raised the quota per account this quarter.';
    const signals = signalsFor(quote);
    expect(signals).not.toContain('ACCESS_TIER_CHANGE');
    expect(admits(quote)).toBe(false);
  });

  it('scores a corroborated pair above a single precise signal', () => {
    const single = strategicSubstance([evidence('The assistant SDK is now generally available for enterprise integrations.')]);
    const pair = strategicSubstance([evidence('The platform is now generally available for enterprise developers, and the release adds a documented SDK integration path.')]);
    expect(pair.signalTypes.length).toBeGreaterThan(single.signalTypes.length);
    expect(pair.score).toBeGreaterThan(single.score);
    expect(pair.score).toBeLessThanOrEqual(0.85);
  });

  it('refuses everything at once for a routine patch note', () => {
    const quote = 'This patch release fixes a typo in the documentation, bumps three dependencies, and updates bundled type definitions for the SDK client.';
    expect(admits(quote)).toBe(false);
  });
});

describe('Open Gambit admission: version-noise pre-filter (T6.4)', () => {
  it('drops pre-release titles regardless of body length', () => {
    const longBody = 'x'.repeat(900);
    for (const title of [
      'Release v0.61.0-nightly.20260911.ged2ac40df',
      'miniflare@5.20260910.0-alpha',
      'rust-v0.155.0-alpha.3.8',
      'v1.31.0.rc1',
      'v1.30.0.rc0',
      'nvidia v2.19.0-beta',
      '2.19-stage',
      '2.19-cudnn926-check-stage',
    ]) {
      expect(isVersionNoiseItem(title, longBody), title).toBe(true);
    }
  });

  it('drops version-only titles whose body is too short to carry a strategic event', () => {
    for (const title of ['v1.5.0', 'wrangler@4.131.0', '@cloudflare/pages-shared@0.13.179', 'Release v0.59.0', 'v2.19', 'v3.1.2']) {
      expect(isVersionNoiseItem(title, 'chore: bump deps'), title).toBe(true);
      expect(isVersionNoiseItem(title, ''), title).toBe(true);
    }
  });

  it('keeps a version-only title whose body actually describes something', () => {
    // A release whose body genuinely describes a strategic event must stay
    // eligible: the filter is about version churn, not about version numbers.
    const body = 'You can now manage the platform through new REST API endpoints, and the assistant SDK is now generally available for every enterprise integration path. Teams can adopt it incrementally, and the migration guide documents each step for existing deployments.';
    expect(body.length).toBeGreaterThan(200);
    expect(isVersionNoiseItem('v2.0.0', body)).toBe(false);
    expect(isVersionNoiseItem('v2.0.0', 'chore: bump deps')).toBe(true);
  });

  it('keeps a version-PREFIXED title that carries its own prose', () => {
    // "[v1.31.0] Custom labels for Sandboxes" is a versioned release note with a
    // real subject line. Dropping it here would be over-reach: the deterministic
    // signals decide it, and it is rejected on its merits (see T6.5 below).
    expect(isVersionNoiseItem('[v1.31.0] Custom labels for Sandboxes', 'x'.repeat(900))).toBe(false);
    expect(isVersionNoiseItem('[v1.28.0] Hardware discovery and managed engine images for Inference Endpoints and more', 'x'.repeat(900))).toBe(false);
  });

  it('never treats an ordinary prose title as version noise', () => {
    for (const title of [
      'Refreshed repository pull requests page in public preview',
      'AI Scan for pull request APIs in public preview',
      'GitHub Advanced Security expands trial availability',
      'Intelligent transcription with Gemini 3.5 Transcribe',
      'MAI-Code-1-Flash deprecated',
      'Enterprise managed permissions for GitHub Copilot agent operations',
    ]) {
      expect(isVersionNoiseItem(title, ''), title).toBe(false);
    }
  });

  it('bounds the noise filter to titles, so body content can never trigger it', () => {
    // The filter must not inspect content: content is untrusted source text.
    expect(isVersionNoiseItem('Ordinarily titled announcement', 'this body mentions v1.2.3-rc1 somewhere')).toBe(false);
  });
});

describe('Open Gambit admission: Phase 1 real-corpus result (T6.5)', () => {
  const entries = stage1.entries as unknown as Array<{
    sourceId: string; title: string; quote: string; summary: string; url: string;
    publishedAt: string | null; sourceTier: GambitSourceTier; qualified: boolean; signalTypes: string[];
  }>;

  function decisionFor(entry: typeof entries[number]) {
    return qualificationGate({
      headline: entry.title,
      summary: entry.summary,
      content: entry.summary,
      evidence: [{
        ...evidence(entry.quote, entry.sourceTier),
        sourceId: entry.sourceId,
        canonicalUrl: entry.url,
        title: entry.title,
        publishedAt: entry.publishedAt,
      }],
    });
  }

  it('is the same 14-source corpus, re-evaluated under the Phase 1 rules', () => {
    expect(stage1.sourceCount).toBe(14);
    expect(stage1.registryErrors).toEqual([]);
    expect(entries).toHaveLength(98);
    expect(stage1.productionPass.sourcesSucceeded).toBe(14);
  });

  it('admits exactly four of 98 real entries', () => {
    const admitted = entries.filter(entry => decisionFor(entry).qualified).map(entry => entry.title).sort();
    expect(admitted).toEqual([
      'AI Scan for pull request APIs in public preview',
      'Enterprise managed permissions for GitHub Copilot agent operations',
      'GitHub Advanced Security expands trial availability',
      'MAI-Code-1-Flash deprecated',
    ]);
    // The target range in the task was 5-10; the corpus was measured to contain
    // four genuinely strategic items in its 30-day window. Precision was kept
    // instead of padding the count.
    expect(admitted.length).toBeGreaterThanOrEqual(4);
    expect(admitted.length).toBeLessThanOrEqual(10);
  });

  it('leaves 94 of 98 entries rejected: zero publication remains a healthy result', () => {
    expect(entries.filter(entry => decisionFor(entry).qualified === false)).toHaveLength(94);
  });

  it('never admits a version-noise title in the real corpus', () => {
    for (const entry of entries) {
      if (decisionFor(entry).qualified) {
        expect(isVersionNoiseItem(entry.title, entry.quote), entry.title).toBe(false);
      }
    }
  });

  it('would have dropped the substantial part of the corpus before any signal work', () => {
    const dropped = entries.filter(entry => isVersionNoiseItem(entry.title, entry.quote));
    // 52 of 98: nightly/alpha/rc/release-version churn cannot occupy a per-source
    // item slot or reach an LLM call.
    expect(dropped).toHaveLength(52);
    expect(dropped.filter(entry => decisionFor(entry).qualified)).toHaveLength(0);
  });

  it('confines admission to the announcement source', () => {
    const sources = [...new Set(entries.filter(entry => decisionFor(entry).qualified).map(entry => entry.sourceId))];
    expect(sources).toEqual(['github-changelog']);
  });

  it('keeps every strategic invariant of the admission decision', () => {
    for (const entry of entries) {
      const decision = decisionFor(entry);
      if (!decision.qualified) continue;
      // Admission is analysis access only. It must never carry publication
      // approval, and it must never soften the evidence or political rules.
      expect(decision.reason).toBeNull();
      expect(decision.strategicValue).toBeGreaterThanOrEqual(0.45);
      expect(decision.evidenceSufficient).toBe(true);
      expect(decision.politicalTopic).toBe(false);
    }
  });
});
