import { describe, expect, it, vi } from 'vitest';
import { classifyAndCreateEvent } from '../src/cron';
import {
  applyTrustedResetContext,
  buildCompletedResetHintResult,
  buildSoftResetHintResult,
  getSoftResetHintSignals,
  getStrongResetSignal,
  getTrustedSourceContext,
  isCompletedResetHint,
  isStrongResetSignal,
  isSoftResetHint,
  isTrustedContextualReset,
} from '../src/classifier/types';
import type { SourcePost } from '../src/types';

function post(overrides: Partial<SourcePost> = {}): SourcePost {
  return {
    id: 148,
    source: 'x_api',
    source_account: 'thsottiaux',
    source_post_id: '2092862554632826968',
    source_url: 'https://x.com/thsottiaux/status/2092862554632826968',
    text: "A good thing about having aged is that I feel that it's been 20 years since I've pressed the reset button. Intrigued to see if I can find it tomorrow and dust it up for Codex",
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
      statement_nature: 'HINT',
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
      statement_nature: 'HINT',
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
      statement_nature: 'FACT',
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

  it('does not treat a ChatGPT Work reset as a Codex reset', () => {
    const chatgptWorkReset = post({
      text: 'ChatGPT Work usage will reset tomorrow for Work users.',
    });

    expect(isCompletedResetHint(chatgptWorkReset)).toBe(false);
    expect(isSoftResetHint(chatgptWorkReset)).toBe(false);
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
          product_scope: 'OTHER' as const,
          statement_nature: 'QUESTION' as const,
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
          product_scope: 'CODEX' as const,
          statement_nature: 'INTENTION' as const,
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

  it('does not route product updates into the reset lifecycle', async () => {
    const repo = {
      recordProviderStatus: vi.fn(async () => undefined),
      updateClassificationRetry: vi.fn(async () => undefined),
      markClassified: vi.fn(async () => undefined),
      insertEvent: vi.fn(async () => 46),
      getEventById: vi.fn(async () => ({ id: 46, source_post_id: 155, category: 'CODEX_UPDATE' })),
      handleResetEvent: vi.fn(async () => undefined),
    };
    const classifier = {
      classify: vi.fn(async () => ({
        status: 'SUCCESS' as const,
        result: {
          relevant: true,
          category: 'CODEX_UPDATE' as const,
          product_scope: 'CODEX' as const,
          statement_nature: 'FACT' as const,
          confidence: 0.9,
          title_en: 'Codex update',
          title_zh: 'Codex 更新',
          summary_en: 'A Codex product change is available.',
          summary_zh: 'Codex 产品变化已可用。',
          effective_time: null,
          reset_time: null,
          reason: 'Confirmed product change.',
        },
      })),
    };

    const outcome = await classifyAndCreateEvent(
      repo as any,
      classifier as any,
      post({ id: 155, source_post_id: '2093207246977318928', text: 'Codex update is available.' }),
    );

    expect(outcome.created).toBe(true);
    expect(repo.handleResetEvent).not.toHaveBeenCalled();
  });

  it('recognizes the authoritative historical reset text through trusted source context', () => {
    const historicalReset = post({
      id: 197,
      source_post_id: '2096035437299237298',
      source_url: 'https://x.com/thsottiaux/status/2096035437299237298',
      canonical_post_id: '2096035437299237298',
      text: 'Because we are beyond happy to have Astra rolled out today ahead of schedule and you have been super patient with us (not really, but it’s ok!)… we will do the full banked reset today too for all Plus, Pro and Business users. Lands end of day.\n\nHappy Astra day and enjoy a',
      classification_pending: false,
      classification_attempts: 1,
    });

    expect(getTrustedSourceContext(historicalReset)).toEqual({
      trusted: true,
      sourceContext: 'TRUSTED_CODEX_SOURCE_AVAILABLE',
    });
    expect(getStrongResetSignal(historicalReset)).toMatchObject({
      strong: true,
      category: 'RESET_PLANNED',
      hasAudienceContext: true,
      hasFutureIntent: true,
    });
    expect(isStrongResetSignal(historicalReset)).toBe(true);
    expect(isTrustedContextualReset(historicalReset)).toBe(true);
  });

  it('repairs a trusted strong reset discarded by the classifier and persists a bounded trace', async () => {
    const historicalReset = post({
      id: 197,
      source_post_id: '2096035437299237298',
      source_url: 'https://x.com/thsottiaux/status/2096035437299237298',
      canonical_post_id: '2096035437299237298',
      text: 'Because we are beyond happy to have Astra rolled out today ahead of schedule and you have been super patient with us (not really, but it’s ok!)… we will do the full banked reset today too for all Plus, Pro and Business users. Lands end of day.\n\nHappy Astra day and enjoy a',
    });
    const repo = {
      recordProviderStatus: vi.fn(async () => undefined),
      recordClassificationDecision: vi.fn(async () => undefined),
      updateClassificationRetry: vi.fn(async () => undefined),
      markClassified: vi.fn(async () => undefined),
      insertEvent: vi.fn(async () => 77),
      getEventById: vi.fn(async () => ({ id: 77, source_post_id: 197, category: 'RESET_PLANNED' })),
      handleResetEvent: vi.fn(async () => undefined),
    };
    const classifier = {
      classify: vi.fn(async () => ({
        status: 'SUCCESS' as const,
        result: {
          relevant: false,
          category: 'IRRELEVANT' as const,
          product_scope: 'OTHER' as const,
          statement_nature: 'FACT' as const,
          confidence: 0.2,
          title_en: '',
          title_zh: '',
          summary_en: '',
          summary_zh: '',
          effective_time: null,
          reset_time: null,
          reason: 'The model did not attach the post to Codex.',
        },
      })),
    };

    const outcome = await classifyAndCreateEvent(repo as any, classifier as any, historicalReset);

    expect(outcome).toMatchObject({ created: true, outcome: { status: 'SUCCESS', result: { category: 'RESET_PLANNED', product_scope: 'CODEX' } } });
    expect(repo.recordClassificationDecision).toHaveBeenCalledWith(197, expect.objectContaining({
      classification_label: 'RESET_PLANNED',
      classification_decision: 'EVENT_CREATED',
      classification_reason_code: 'TRUSTED_SOURCE_CONTEXT_APPLIED',
      classification_source_context: 'TRUSTED_CODEX_SOURCE_APPLIED',
      classification_event_created: true,
    }));
  });

  it('does not apply the contextual reset rule to an untrusted source', async () => {
    const untrustedReset = post({
      source: 'web_search',
      source_quality: 'INDEXED',
      verification_status: 'INDEXED_ONLY',
      text: 'We will do the full banked reset today for all Plus, Pro and Business users.',
    });
    const repo = {
      recordProviderStatus: vi.fn(async () => undefined),
      recordClassificationDecision: vi.fn(async () => undefined),
      updateClassificationRetry: vi.fn(async () => undefined),
      markClassified: vi.fn(async () => undefined),
      insertEvent: vi.fn(async () => 78),
      getEventById: vi.fn(async () => ({ id: 78, source_post_id: 148, category: 'RESET_PLANNED' })),
      handleResetEvent: vi.fn(async () => undefined),
    };
    const classifier = { classify: vi.fn(async () => ({
      status: 'SUCCESS' as const,
      result: {
        relevant: false,
        category: 'IRRELEVANT' as const,
        product_scope: 'OTHER' as const,
        statement_nature: 'FACT' as const,
        confidence: 0.2,
        title_en: '', title_zh: '', summary_en: '', summary_zh: '', effective_time: null, reset_time: null,
        reason: 'Untrusted source fixture.',
      },
    })) };

    const outcome = await classifyAndCreateEvent(repo as any, classifier as any, untrustedReset);

    expect(outcome.created).toBe(false);
    expect(isTrustedContextualReset(untrustedReset)).toBe(false);
    expect(repo.insertEvent).not.toHaveBeenCalled();
    expect(repo.recordClassificationDecision).toHaveBeenCalledWith(148, expect.objectContaining({
      classification_reason_code: 'UNTRUSTED_SOURCE_CONTEXT',
      classification_source_context: 'UNTRUSTED_SOURCE',
      classification_event_created: false,
    }));
  });

  it('rejects a weak generic reset even when the source is trusted', () => {
    const weakReset = post({ text: 'We will reset the dashboard later.' });
    expect(getStrongResetSignal(weakReset)).toMatchObject({ strong: false, hasStrongResetPhrase: false });
    expect(isTrustedContextualReset(weakReset)).toBe(false);
    expect(applyTrustedResetContext(weakReset, {
      status: 'SUCCESS',
      result: {
        relevant: false,
        category: 'IRRELEVANT',
        product_scope: 'OTHER',
        statement_nature: 'FACT',
        confidence: 0.3,
        title_en: '', title_zh: '', summary_en: '', summary_zh: '', effective_time: null, reset_time: null,
        reason: 'Weak reset fixture.',
      },
    })).toMatchObject({ applied: false, sourceContext: 'TRUSTED_CODEX_SOURCE_AVAILABLE', outcome: { status: 'SUCCESS' } });
  });

  it('keeps an explicitly ChatGPT Work reset outside the Codex timeline', async () => {
    const nonCodexReset = post({ text: 'ChatGPT Work will get a full banked reset today for all users.' });
    expect(getStrongResetSignal(nonCodexReset).strong).toBe(true);
    expect(isTrustedContextualReset(nonCodexReset)).toBe(false);
    const repo = {
      recordProviderStatus: vi.fn(async () => undefined),
      recordClassificationDecision: vi.fn(async () => undefined),
      updateClassificationRetry: vi.fn(async () => undefined),
      markClassified: vi.fn(async () => undefined),
      insertEvent: vi.fn(async () => 79),
      getEventById: vi.fn(async () => ({ id: 79, source_post_id: 148, category: 'RESET_PLANNED' })),
      handleResetEvent: vi.fn(async () => undefined),
    };
    const classifier = { classify: vi.fn(async () => ({
      status: 'SUCCESS' as const,
      result: {
        relevant: true,
        category: 'RESET_PLANNED' as const,
        product_scope: 'CHATGPT_WORK' as const,
        statement_nature: 'INTENTION' as const,
        confidence: 0.9,
        title_en: 'ChatGPT Work reset', title_zh: 'ChatGPT Work 重置', summary_en: 'Work reset.', summary_zh: 'Work 重置。', effective_time: null, reset_time: null,
        reason: 'Explicit non-Codex product.',
      },
    })) };

    const outcome = await classifyAndCreateEvent(repo as any, classifier as any, nonCodexReset);

    expect(outcome.created).toBe(false);
    expect(repo.insertEvent).not.toHaveBeenCalled();
    expect(repo.recordClassificationDecision).toHaveBeenCalledWith(148, expect.objectContaining({ classification_reason_code: 'NON_CODEX_PRODUCT_SCOPE' }));
  });

  it('filters the authoritative historical signoff post and does not invent an event', async () => {
    const signoff = post({
      id: 196,
      source_post_id: '2096035748130795560',
      source_url: 'https://x.com/thsottiaux/status/2096035748130795560',
      canonical_post_id: '2096035748130795560',
      text: 'And the team will have some nice sleep now. See you next week for some more ships.',
    });
    expect(getTrustedSourceContext(signoff).trusted).toBe(true);
    expect(isStrongResetSignal(signoff)).toBe(false);
    const repo = {
      recordProviderStatus: vi.fn(async () => undefined),
      recordClassificationDecision: vi.fn(async () => undefined),
      updateClassificationRetry: vi.fn(async () => undefined),
      markClassified: vi.fn(async () => undefined),
      insertEvent: vi.fn(async () => 80),
      getEventById: vi.fn(async () => ({ id: 80, source_post_id: 196, category: 'RESET_PLANNED' })),
      handleResetEvent: vi.fn(async () => undefined),
    };
    const classifier = { classify: vi.fn(async () => ({
      status: 'SUCCESS' as const,
      result: {
        relevant: true,
        category: 'ROADMAP_HINT' as const,
        product_scope: 'CODEX' as const,
        statement_nature: 'HINT' as const,
        confidence: 0.2,
        title_en: 'A possible product signal',
        title_zh: '可能的产品信号',
        summary_en: 'The model must not infer Codex from a signoff.',
        summary_zh: '模型不得从收尾话语推断 Codex。',
        effective_time: null,
        reset_time: null,
        reason: 'Signoff fixture has no Codex anchor.',
      },
    })) };

    const outcome = await classifyAndCreateEvent(repo as any, classifier as any, signoff);

    expect(outcome.created).toBe(false);
    expect(repo.insertEvent).not.toHaveBeenCalled();
    expect(repo.recordClassificationDecision).toHaveBeenCalledWith(196, expect.objectContaining({
      classification_reason_code: 'MISSING_PRODUCT_CONTEXT',
      classification_source_context: 'TRUSTED_CODEX_SOURCE_AVAILABLE',
      classification_event_created: false,
    }));
  });
});
