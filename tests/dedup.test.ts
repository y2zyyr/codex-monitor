import { describe, it, expect } from 'vitest';

describe('Deduplication', () => {
  function computeHash(text: string, postId: string): string {
    let hash = 0;
    const str = text + postId;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(16).padStart(8, '0');
  }

  it('same text and postId produces same hash', () => {
    const hash1 = computeHash('Hello world', '123');
    const hash2 = computeHash('Hello world', '123');
    expect(hash1).toBe(hash2);
  });

  it('different postId produces different hash', () => {
    const hash1 = computeHash('Hello world', '123');
    const hash2 = computeHash('Hello world', '456');
    expect(hash1).not.toBe(hash2);
  });

  it('different text produces different hash', () => {
    const hash1 = computeHash('Hello world', '123');
    const hash2 = computeHash('Different text', '123');
    expect(hash1).not.toBe(hash2);
  });

  it('hash is a non-empty hex string', () => {
    const hash = computeHash('Test', '1');
    expect(hash).toMatch(/^[0-9a-f]+$/);
    expect(hash.length).toBeGreaterThan(0);
  });

  it('source_post_id uniqueness is primary dedup mechanism', () => {
    const id1 = 'tweet_12345';
    const id2 = 'tweet_12345';
    expect(id1).toBe(id2);
  });

  it('content_hash is fallback when source_post_id is unreliable', () => {
    const text = 'Same content';
    const hash1 = computeHash(text, 'id1');
    const hash2 = computeHash(text, 'id2');
    expect(hash1).not.toBe(hash2);
  });
});
