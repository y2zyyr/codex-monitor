import { describe, expect, it } from 'vitest';
import { evaluateCommunityEvidence, isPositiveResetEvidence } from '../src/confirmation';
import {
  extractCanonicalXPost,
  getXPostPublishedAt,
  getDiscoveryQueries,
  normalizeDiscoveryResult,
} from '../src/providers/search-provider';

describe('Hybrid indexed evidence', () => {
  it('rotates the compatibility discovery query list deterministically', () => {
    const queries = getDiscoveryQueries(['thsottiaux'], new Date('2026-08-26T01:00:00.000Z'), 2);
    expect(queries).toHaveLength(2);
    expect(queries.every(query => query.purpose === 'discovery')).toBe(true);
  });

  it('validates account and extracts a stable X canonical post id', () => {
    expect(extractCanonicalXPost('https://x.com/thsottiaux/status/123456789', 'thsottiaux')).toEqual({
      platform: 'x',
      postId: '123456789',
      canonicalUrl: 'https://x.com/thsottiaux/status/123456789',
    });
    expect(extractCanonicalXPost('https://x.com/other/status/123456789', 'thsottiaux')).toBeNull();
  });

  it('recovers indexed X publication time from the status ID', () => {
    const post = normalizeDiscoveryResult({
      title: 'Codex usage reset',
      snippet: 'Reset is planned for tomorrow',
      url: 'https://x.com/thsottiaux/status/2092058556707344708',
      indexedAt: '2026-08-26T01:00:00.000Z',
    }, 'thsottiaux', '2026-08-26T02:00:00.000Z');
    expect(post?.published_at).toBe('2026-08-25T01:16:43.144Z');
    expect(post?.source).toBe('web_search');
    expect(post?.source_quality).toBe('INDEXED');
    expect(post?.first_discovered_via).toBe('web_search');
    expect(post?.canonical_post_id).toBe('2092058556707344708');
  });

  it('rejects status IDs that do not decode to a plausible date', () => {
    expect(getXPostPublishedAt('not-a-status-id')).toBeNull();
  });
});

describe('Community confirmation evidence', () => {
  const after = '2026-08-26T04:00:00.000Z';

  it('does not treat negated reset statements as confirmation', () => {
    expect(isPositiveResetEvidence('Codex reset is not happening')).toBe(false);
    expect(isPositiveResetEvidence('Usage is still unavailable after the reset')).toBe(false);
    expect(isPositiveResetEvidence('Codex usage is available again after reset')).toBe(true);
  });

  it('requires three independent sources across two domains after reset', () => {
    const decision = evaluateCommunityEvidence([
      { title: 'Reset restored', snippet: 'Codex usage reset is back', url: 'https://reddit.com/r/a/1', domain: 'reddit.com', publishedAt: '2026-08-26T04:05:00.000Z' },
      { title: 'Quota reset', snippet: 'Quota reset and working again', url: 'https://news.example/2', domain: 'news.example', publishedAt: '2026-08-26T04:06:00.000Z' },
      { title: 'Usage restored', snippet: 'Usage is available again', url: 'https://x.com/user/status/3', domain: 'x.com', publishedAt: '2026-08-26T04:07:00.000Z' },
    ], after);
    expect(decision.qualified).toBe(true);
    expect(decision.independentSources).toBe(3);
    expect(decision.domains).toBe(3);
  });

  it('deduplicates URLs and rejects pre-reset or undated indexed evidence', () => {
    const decision = evaluateCommunityEvidence([
      { title: 'Reset restored', snippet: 'Reset is back', url: 'https://reddit.com/r/a/1', domain: 'reddit.com', publishedAt: '2026-08-26T03:59:00.000Z' },
      { title: 'Reset restored', snippet: 'Reset is back', url: 'https://reddit.com/r/a/1', domain: 'reddit.com', publishedAt: '2026-08-26T04:05:00.000Z' },
      { title: 'Maybe', snippet: 'Codex discussion', url: 'https://news.example/2', domain: 'news.example', publishedAt: null },
    ], after);
    expect(decision.qualified).toBe(false);
    expect(decision.independentSources).toBe(1);
  });

  it('does not count syndicated copies with tracking variants as independent evidence', () => {
    const decision = evaluateCommunityEvidence([
      { title: 'Reset restored', snippet: 'Codex usage reset is back', url: 'https://www.example.com/post/1?utm_source=a', domain: 'www.example.com', publishedAt: '2026-08-26T04:05:00.000Z' },
      { title: 'Reset restored', snippet: 'Codex usage reset is back', url: 'https://news.example/post/2#copied', domain: 'NEWS.EXAMPLE', publishedAt: '2026-08-26T04:06:00.000Z' },
      { title: 'Different report', snippet: 'Usage is available again after reset', url: 'https://reddit.com/r/a/3?fbclid=tracking', domain: 'www.reddit.com', publishedAt: '2026-08-26T04:07:00.000Z' },
    ], after);
    expect(decision.independentSources).toBe(2);
    expect(decision.domains).toBe(2);
    expect(decision.qualified).toBe(false);
  });
});
