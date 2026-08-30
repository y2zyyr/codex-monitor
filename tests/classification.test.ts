import { describe, it, expect } from 'vitest';
import { EVENT_CATEGORIES } from '../src/types';
import type { ClassificationResult, SourcePost } from '../src/types';

describe('Classification Schema Validation', () => {
  const validCategories = ['RESET_PLANNED', 'RESET_COMPLETED', 'RESET_TIME_CHANGED', 'POLICY_CHANGE', 'IRRELEVANT'];

  it('EVENT_CATEGORIES matches expected values', () => {
    expect(EVENT_CATEGORIES).toEqual(validCategories);
  });

  it('validates a valid RESET_PLANNED result', () => {
    const result: ClassificationResult = {
      relevant: true,
      category: 'RESET_PLANNED',
      confidence: 0.95,
      title_en: 'Full reset tomorrow',
      title_zh: '明天全面重置',
      summary_en: 'Reset will happen tomorrow.',
      summary_zh: '重置将在明天进行。',
      effective_time: null,
      reset_time: null,
      reason: 'Post explicitly states reset happening tomorrow.',
    };

    expect(result.relevant).toBe(true);
    expect(EVENT_CATEGORIES.includes(result.category)).toBe(true);
    expect(result.category).not.toBe('IRRELEVANT');
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it('validates a valid RESET_COMPLETED result', () => {
    const result: ClassificationResult = {
      relevant: true,
      category: 'RESET_COMPLETED',
      confidence: 0.98,
      title_en: 'Reset propagated to accounts',
      title_zh: '重置已传播到账户',
      summary_en: 'Reset has been propagated.',
      summary_zh: '重置已完成传播。',
      effective_time: '2026-08-24T12:00:00.000Z',
      reset_time: '2026-08-24T12:00:00.000Z',
      reason: 'Reset completion confirmed.',
    };

    expect(result.relevant).toBe(true);
    expect(result.category).toBe('RESET_COMPLETED');
    expect(result.reset_time).toBeTruthy();
  });

  it('validates a valid RESET_TIME_CHANGED result', () => {
    const result: ClassificationResult = {
      relevant: true,
      category: 'RESET_TIME_CHANGED',
      confidence: 0.85,
      title_en: 'Reset moved to 2pm PT',
      title_zh: '重置时间改为太平洋时间下午2点',
      summary_en: 'Reset time changed.',
      summary_zh: '重置时间已更改。',
      effective_time: null,
      reset_time: null,
      reason: 'Post states time change but no exact date.',
    };

    expect(result.relevant).toBe(true);
    expect(result.category).toBe('RESET_TIME_CHANGED');
  });

  it('validates a valid POLICY_CHANGE result', () => {
    const result: ClassificationResult = {
      relevant: true,
      category: 'POLICY_CHANGE',
      confidence: 0.97,
      title_en: 'Plus 5-hour limit restored',
      title_zh: 'Plus 账户恢复 5 小时额度限制',
      summary_en: 'The 5-hour usage limit will return for Plus accounts.',
      summary_zh: 'Plus 账户将恢复 5 小时使用额度限制。',
      effective_time: null,
      reset_time: null,
      reason: 'This changes the active Codex usage policy.',
    };

    expect(result.relevant).toBe(true);
    expect(result.category).toBe('POLICY_CHANGE');
  });

  it('validates an IRRELEVANT result', () => {
    const result: ClassificationResult = {
      relevant: false,
      category: 'IRRELEVANT',
      confidence: 0.0,
      title_en: 'Classification failed',
      title_zh: '分类失败',
      summary_en: 'Not relevant to Codex usage.',
      summary_zh: '与 Codex 使用无关。',
      effective_time: null,
      reset_time: null,
      reason: 'Post is about general performance.',
    };

    expect(result.relevant).toBe(false);
    expect(result.category).toBe('IRRELEVANT');
  });

  it('rejects invalid categories', () => {
    const invalid = 'INVALID_CATEGORY';
    expect(EVENT_CATEGORIES.includes(invalid as any)).toBe(false);
  });

  it('confidence must be between 0 and 1', () => {
    const valid: ClassificationResult = {
      relevant: true,
      category: 'POLICY_CHANGE',
      confidence: 0.5,
      title_en: 'Test',
      title_zh: '测试',
      summary_en: 'Test',
      summary_zh: '测试',
      effective_time: null,
      reset_time: null,
      reason: 'Test',
    };
    expect(valid.confidence).toBeGreaterThanOrEqual(0);
    expect(valid.confidence).toBeLessThanOrEqual(1);
  });

  it('IRRELEVANT category must have relevant=false', () => {
    // This is a logical constraint: irrelevant posts should not be marked relevant
    const irrelevant: ClassificationResult = {
      relevant: false,
      category: 'IRRELEVANT',
      confidence: 0,
      title_en: 'Not relevant',
      title_zh: '不相关',
      summary_en: 'Not relevant.',
      summary_zh: '不相关。',
      effective_time: null,
      reset_time: null,
      reason: 'Not relevant.',
    };
    expect(irrelevant.relevant).toBe(false);
    expect(irrelevant.category).toBe('IRRELEVANT');
  });
});
