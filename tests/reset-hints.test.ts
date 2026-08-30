import { describe, expect, it, vi } from 'vitest';
import { classifyAndCreateEvent } from '../src/cron';
import {
  buildCompletedResetHintResult,
  buildSoftResetHintResult,
  getSoftResetHintSignals,
  isCompletedResetHint,
  isSoftResetHint,
} from '../src/classifier/types';
import type { SourcePost } from '../src/types';

function post(overrides: Partial<SourcePost> = {}): SourcePost {
  return {
    id: 148,
    source: 'x_api',
    source_account: 'thsottiaux',
    source_post_id: '2092862554632826968',
    source_url: 'https://x.com/thsottiaux/status/2092862554632826968',
    text: "A good thing about having aged is that I feel that it's been 20 years since I've pressed the reset button. Intrigued to see if I can find it tomorrow and dust it up",
    published_at: '2026-08-27T06:31:31.000Z',
    fetched_at: '2026-08-27T09:45:52.752Z',
    raw_json: '{}',
    content_hash: 'soft-reset-hint',
    classification_pending: true,
    canonical_platform: 'x',
    canonical_post_id: '2092862554632826968',
    source_quality: 'DIRECT',
    verification_status: 'DIRECT_VERIFIED',
    ...overrides,
  };
}

describe('Direct reset hint classification', () => {
  it('recognizes the future-looking reset-button post as a soft hint', () => {
    expect(isSoftResetHint(post())).toBe(true);
  });

  it('does not promote the same wording from an indexed snippet', () => {
    expect(isSoftResetHint(post({ source: 'web_search', source_quality: 'INDEXED' }))).toBe(false);
  });

  it('does not promote a reset-button mention without a future action', () => {
    expect(isSoftResetHint(post({ text: 'The reset button is available in settings.' }))).toBe(false);
  });

  it('recognizes Tibo\'s indirect milestone wording as a soft hint', () => {
    const milestonePost = post({
      source_post_id: '2093573991965557198',
      source_url: 'https://x.com/thsottiaux/status/2093573991965557198',
      text: 'Looking at the dashboard we might hit a new milestone to celebrate tomorrow. Hold on to your Codex',
    });

    expect(getSoftResetHintSignals(milestonePost.text)).toMatchObject({
      kind: 'MILESTONE',
      hasProductContext: true,
      hasFutureIntent: true,
      hasMilestoneLanguage: true,
      hasDashboardLanguage: true,
      hasConservationLanguage: true,
    });
    expect(isSoftResetHint(milestonePost)).toBe(true);
  });

  it('does not treat a generic milestone as a Codex reset hint', () => {
    expect(getSoftResetHintSignals('A new milestone to celebrate tomorrow')).toMatchObject({ kind: null });
    expect(isSoftResetHint(post({ text: 'A new milestone to celebrate tomorrow' }))).toBe(false);
  });

  it('builds an indirect milestone summary without inventing a reset time', () => {
    const result = buildSoftResetHintResult(post({
      text: 'Looking at the dashboard we might hit a new milestone to celebrate tomorrow. Hold on to your Codex',
    }));

    expect(result).toMatchObject({
      relevant: true,
      category: 'RESET_PLANNED',
      confidence: 0.58,
      effective_time: null,
      reset_time: null,
    });
    expect(result.summary_zh).toContain('间接的重置线索');
  });

  it('builds a visible low-confidence planned event without inventing a time', () => {
    const result = buildSoftResetHintResult(post());
    expect(result).toMatchObject({
      relevant: true,
      category: 'RESET_PLANNED',
      confidence: 0.55,
      effective_time: null,
      reset_time: null,
    });
    expect(result.summary_zh).toContain('软性暗示');
  });

  it('recognizes completed-state wording as a reset completion', () => {
    const completed = post({
      source_post_id: '2093014447833116908',
      source_url: 'https://x.com/thsottiaux/status/2093014447833116908',
      text: 'Never slept better and feeling reseted. Brand new me and brand new usage for all ChatGPT Work and Codex users. Regaining my youth one button press at a time.',
    });

    expect(isCompletedResetHint(completed)).toBe(true);
    expect(isSoftResetHint(completed)).toBe(false);
    expect(buildCompletedResetHintResult(completed)).toMatchObject({
      relevant: true,
      category: 'RESET_COMPLETED',
      confidence: 0.82,
      effective_time: null,
      reset_time: null,
    });
  });

  it('does not treat future reset language as completed', () => {
    expect(isCompletedResetHint(post({
      text: 'Tomorrow I will find the reset button and give everyone brand new usage.',
    }))).toBe(false);
  });

  it('does not promote completed wording from an indexed snippet', () => {
    expect(isCompletedResetHint(post({
      source: 'web_search',
      source_quality: 'INDEXED',
      verification_status: 'INDEXED_ONLY',
      text: 'Feeling reseted with brand new usage for Codex users.',
    }))).toBe(false);
  });

  it('creates an event when the LLM would otherwise discard the direct hint', async () => {
    const repo = {
      recordProviderStatus: vi.fn(async () => undefined),
      updateClassificationRetry: vi.fn(async () => undefined),
      markClassified: vi.fn(async () => undefined),
      insertEvent: vi.fn(async () => 42),
      getEventById: vi.fn(async () => ({ id: 42, source_post_id: 148, category: 'RESET_PLANNED' })),
      handleResetEvent: vi.fn(async () => undefined),
    };
    const classifier = {
      classify: vi.fn(async () => ({
        status: 'SUCCESS' as const,
        result: {
          relevant: false,
          category: 'IRRELEVANT' as const,
          confidence: 0.2,
          title_en: '',
          title_zh: '',
          summary_en: '',
          summary_zh: '',
          effective_time: null,
          reset_time: null,
          reason: 'Too conversational',
        },
      })),
    };

    const outcome = await classifyAndCreateEvent(
      repo as any,
      classifier as any,
      post(),
      new Date('2026-08-27T10:00:00.000Z'),
    );

    expect(outcome.created).toBe(true);
    expect(repo.insertEvent).toHaveBeenCalledWith(expect.objectContaining({
      category: 'RESET_PLANNED',
      confidence: 0.55,
      reset_at: null,
    }));
    expect(repo.handleResetEvent).toHaveBeenCalled();
  });

  it('lets deterministic completion wording override an LLM planned result', async () => {
    const completed = post({
      id: 152,
      source_post_id: '2093014447833116908',
      source_url: 'https://x.com/thsottiaux/status/2093014447833116908',
      text: 'Never slept better and feeling reseted. Brand new me and brand new usage for all ChatGPT Work and Codex users.',
    });
    const repo = {
      recordProviderStatus: vi.fn(async () => undefined),
      updateClassificationRetry: vi.fn(async () => undefined),
      markClassified: vi.fn(async () => undefined),
      insertEvent: vi.fn(async () => 43),
      getEventById: vi.fn(async () => ({ id: 43, source_post_id: 152, category: 'RESET_COMPLETED' })),
      handleResetEvent: vi.fn(async () => undefined),
    };
    const classifier = {
      classify: vi.fn(async () => ({
        status: 'SUCCESS' as const,
        result: {
          relevant: true,
          category: 'RESET_PLANNED' as const,
          confidence: 0.7,
          title_en: 'The reset may happen soon',
          title_zh: '重置可能即将发生',
          summary_en: 'The model incorrectly interpreted the post as future-looking.',
          summary_zh: '模型错误地将帖子解释为未来事件。',
          effective_time: null,
          reset_time: null,
          reason: 'Model-only classification',
        },
      })),
    };

    const outcome = await classifyAndCreateEvent(
      repo as any,
      classifier as any,
      completed,
      new Date('2026-08-28T00:00:00.000Z'),
    );

    expect(outcome.outcome).toMatchObject({
      status: 'SUCCESS',
      result: { category: 'RESET_COMPLETED', confidence: 0.82 },
    });
    expect(repo.insertEvent).toHaveBeenCalledWith(expect.objectContaining({
      category: 'RESET_COMPLETED',
      confidence: 0.82,
      reset_at: null,
    }));
    expect(repo.handleResetEvent).toHaveBeenCalled();
  });

  it('can persist a deterministic completion when the classifier is temporarily unavailable', async () => {
    const completed = post({
      id: 153,
      source_post_id: '2093014447833116908',
      text: 'Feeling reseted with brand new usage for all ChatGPT Work and Codex users.',
    });
    const repo = {
      recordProviderStatus: vi.fn(async () => undefined),
      updateClassificationRetry: vi.fn(async () => undefined),
      markClassified: vi.fn(async () => undefined),
      insertEvent: vi.fn(async () => 44),
      getEventById: vi.fn(async () => ({ id: 44, source_post_id: 153, category: 'RESET_COMPLETED' })),
      handleResetEvent: vi.fn(async () => undefined),
    };
    const classifier = {
      classify: vi.fn(async () => ({
        status: 'ERROR' as const,
        error: 'temporary outage',
        category: 'ERROR' as const,
      })),
    };

    const outcome = await classifyAndCreateEvent(repo as any, classifier as any, completed);

    expect(outcome.outcome).toMatchObject({ status: 'SUCCESS', result: { category: 'RESET_COMPLETED' } });
    expect(repo.insertEvent).toHaveBeenCalled();
    expect(repo.updateClassificationRetry).not.toHaveBeenCalled();
  });

  it('persists an indirect milestone hint when the classifier is temporarily unavailable', async () => {
    const milestone = post({
      id: 154,
      source_post_id: '2093573991965557198',
      source_url: 'https://x.com/thsottiaux/status/2093573991965557198',
      text: 'Looking at the dashboard we might hit a new milestone to celebrate tomorrow. Hold on to your Codex',
    });
    const repo = {
      recordProviderStatus: vi.fn(async () => undefined),
      updateClassificationRetry: vi.fn(async () => undefined),
      markClassified: vi.fn(async () => undefined),
      insertEvent: vi.fn(async () => 45),
      getEventById: vi.fn(async () => ({ id: 45, source_post_id: 154, category: 'RESET_PLANNED' })),
      handleResetEvent: vi.fn(async () => undefined),
    };
    const classifier = {
      classify: vi.fn(async () => ({
        status: 'ERROR' as const,
        error: 'temporary outage',
        category: 'ERROR' as const,
      })),
    };

    const outcome = await classifyAndCreateEvent(repo as any, classifier as any, milestone);

    expect(outcome.outcome).toMatchObject({ status: 'SUCCESS', result: { category: 'RESET_PLANNED', confidence: 0.58 } });
    expect(repo.insertEvent).toHaveBeenCalledWith(expect.objectContaining({
      category: 'RESET_PLANNED',
      confidence: 0.58,
      reset_at: null,
    }));
    expect(repo.updateClassificationRetry).not.toHaveBeenCalled();
  });
});
