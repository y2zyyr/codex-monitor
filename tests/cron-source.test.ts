import { describe, expect, it, vi } from 'vitest';
import { persistXAccountBatches } from '../src/cron';
import type { SourcePost } from '../src/types';

function post(id = '101', text = 'Codex usage reset is back'): SourcePost {
  return {
    source: 'x_api',
    source_account: 'thsottiaux',
    source_post_id: id,
    source_url: `https://x.com/thsottiaux/status/${id}`,
    text,
    published_at: '2026-08-27T00:00:00.000Z',
    fetched_at: '2026-08-27T00:01:00.000Z',
    raw_json: '{}',
    content_hash: id,
    classification_pending: true,
    canonical_platform: 'x',
    canonical_post_id: id,
    source_quality: 'DIRECT',
    first_discovered_via: 'x_api',
    last_verified_via: 'x_api',
    verified_at: '2026-08-27T00:01:00.000Z',
    verification_status: 'DIRECT_VERIFIED',
  };
}

const rateLimit = { limit: 900, remaining: 899, resetAt: '2026-08-27T01:00:00.000Z' };

describe('Direct X ingestion ordering', () => {
  it('writes every raw post before advancing that account cursor', async () => {
    const calls: string[] = [];
    const repo = {
      upsertSourcePost: vi.fn(async () => {
        calls.push('source_posts');
        return { id: 1, isNew: true, upgraded: false };
      }),
      advanceXApiCursor: vi.fn(async () => {
        calls.push('cursor');
        return true;
      }),
    };

    const result = await persistXAccountBatches(repo as any, [{
      account: 'thsottiaux',
      posts: [post()],
      newestId: '101',
      complete: true,
      rateLimit,
    }], new Date('2026-08-27T00:01:00.000Z'));

    expect(calls).toEqual(['source_posts', 'cursor']);
    expect(repo.advanceXApiCursor).toHaveBeenCalledWith('thsottiaux', '101');
    expect(result.errors).toEqual([]);
  });

  it('does not advance a cursor when a raw D1 write fails', async () => {
    const repo = {
      upsertSourcePost: vi.fn(async () => { throw new Error('D1 write failed'); }),
      advanceXApiCursor: vi.fn(),
    };

    const result = await persistXAccountBatches(repo as any, [{
      account: 'thsottiaux',
      posts: [post()],
      newestId: '101',
      complete: true,
      rateLimit,
    }], new Date('2026-08-27T00:01:00.000Z'));

    expect(repo.advanceXApiCursor).not.toHaveBeenCalled();
    expect(result.errors[0]).toContain('raw D1 ingestion failed');
  });

  it('keeps a newly persisted post without priority terms in the classifier candidates', async () => {
    const repo = {
      upsertSourcePost: vi.fn(async () => ({ id: 7, isNew: true, upgraded: false })),
      advanceXApiCursor: vi.fn(async () => true),
    };

    const result = await persistXAccountBatches(repo as any, [{
      account: 'thsottiaux',
      posts: [post('102', 'Could we make this better?')],
      newestId: '102',
      complete: true,
      rateLimit,
    }], new Date('2026-08-27T00:01:00.000Z'));

    expect(result.candidatesFound).toBe(1);
    expect(result.newCandidates).toHaveLength(1);
    expect(result.newCandidates[0].text).toBe('Could we make this better?');
  });

  it('isolates account cursors when one account batch is incomplete', async () => {
    const advanced: string[] = [];
    const repo = {
      upsertSourcePost: vi.fn(async () => ({ id: 1, isNew: false, upgraded: false })),
      advanceXApiCursor: vi.fn(async (account: string) => {
        advanced.push(account);
        return true;
      }),
    };

    await persistXAccountBatches(repo as any, [
      { account: 'first', posts: [post('201')], newestId: '201', complete: true, rateLimit },
      { account: 'second', posts: [post('301')], newestId: '301', complete: false, rateLimit },
    ], new Date('2026-08-27T00:01:00.000Z'));

    expect(advanced).toEqual(['first']);
  });
});
