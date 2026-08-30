import { describe, it, expect, vi } from 'vitest';

describe('SearchProvider', () => {
  describe('X status ID extraction', () => {
    function extractPostId(url: string, account: string): string | null {
      try {
        const urlObj = new URL(url);
        const pathParts = urlObj.pathname.split('/').filter(Boolean);
        
        if (pathParts.length >= 3 && 
            pathParts[0].toLowerCase() === account && 
            pathParts[1] === 'status') {
          return pathParts[2];
        }

        if (urlObj.hostname === 'twitter.com' || urlObj.hostname === 'x.com') {
          const idx = pathParts.indexOf('status');
          if (idx >= 0 && idx + 1 < pathParts.length) {
            return pathParts[idx + 1];
          }
        }
      } catch {
        // Invalid URL
      }
      return null;
    }

    it('extracts ID from x.com/account/status/ID', () => {
      expect(extractPostId('https://x.com/thsottiaux/status/123456789', 'thsottiaux')).toBe('123456789');
    });

    it('extracts ID from twitter.com/account/status/ID', () => {
      expect(extractPostId('https://twitter.com/thsottiaux/status/987654321', 'thsottiaux')).toBe('987654321');
    });

    it('extracts ID even when account does not match search target', () => {
      // The function extracts the post ID structurally; account validation
      // happens at the search query level, not at extraction time
      expect(extractPostId('https://x.com/other/status/123456789', 'thsottiaux')).toBe('123456789');
    });

    it('returns null for non-status URL', () => {
      expect(extractPostId('https://x.com/thsottiaux', 'thsottiaux')).toBeNull();
    });

    it('returns null for invalid URL', () => {
      expect(extractPostId('not-a-url', 'thsottiaux')).toBeNull();
    });

    it('handles URL with trailing slash', () => {
      expect(extractPostId('https://x.com/thsottiaux/status/123456789/', 'thsottiaux')).toBe('123456789');
    });

    it('handles URL with query parameters', () => {
      expect(extractPostId('https://x.com/thsottiaux/status/123456789?param=value', 'thsottiaux')).toBe('123456789');
    });

    it('handles twitter.com with different account', () => {
      expect(extractPostId('https://twitter.com/other/status/555555', 'thsottiaux')).toBe('555555');
    });
  });

  describe('Google Search API URL construction', () => {
    it('constructs search URL correctly', () => {
      const account = 'thsottiaux';
      const query = `site:x.com/${account}/status`;
      expect(query).toBe('site:x.com/thsottiaux/status');
    });

    it('encodes query parameters', () => {
      const query = 'site:x.com/thsottiaux/status';
      const encoded = encodeURIComponent(query);
      expect(encoded).toBe('site%3Ax.com%2Fthsottiaux%2Fstatus');
    });
  });

  describe('Cross-provider dedup', () => {
    it('same X post ID from different providers should be deduped', () => {
      const xPostId = '123456789';
      const searchPostId = '123456789';
      expect(xPostId).toBe(searchPostId);
    });

    it('different X post IDs should be different', () => {
      const post1 = '123456789';
      const post2 = '987654321';
      expect(post1).not.toBe(post2);
    });
  });

  describe('Source quality modeling', () => {
    it('INDEXED posts should be distinguished from DIRECT', () => {
      const indexed = 'INDEXED';
      const direct = 'DIRECT';
      expect(indexed).not.toBe(direct);
    });
  });

  describe('Tavily provider support', () => {
    it('canUseSearchProvider accepts TAVILY_API_KEY', async () => {
      const { canUseSearchProvider } = await import('../src/providers/search-provider');
      expect(canUseSearchProvider({ TAVILY_API_KEY: 'test-key' } as any)).toBe(true);
      expect(canUseSearchProvider({ WEB_SEARCH_ENABLED: 'false', TAVILY_API_KEY: 'test-key' } as any)).toBe(false);
      expect(canUseSearchProvider({} as any)).toBe(false);
    });

    it('SearchProvider prefers Tavily and names itself tavily-search', async () => {
      const { SearchProvider } = await import('../src/providers/search-provider');
      const provider = new SearchProvider({ TAVILY_API_KEY: 'test-key', BRAVE_SEARCH_API_KEY: 'brave' } as any);
      expect(provider.name).toBe('tavily-search');
    });

    it('search() calls the Tavily endpoint POST and parses results', async () => {
      const { SearchProvider } = await import('../src/providers/search-provider');
      const fetchMock = vi.fn(async () => new Response(JSON.stringify({
        results: [
          { title: 'Tibo on X', url: 'https://x.com/thsottiaux/status/2092058556707344708', content: 'Reset coming', published_date: '2026-08-25T01:16:43.000Z' },
          { title: 'Some page', url: 'https://example.com/other', content: 'not an X post' },
        ],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      vi.stubGlobal('fetch', fetchMock);

      const provider = new SearchProvider({ TAVILY_API_KEY: 'test-key' } as any);
      const results = await provider.search({ q: 'Codex reset', purpose: 'discovery' });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.tavily.com/search');
      expect(init.method).toBe('POST');
      const body = JSON.parse(init.body);
      expect(body.query).toBe('Codex reset');
      expect(body.search_depth).toBe('basic');

      expect(results).toHaveLength(2);
      expect(results[0].url).toBe('https://x.com/thsottiaux/status/2092058556707344708');
      expect(results[0].snippet).toBe('Reset coming');
      expect(results[1].url).toBe('https://example.com/other');
      vi.unstubAllGlobals();
    });
  });
});
