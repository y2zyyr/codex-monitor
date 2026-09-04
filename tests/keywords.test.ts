import { describe, it, expect } from 'vitest';
import { keywordPrefilter } from '../src/classifier/types';

describe('Keyword Prefilter', () => {
  it('matches "codex" keyword', () => {
    expect(keywordPrefilter('Codex usage reset happening tomorrow')).toBe(true);
    expect(keywordPrefilter('New Codex feature announced')).toBe(true);
  });

  it('matches "reset" keyword', () => {
    expect(keywordPrefilter('Full reset will happen tomorrow')).toBe(true);
    expect(keywordPrefilter('Usage reset has been completed')).toBe(true);
  });

  it('matches "rate limit" keywords', () => {
    expect(keywordPrefilter('Rate limits have been updated')).toBe(true);
    expect(keywordPrefilter('New rate limit policy')).toBe(true);
  });

  it('matches "5 hour" keywords', () => {
    expect(keywordPrefilter('5-hour limit restored for Plus')).toBe(true);
    expect(keywordPrefilter('5h usage limit changed')).toBe(true);
  });

  it('matches "subscription" keywords', () => {
    expect(keywordPrefilter('Paid subscription tiers updated')).toBe(true);
    expect(keywordPrefilter('Plus subscription changes')).toBe(true);
  });

  it('matches "weekly" keywords', () => {
    expect(keywordPrefilter('Weekly limit increased')).toBe(true);
    expect(keywordPrefilter('New weekly usage policy')).toBe(true);
  });

  it('rejects completely unrelated posts', () => {
    expect(keywordPrefilter('Great weather we are having')).toBe(false);
    expect(keywordPrefilter('Hello world')).toBe(false);
    expect(keywordPrefilter('A new milestone to celebrate tomorrow')).toBe(false);
  });

  it('prioritizes product direction without making the keyword result authoritative', () => {
    expect(keywordPrefilter('Just shipped a new feature without any old usage keywords')).toBe(true);
    expect(keywordPrefilter('What should we ship next week?')).toBe(true);
    expect(keywordPrefilter('A new product is here')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(keywordPrefilter('CODEX USAGE RESET')).toBe(true);
    expect(keywordPrefilter('Codex Usage Reset')).toBe(true);
  });

  it('matches "compaction" keyword', () => {
    expect(keywordPrefilter('Compaction happening now')).toBe(true);
  });

  it('matches "quota" keyword', () => {
    expect(keywordPrefilter('Quota updates coming')).toBe(true);
  });

  it('admits an indirect Codex milestone hint before classification', () => {
    expect(keywordPrefilter('Looking at the dashboard we might hit a new milestone to celebrate tomorrow. Hold on to your Codex')).toBe(true);
    expect(keywordPrefilter('A new milestone to celebrate tomorrow')).toBe(false);
  });

  it('matches "limit" keyword', () => {
    expect(keywordPrefilter('New limits for codex users')).toBe(true);
  });

  it('matches "pro" keyword', () => {
    expect(keywordPrefilter('Pro subscription includes more usage')).toBe(true);
  });

  it('matches "plus" keyword', () => {
    expect(keywordPrefilter('Plus users get more credits')).toBe(true);
  });

  it('handles empty string without error', () => {
    expect(keywordPrefilter('')).toBe(false);
  });

  it('notes that "codex" alone triggers prefilter (LLM will filter)', () => {
    // "Codex is fast" passes keyword filter but LLM will classify as IRRELEVANT
    expect(keywordPrefilter('Codex is fast today')).toBe(true);
    expect(keywordPrefilter('Codex performance improvements')).toBe(true);
  });
});
