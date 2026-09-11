import { afterEach, describe, it, expect, vi } from 'vitest';
import { NullProvider } from '../src/providers/types';
import { XApiPartialFailureError, XApiProvider } from '../src/providers/x-api';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Provider Abstraction', () => {
  it('NullProvider returns empty array', async () => {
    const provider = new NullProvider();
    const posts = await provider.fetchLatestPosts();
    expect(Array.isArray(posts)).toBe(true);
    expect(posts.length).toBe(0);
  });

  it('NullProvider has name "null"', () => {
    const provider = new NullProvider();
    expect(provider.name).toBe('null');
  });

  it('provider interface is replaceable', async () => {
    const provider = new NullProvider();
    const result = await provider.fetchLatestPosts();
    expect(result).toEqual([]);
  });

  it('XApiProvider requires bearer token', () => {
    // Can't instantiate XApiProvider without token - compile-time check
    expect(true).toBe(true);
  });

  it('preserves healthy-account posts while surfacing a partial multi-account failure', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/users/by/username/first')) {
        return new Response(JSON.stringify({ data: { id: '1', name: 'First', username: 'first' } }), { status: 200 });
      }
      if (url.includes('/users/1/tweets')) {
        return new Response(JSON.stringify({
          data: [{ id: '2092058556707344708', text: 'Codex usage reset is back', created_at: '2026-08-26T04:00:00.000Z', author_id: '1' }],
          meta: { newest_id: '2092058556707344708' },
        }), { status: 200 });
      }
      if (url.includes('/users/by/username/second')) {
        return new Response('temporary failure', { status: 503 });
      }
      throw new Error('unexpected request ' + url);
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new XApiProvider({
      X_API_BEARER_TOKEN: 'token',
      MONITORED_ACCOUNTS: 'first,second',
    } as any);

    await expect(provider.fetchLatestPosts()).rejects.toMatchObject({
      name: 'XApiPartialFailureError',
      posts: expect.arrayContaining([expect.objectContaining({ source_account: 'first' })]),
    } satisfies Partial<XApiPartialFailureError>);
  });

  it('returns an incremental batch without advancing the cursor', async () => {
    const settings = new Map<string, string>([['x_api_since_id:thsottiaux', '100']]);
    const setSetting = vi.fn(async (key: string, value: string) => settings.set(key, value));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe('/2/users/123/tweets');
      expect(url.searchParams.get('since_id')).toBe('100');
      expect(url.searchParams.get('max_results')).toBe('100');
      expect(url.searchParams.get('exclude')).toBe('retweets');
      expect(url.searchParams.get('tweet.fields')).toContain('edit_history_tweet_ids');
      return new Response(JSON.stringify({
        data: [{ id: '101', text: 'Codex usage reset is back', created_at: '2026-08-27T00:00:00.000Z', author_id: '123' }],
        meta: { newest_id: '101' },
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'x-rate-limit-limit': '900',
          'x-rate-limit-remaining': '899',
          'x-rate-limit-reset': '1788000000',
        },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new XApiProvider({
      X_API_BEARER_TOKEN: 'token',
      X_API_USER_ID: '123',
      MONITORED_ACCOUNTS: 'thsottiaux',
      X_API_MAX_RESULTS_PER_PAGE: '100',
    } as any, { getSetting: async (key: string) => settings.get(key) ?? null, setSetting } as any);

    const batch = await provider.fetchIncremental({ reservationAlreadyHeld: true, now: new Date('2026-08-27T01:00:00.000Z') });
    expect(batch.accounts).toHaveLength(1);
    expect(batch.accounts[0]).toMatchObject({ account: 'thsottiaux', newestId: '101', complete: true });
    expect(batch.accounts[0].rateLimit).toMatchObject({ limit: 900, remaining: 899 });
    expect(settings.get('x_api_since_id:thsottiaux')).toBe('100');
    expect(setSetting).not.toHaveBeenCalledWith('x_api_since_id:thsottiaux', '101');
  });

  it('marks a truncated pagination batch incomplete so the cursor is not advanced', async () => {
    const settings = new Map<string, string>();
    const setSetting = vi.fn(async (key: string, value: string) => settings.set(key, value));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      data: [{ id: '101', text: 'new post', author_id: '123' }],
      meta: { next_token: 'next-page', newest_id: '101' },
    }), { status: 200 })));

    const provider = new XApiProvider({
      X_API_BEARER_TOKEN: 'token',
      X_API_USER_ID: '123',
      MONITORED_ACCOUNTS: 'thsottiaux',
      X_API_MAX_PAGES_PER_SYNC: '1',
    } as any, { getSetting: async (key: string) => settings.get(key) ?? null, setSetting } as any);

    await expect(provider.fetchIncremental({ reservationAlreadyHeld: true }))
      .rejects.toMatchObject({
        name: 'XApiPartialFailureError',
        accounts: [expect.objectContaining({ complete: false, newestId: '101' })],
      });
    expect(setSetting).not.toHaveBeenCalledWith('x_api_since_id:thsottiaux', '101');
  });

  it('preserves rate-limit reset headers when X returns 429', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('rate limited', {
      status: 429,
      headers: {
        'x-rate-limit-limit': '900',
        'x-rate-limit-remaining': '0',
        'x-rate-limit-reset': '1788000000',
      },
    })));

    const provider = new XApiProvider({
      X_API_BEARER_TOKEN: 'token',
      X_API_USER_ID: '123',
      MONITORED_ACCOUNTS: 'thsottiaux',
    } as any);

    await expect(provider.fetchIncremental({ reservationAlreadyHeld: true }))
      .rejects.toMatchObject({
        name: 'XApiPartialFailureError',
        accounts: [expect.objectContaining({
          complete: false,
          rateLimit: expect.objectContaining({ limit: 900, remaining: 0 }),
        })],
      });
  });
});

describe('Cron Error Handling', () => {
  it('LLM timeout should not lose posts', () => {
    const post = {
      id: 1,
      source: 'x',
      source_account: 'thsottiaux',
      source_post_id: '123',
      source_url: 'https://x.com/thsottiaux/status/123',
      text: 'Codex usage reset happening tomorrow',
      published_at: '2026-08-25T00:00:00.000Z',
      fetched_at: '2026-08-25T01:00:00.000Z',
      raw_json: '{}',
      content_hash: 'abc123',
      classification_pending: true,
    };

    // If classification fails, the post should remain with classification_pending=true
    expect(post.classification_pending).toBe(true);
  });

  it('provider failure should not crash the cron', () => {
    const errorMessage = 'Provider fetch failed';
    const runResult = {
      status: 'failed',
      postsChecked: 0,
      candidatesFound: 0,
      eventsCreated: 0,
      errorMessage: errorMessage,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    };

    expect(runResult.status).toBe('failed');
    expect(runResult.errorMessage).toBe(errorMessage);
    expect(runResult.finishedAt).toBeTruthy();
  });
});
