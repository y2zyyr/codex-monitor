import { describe, expect, it, vi } from 'vitest';
import { classifyAndCreateEvent } from '../src/cron';
import { isCodexProductSignalAdmissible } from '../src/classifier/types';
import { PRODUCT_SCOPES } from '../src/types';
import type { ClassificationResult, SourcePost } from '../src/types';

function post(text: string): SourcePost {
  return {
    id: 901,
    source: 'x_api',
    source_account: 'thsottiaux',
    source_post_id: 'scope-test',
    source_url: 'https://x.com/thsottiaux/status/scope-test',
    text,
    published_at: '2026-09-03T00:00:00.000Z',
    fetched_at: '2026-09-03T00:01:00.000Z',
    raw_json: '{}',
    content_hash: `scope-${text}`,
    classification_pending: true,
    canonical_platform: 'x',
    canonical_post_id: 'scope-test',
    source_quality: 'DIRECT',
    verification_status: 'DIRECT_VERIFIED',
  };
}

function result(
  category: ClassificationResult['category'],
  productScope: ClassificationResult['product_scope'],
  statementNature: ClassificationResult['statement_nature'] = 'QUESTION',
): ClassificationResult {
  const relevant = category !== 'IRRELEVANT';
  return {
    relevant,
    category,
    product_scope: productScope,
    statement_nature: statementNature,
    confidence: 0.9,
    title_en: relevant ? 'Codex scope test' : '',
    title_zh: relevant ? 'Codex 范围测试' : '',
    summary_en: relevant ? 'Scope admission test.' : '',
    summary_zh: relevant ? '范围准入测试。' : '',
    effective_time: null,
    reset_time: null,
    reason: 'Scope admission test.',
  };
}

function repo(category: ClassificationResult['category']) {
  return {
    recordProviderStatus: vi.fn(async () => undefined),
    updateClassificationRetry: vi.fn(async () => undefined),
    markClassified: vi.fn(async () => undefined),
    insertEvent: vi.fn(async () => 901),
    getEventById: vi.fn(async () => ({ id: 901, source_post_id: 901, category })),
    handleResetEvent: vi.fn(async () => undefined),
  };
}

describe('Product scope admission', () => {
  it('exposes the six internal product scopes', () => {
    expect(PRODUCT_SCOPES).toEqual([
      'CODEX',
      'CHATGPT_WORK',
      'CHATGPT',
      'OPENAI_GENERAL',
      'OTHER',
      'AMBIGUOUS',
    ]);
  });

  it('admits only CODEX for reset, policy, and product categories', () => {
    expect(isCodexProductSignalAdmissible({ category: 'CODEX_UPDATE', product_scope: 'CODEX', statement_nature: 'FACT' })).toBe(true);
    expect(isCodexProductSignalAdmissible({ category: 'ROADMAP_HINT', product_scope: 'CODEX', statement_nature: 'HINT' })).toBe(true);
    expect(isCodexProductSignalAdmissible({ category: 'FEATURE_DISCUSSION', product_scope: 'CODEX', statement_nature: 'QUESTION' })).toBe(true);
    expect(isCodexProductSignalAdmissible({ category: 'RESET_PLANNED', product_scope: 'CODEX', statement_nature: 'INTENTION' })).toBe(true);
    expect(isCodexProductSignalAdmissible({ category: 'RESET_COMPLETED', product_scope: 'CODEX', statement_nature: 'FACT' })).toBe(true);
    expect(isCodexProductSignalAdmissible({ category: 'RESET_TIME_CHANGED', product_scope: 'CODEX', statement_nature: 'FACT' })).toBe(true);
    expect(isCodexProductSignalAdmissible({ category: 'POLICY_CHANGE', product_scope: 'CODEX', statement_nature: 'FACT' })).toBe(true);
    expect(isCodexProductSignalAdmissible({ category: 'FEATURE_DISCUSSION', product_scope: 'CHATGPT_WORK', statement_nature: 'QUESTION' })).toBe(false);
    expect(isCodexProductSignalAdmissible({ category: 'ROADMAP_HINT', product_scope: 'AMBIGUOUS', statement_nature: 'HINT' })).toBe(false);
    expect(isCodexProductSignalAdmissible({ category: 'FEATURE_DISCUSSION', product_scope: 'CODEX', statement_nature: 'OBSERVATION' })).toBe(false);
    for (const category of ['RESET_PLANNED', 'RESET_COMPLETED', 'RESET_TIME_CHANGED', 'POLICY_CHANGE'] as const) {
      for (const product_scope of ['CHATGPT_WORK', 'CHATGPT', 'OPENAI_GENERAL', 'OTHER', 'AMBIGUOUS'] as const) {
        expect(isCodexProductSignalAdmissible({ category, product_scope, statement_nature: 'FACT' })).toBe(false);
      }
    }
  });

  it('does not create a Codex event for a ChatGPT Work discussion', async () => {
    const repository = repo('FEATURE_DISCUSSION');
    const classifier = { classify: vi.fn(async () => ({
      status: 'SUCCESS' as const,
      result: result('FEATURE_DISCUSSION', 'CHATGPT_WORK'),
    })) };

    const outcome = await classifyAndCreateEvent(
      repository as any,
      classifier as any,
      post('What is the most ambitious task you have given ChatGPT Work?'),
    );

    expect(outcome.created).toBe(false);
    expect(repository.insertEvent).not.toHaveBeenCalled();
    expect(repository.markClassified).toHaveBeenCalledWith(901);
  });

  it('does not create a public event for an ambiguous roadmap hint', async () => {
    const repository = repo('ROADMAP_HINT');
    const classifier = { classify: vi.fn(async () => ({
      status: 'SUCCESS' as const,
      result: result('ROADMAP_HINT', 'AMBIGUOUS', 'HINT'),
    })) };

    const outcome = await classifyAndCreateEvent(
      repository as any,
      classifier as any,
      post('What should we ship next week?'),
    );

    expect(outcome.created).toBe(false);
    expect(repository.insertEvent).not.toHaveBeenCalled();
  });

  it('does not create a public event for a non-Codex policy change', async () => {
    const repository = repo('POLICY_CHANGE');
    const classifier = { classify: vi.fn(async () => ({
      status: 'SUCCESS' as const,
      result: result('POLICY_CHANGE', 'OPENAI_GENERAL', 'FACT'),
    })) };

    const outcome = await classifyAndCreateEvent(
      repository as any,
      classifier as any,
      post('OpenAI is changing a company-wide policy.'),
    );

    expect(outcome.created).toBe(false);
    expect(repository.insertEvent).not.toHaveBeenCalled();
    expect(repository.markClassified).toHaveBeenCalledWith(901);
  });

  it('does not create a Codex reset event for a non-Codex reset result', async () => {
    const repository = repo('RESET_PLANNED');
    const classifier = { classify: vi.fn(async () => ({
      status: 'SUCCESS' as const,
      result: result('RESET_PLANNED', 'CHATGPT_WORK', 'INTENTION'),
    })) };

    const outcome = await classifyAndCreateEvent(
      repository as any,
      classifier as any,
      post('ChatGPT Work usage will reset tomorrow.'),
    );

    expect(outcome.created).toBe(false);
    expect(repository.insertEvent).not.toHaveBeenCalled();
    expect(repository.markClassified).toHaveBeenCalledWith(901);
  });

  it('allows an explicitly Codex-scoped update', async () => {
    const repository = repo('CODEX_UPDATE');
    const classifier = { classify: vi.fn(async () => ({
      status: 'SUCCESS' as const,
      result: result('CODEX_UPDATE', 'CODEX', 'FACT'),
    })) };

    const outcome = await classifyAndCreateEvent(
      repository as any,
      classifier as any,
      post('Codex now supports the new workflow.'),
    );

    expect(outcome.created).toBe(true);
    expect(repository.insertEvent).toHaveBeenCalledWith(expect.objectContaining({ category: 'CODEX_UPDATE' }));
  });
});
