import { afterEach, describe, expect, it, vi } from 'vitest';
import { LLMClassifier } from '../src/classifier/llm';
import type { Env, SourcePost } from '../src/types';

function post(text: string): SourcePost {
  return {
    source: 'x_api',
    source_account: 'thsottiaux',
    source_post_id: 'test-post',
    source_url: 'https://x.com/thsottiaux/status/test-post',
    text,
    published_at: '2026-09-03T00:00:00.000Z',
    fetched_at: '2026-09-03T00:01:00.000Z',
    raw_json: '{}',
    content_hash: 'test-post',
    classification_pending: true,
    canonical_platform: 'x',
    canonical_post_id: 'test-post',
    source_quality: 'DIRECT',
    verification_status: 'DIRECT_VERIFIED',
  };
}

function classifier(): LLMClassifier {
  return new LLMClassifier({
    LLM_API_KEY: 'test-key',
    LLM_BASE_URL: 'https://llm.example/v1',
    LLM_MODEL: 'test-model',
  } as Env);
}

function response(result: Record<string, unknown>): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(result) } }] }),
  } as Response;
}

function baseResult(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    relevant: true,
    category: 'FEATURE_DISCUSSION',
    product_scope: 'CODEX',
    statement_nature: 'QUESTION',
    confidence: 0.7,
    title_en: 'Codex feature discussion',
    title_zh: 'Codex 功能讨论',
    summary_en: 'Tibo asks for product feedback.',
    summary_zh: 'Tibo 询问产品反馈。',
    effective_time: null,
    reset_time: null,
    reason: 'This is a relevant product question, not a release confirmation.',
    ...overrides,
  };
}

describe('LLM classifier coverage taxonomy', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('accepts product updates, roadmap questions, and feature discussions', async () => {
    const fetchMock = vi.fn(async () => response(baseResult({
      category: 'ROADMAP_HINT',
      statement_nature: 'QUESTION',
    })));
    vi.stubGlobal('fetch', fetchMock);

    const result = await classifier().classify(post('What should we ship next week?'));

    expect(result).toMatchObject({
      status: 'SUCCESS',
      result: {
        category: 'ROADMAP_HINT',
        statement_nature: 'QUESTION',
        effective_time: null,
        reset_time: null,
      },
    });
    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(request.messages[0].content).toContain('FEATURE_DISCUSSION');
    expect(request.messages[0].content).toContain('statement_nature');
    expect(request.messages[0].content).toContain('OBSERVATION');
    expect(request.messages[0].content).toContain('Never infer a fact from a question');
  });

  it('accepts an OBSERVATION that remains IRRELEVANT and non-admitted', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(baseResult({
      relevant: false,
      category: 'IRRELEVANT',
      product_scope: 'CODEX',
      statement_nature: 'OBSERVATION',
    }))));

    const result = await classifier().classify(post('Starting to see more Codex users in cafes.'));

    expect(result).toMatchObject({
      status: 'SUCCESS',
      result: {
        relevant: false,
        category: 'IRRELEVANT',
        product_scope: 'CODEX',
        statement_nature: 'OBSERVATION',
      },
    });
  });

  it('rejects CODEX_UPDATE with OBSERVATION', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(baseResult({
      category: 'CODEX_UPDATE',
      statement_nature: 'OBSERVATION',
    }))));

    const result = await classifier().classify(post('Codex users are increasingly working from cafes.'));

    expect(result).toMatchObject({ status: 'ERROR', category: 'ERROR' });
    expect((result as { error?: string }).error).toContain('CODEX_UPDATE requires statement_nature=FACT');
  });

  it('rejects RESET_COMPLETED with OBSERVATION', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(baseResult({
      category: 'RESET_COMPLETED',
      statement_nature: 'OBSERVATION',
    }))));

    const result = await classifier().classify(post('Codex users observed a fresh usage window.'));

    expect(result).toMatchObject({ status: 'ERROR', category: 'ERROR' });
    expect((result as { error?: string }).error).toContain('RESET_COMPLETED requires statement_nature=FACT');
  });

  it('drops model-invented timestamps when the post only uses relative timing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(baseResult({
      category: 'CODEX_UPDATE',
      statement_nature: 'FACT',
      effective_time: '2026-09-10T12:00:00.000Z',
      reset_time: '2026-09-10T12:00:00.000Z',
    }))));

    const result = await classifier().classify(post('We are thinking about shipping this soon.'));

    expect(result).toMatchObject({
      status: 'SUCCESS',
      result: { effective_time: null, reset_time: null },
    });
  });

  it('rejects a confirmed update category with non-factual nature', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(baseResult({
      category: 'CODEX_UPDATE',
      statement_nature: 'INTENTION',
    }))));

    const result = await classifier().classify(post('We are planning a Codex update.'));

    expect(result).toMatchObject({ status: 'ERROR', category: 'ERROR' });
    expect((result as { error?: string }).error).toContain('requires statement_nature=FACT');
  });
});
