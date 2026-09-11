import { describe, expect, it } from 'vitest';
import { discoverConfiguredSources } from '../src/open-gambit/sources';
import { fetchEvidence } from '../src/open-gambit/evidence';
import { GambitRunBudget } from '../src/open-gambit/budget';
import type { GambitSourceDefinition } from '../src/open-gambit/types';

/**
 * Open Gambit — T3 regression: SOURCE_TOO_LARGE on healthy feeds (B4).
 *
 * Root cause, measured on `openai-codex-releases` / `rust-v0.154.0`: an atom
 * `<content>` element carries the fully rendered HTML of a release note, so a
 * 19,880-character release serialises to a 172,048-byte document (8.7x). One cap
 * (128,000 bytes) applied to both feeds and HTML pages, so the source was
 * classified SOURCE_TOO_LARGE and silently skipped.
 *
 * The fix separates the caps by the artifact actually fetched (a source with a
 * `feedUrl` fetches a feed document). The HTML cap is deliberately NOT raised.
 */

const PRODUCTION_HTML_CAP = 128_000;
const PRODUCTION_FEED_CAP = 512_000;
/** Exact byte size of the real rust-v0.154.0 atom document from production. */
const REAL_RELEASE_BYTES = 172_048;

/**
 * Reproduce the real document shape and size: one atom release entry whose
 * `<content type="html">` holds escaped, rendered HTML.
 */
function atomReleaseDocument(targetBytes: number, title = 'rust-v0.154.0', linkBase = 'https://github.com/openai/codex/releases/tag'): string {
  const prefix = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Release notes from codex</title>
  <updated>2026-09-10T00:00:00Z</updated>
  <entry>
    <id>tag:github.com,2008:Repository/123456789/${title}</id>
    <title>${title}</title>
    <link rel="alternate" type="text/html" href="${linkBase}/${title}"/>
    <updated>2026-09-10T00:00:00Z</updated>
    <content type="html">&lt;h2&gt;What's Changed&lt;/h2&gt;
&lt;ul&gt;
&lt;li&gt;Add support for the Codex API surface&lt;/li&gt;
`;
  const suffix = `&lt;/ul&gt;
</content>
  </entry>
</feed>`;
  const head = prefix;
  const encoder = new TextEncoder();
  const fixedBytes = encoder.encode(head + suffix).byteLength;
  if (fixedBytes > targetBytes) throw new Error('target too small for the fixture shape');
  const filler = '&lt;li&gt;Routine note line for the bounded feed fixture&lt;/li&gt;\n';
  const fillerBytes = encoder.encode(filler).byteLength;
  const repeats = Math.floor((targetBytes - fixedBytes) / fillerBytes);
  const padding = 'x'.repeat(targetBytes - fixedBytes - repeats * fillerBytes);
  return `${head}${filler.repeat(repeats)}${padding}${suffix}`;
}

function source(overrides: Partial<GambitSourceDefinition> & { id: string }): GambitSourceDefinition {
  return {
    name: 'TEST_ONLY Source',
    type: 'GITHUB_RELEASE',
    url: 'https://example.com/releases',
    publisher: 'TEST_ONLY',
    qualityTier: 'PRIMARY_REPOSITORY',
    enabled: true,
    allowedHosts: ['example.com'],
    ...overrides,
  };
}

function textResponse(body: string, contentType = 'application/atom+xml'): Response {
  return new Response(body, { status: 200, headers: { 'content-type': contentType } });
}

describe('Open Gambit feed byte cap (B4)', () => {
  it('reproduces the real 172,048-byte release document', () => {
    const document = atomReleaseDocument(REAL_RELEASE_BYTES);
    expect(new TextEncoder().encode(document).byteLength).toBe(REAL_RELEASE_BYTES);
  });

  it('no longer rejects that document as SOURCE_TOO_LARGE under the feed cap', async () => {
    const document = atomReleaseDocument(REAL_RELEASE_BYTES);
    const result = await fetchEvidence('https://example.com/releases.atom', source({ id: 'openai-codex-releases' }), {
      fetchImpl: async () => textResponse(document),
      maxBytes: PRODUCTION_FEED_CAP,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.isFeed).toBe(true);
    expect(result.feedItems.map(item => item.title)).toContain('rust-v0.154.0');
  });

  it('still rejects the same document under the strict HTML cap', async () => {
    const document = atomReleaseDocument(REAL_RELEASE_BYTES);
    const result = await fetchEvidence('https://example.com/releases.atom', source({ id: 'openai-codex-releases' }), {
      fetchImpl: async () => textResponse(document),
      maxBytes: PRODUCTION_HTML_CAP,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // This is exactly the production failure the fix removes; it is kept here so
    // the HTML cap can never silently absorb the feed cap.
    expect(result.status).toBe('SOURCE_TOO_LARGE');
  });

  it('still rejects a response above the feed cap', async () => {
    const document = atomReleaseDocument(PRODUCTION_FEED_CAP + 60_000, 'rust-v9.9.9');
    const result = await fetchEvidence('https://example.com/releases.atom', source({ id: 'oversize' }), {
      fetchImpl: async () => textResponse(document),
      maxBytes: PRODUCTION_FEED_CAP,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe('SOURCE_TOO_LARGE');
  });

  it('routes the feed cap to feed sources and the HTML cap to page sources in one run', async () => {
    const oversized = atomReleaseDocument(200_000, 'rust-v0.155.0', 'https://example.com/releases/tag');
    const feedSource = source({ id: 'feed-source', feedUrl: 'https://example.com/releases.atom' });
    const pageSource = source({ id: 'page-source', url: 'https://example.com/changelog' });

    const discovery = await discoverConfiguredSources([feedSource, pageSource], {
      fetchImpl: async () => textResponse(oversized),
      now: new Date('2026-09-11T00:00:00.000Z'),
      maxBytes: PRODUCTION_HTML_CAP,
      maxFeedBytes: PRODUCTION_FEED_CAP,
      budget: new GambitRunBudget({
        maxLlmCalls: 8,
        maxLlmTokens: 18_000,
        maxSearchRequests: 0,
        maxXRequests: 0,
        maxGithubRequests: 0,
        maxHttpRequests: 20,
      }),
    });

    expect(discovery.failures).toHaveLength(1);
    expect(discovery.failures[0]!.sourceId).toBe('page-source');
    expect(discovery.failures[0]!.status).toBe('SOURCE_TOO_LARGE');
    expect(discovery.sourcesSucceeded).toBe(1);
    expect(discovery.items.map(item => item.source.id)).toEqual(['feed-source']);
  });

  it('falls back to the HTML cap for feeds when no feed cap is configured', async () => {
    const oversized = atomReleaseDocument(200_000, 'rust-v0.156.0');
    const discovery = await discoverConfiguredSources([source({ id: 'feed-source', feedUrl: 'https://example.com/releases.atom' })], {
      fetchImpl: async () => textResponse(oversized),
      now: new Date('2026-09-11T00:00:00.000Z'),
      maxBytes: PRODUCTION_HTML_CAP,
    });

    // An unset GAMBIT_MAX_FEED_BYTES must fall back to the caller's page cap
    // rather than silently removing the bound entirely.
    expect(discovery.failures.map(failure => failure.status)).toEqual(['SOURCE_TOO_LARGE']);
  });
});
