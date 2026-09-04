import { writeFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LLMClassifier } from '../src/classifier/llm';
import { isCodexProductSignalAdmissible } from '../src/classifier/types';
import type { ClassificationOutcome, ClassificationResult, Env, SourcePost } from '../src/types';

interface ShadowSample {
  id: string;
  text: string;
  expected: 'ambiguous-question' | 'chatgpt-work' | 'ambiguous-desktop' | 'codex-roadmap'
    | 'codex-adoption' | 'openai-general' | 'codex-update' | 'reset-planned'
    | 'reset-completed' | 'policy-change' | 'life' | 'link';
}

const SHADOW_SAMPLES: ShadowSample[] = [
  { id: 'shadow-what-ship', text: 'What should we ship next week?', expected: 'ambiguous-question' },
  { id: 'shadow-chatgpt-work', text: 'What is the most ambitious task you have given ChatGPT Work?', expected: 'chatgpt-work' },
  { id: 'shadow-desktop', text: 'The desktop app polish and reliability are improving every day.', expected: 'ambiguous-desktop' },
  { id: 'shadow-harness', text: 'Codex is a good harness, but it will seem primitive in 2-3 months and we are about to go through another major evolution.', expected: 'codex-roadmap' },
  { id: 'shadow-codex-users', text: 'Starting to see more and more Codex users on airplanes and in cafes.', expected: 'codex-adoption' },
  { id: 'shadow-openai-general', text: 'OpenAI DevDay 2026 will be our best DevDay in the history of the company.', expected: 'openai-general' },
  { id: 'shadow-codex-update', text: 'Codex is now available for non-coders.', expected: 'codex-update' },
  { id: 'shadow-reset-planned', text: 'We will reset the Codex usage limit tomorrow.', expected: 'reset-planned' },
  { id: 'shadow-reset-completed', text: 'Codex usage has been reset for everyone.', expected: 'reset-completed' },
  { id: 'shadow-policy', text: 'The Codex weekly usage limit is now 100 hours.', expected: 'policy-change' },
  { id: 'shadow-life', text: 'Do I need a haircut?', expected: 'life' },
  { id: 'shadow-link', text: 'https://t.co/example', expected: 'link' },
];

function post(sample: ShadowSample, index: number): SourcePost {
  return {
    source: 'x_api',
    source_account: 'thsottiaux',
    source_post_id: sample.id,
    source_url: `https://x.com/thsottiaux/status/${sample.id}`,
    text: sample.text,
    published_at: `2026-09-03T00:${String(index).padStart(2, '0')}:00.000Z`,
    fetched_at: `2026-09-03T01:${String(index).padStart(2, '0')}:00.000Z`,
    raw_json: '{}',
    content_hash: sample.id,
    classification_pending: true,
    canonical_platform: 'x',
    canonical_post_id: sample.id,
    source_quality: 'DIRECT',
    verification_status: 'DIRECT_VERIFIED',
  };
}

function admission(outcome: ClassificationOutcome): boolean {
  return outcome.status === 'SUCCESS'
    && outcome.result.relevant
    && outcome.result.category !== 'IRRELEVANT'
    && isCodexProductSignalAdmissible(outcome.result);
}

function hasReleaseClaim(text: string): boolean {
  return /\b(?:will\s+(?:launch|ship|release)|launch(?:es|ed)\s+on|release(?:s|d)\s+on)\b|(?:将|会).{0,8}(?:上线|发布)/i.test(text);
}

function assess(sample: ShadowSample, outcome: ClassificationOutcome): 'PASS' | 'REVIEW' | 'FAIL' {
  if (outcome.status !== 'SUCCESS') return 'FAIL';
  const result = outcome.result;
  const isAdmitted = admission(outcome);
  if (result.effective_time !== null || result.reset_time !== null) return 'FAIL';

  if (sample.expected === 'codex-update') {
    return result.category === 'CODEX_UPDATE' && result.statement_nature === 'FACT'
      && result.product_scope === 'CODEX' && isAdmitted ? 'PASS' : 'FAIL';
  }
  if (sample.expected === 'codex-roadmap') {
    return result.category === 'ROADMAP_HINT' && result.product_scope === 'CODEX'
      && result.statement_nature !== 'FACT' && !hasReleaseClaim(`${result.title_en} ${result.summary_en}`)
      && isAdmitted ? 'PASS' : 'FAIL';
  }
  if (sample.expected === 'reset-planned') {
    return result.category === 'RESET_PLANNED' && result.product_scope === 'CODEX'
      && result.statement_nature !== 'FACT' && isAdmitted ? 'PASS' : 'FAIL';
  }
  if (sample.expected === 'reset-completed') {
    return result.category === 'RESET_COMPLETED' && result.statement_nature === 'FACT'
      && result.product_scope === 'CODEX' && isAdmitted ? 'PASS' : 'FAIL';
  }
  if (sample.expected === 'policy-change') {
    return result.category === 'POLICY_CHANGE' && result.product_scope === 'CODEX'
      && result.relevant && isAdmitted ? 'PASS' : 'FAIL';
  }
  if (sample.expected === 'chatgpt-work') {
    return result.product_scope === 'CHATGPT_WORK' && !isAdmitted ? 'PASS' : 'FAIL';
  }
  if (sample.expected === 'ambiguous-question' || sample.expected === 'ambiguous-desktop') {
    const safeNonCodexScope = result.product_scope === 'AMBIGUOUS' || result.product_scope === 'OTHER';
    return safeNonCodexScope && !isAdmitted ? 'PASS' : 'FAIL';
  }
  if (sample.expected === 'codex-adoption') {
    if (result.product_scope === 'CODEX') return !isAdmitted ? 'PASS' : 'FAIL';
    return !isAdmitted ? 'REVIEW' : 'FAIL';
  }
  if (sample.expected === 'openai-general') {
    return result.product_scope === 'OPENAI_GENERAL' && !isAdmitted ? 'PASS' : 'REVIEW';
  }
  return !isAdmitted ? 'PASS' : 'FAIL';
}

function shadowOutcome(overrides: Partial<ClassificationResult>): ClassificationOutcome {
  return {
    status: 'SUCCESS',
    result: {
      relevant: false,
      category: 'IRRELEVANT',
      product_scope: 'OTHER',
      statement_nature: 'OBSERVATION',
      confidence: 0.9,
      title_en: 'No event',
      title_zh: '无事件',
      summary_en: 'No public event.',
      summary_zh: '不创建公开事件。',
      effective_time: null,
      reset_time: null,
      reason: 'Acceptance fixture.',
      ...overrides,
    },
  };
}

describe('P0 shadow acceptance criteria', () => {
  const desktop = SHADOW_SAMPLES.find(sample => sample.expected === 'ambiguous-desktop')!;

  it('accepts OTHER or AMBIGUOUS desktop scope when there is no admission', () => {
    expect(assess(desktop, shadowOutcome({ product_scope: 'OTHER' }))).toBe('PASS');
    expect(assess(desktop, shadowOutcome({ product_scope: 'AMBIGUOUS' }))).toBe('PASS');
  });

  it('fails a Codex-scoped public product event for the generic desktop sample', () => {
    expect(assess(desktop, shadowOutcome({
      relevant: true,
      category: 'CODEX_UPDATE',
      product_scope: 'CODEX',
      statement_nature: 'FACT',
    }))).toBe('FAIL');
  });
});

function shadowResultFields(outcome: ClassificationOutcome) {
  if (outcome.status === 'ERROR') {
    return {
      category: 'ERROR',
      statement_nature: null,
      product_scope: null,
      relevant: null,
      confidence: null,
      effective_at: null,
      reset_at: null,
      title_en: null,
      title_zh: null,
      summary_en: null,
      summary_zh: null,
      error: outcome.error,
    };
  }
  return {
    category: outcome.result.category,
    statement_nature: outcome.result.statement_nature,
    product_scope: outcome.result.product_scope,
    relevant: outcome.result.relevant,
    confidence: outcome.result.confidence,
    effective_at: outcome.result.effective_time,
    reset_at: outcome.result.reset_time,
    title_en: outcome.result.title_en,
    title_zh: outcome.result.title_zh,
    summary_en: outcome.result.summary_en,
    summary_zh: outcome.result.summary_zh,
  };
}

const shadowEnabled = process.env.P0_LLM_SHADOW === '1';
const shadowDescribe = shadowEnabled ? describe : describe.skip;

shadowDescribe('P0 real LLM shadow validation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('classifies the bounded deployment-readiness sample without database writes', async () => {
    const env = {
      LLM_API_KEY: process.env.LLM_API_KEY,
      LLM_BASE_URL: process.env.LLM_BASE_URL || 'https://opencode.ai/zen/go/v1',
      LLM_MODEL: process.env.LLM_MODEL || 'mimo-v2.5',
      LLM_MAX_TOKENS: process.env.LLM_MAX_TOKENS || '2000',
    } as Env;
    const classifier = new LLMClassifier(env);
    const rows: Array<Record<string, unknown>> = [];

    for (const [index, sample] of SHADOW_SAMPLES.entries()) {
      const sourcePost = post(sample, index + 1);
      const outcome = await classifier.classify(sourcePost);
      rows.push({
        source_post_id: sourcePost.source_post_id,
        text: sourcePost.text,
        ...shadowResultFields(outcome),
        admitted: admission(outcome),
        result: assess(sample, outcome),
      });
    }

    const outputPath = process.env.P0_SHADOW_OUTPUT || '/tmp/tibo-p0-shadow.json';
    writeFileSync(outputPath, `${JSON.stringify({
      status: rows.every(row => row.result !== 'FAIL') ? 'PASS' : 'FAIL',
      provider: {
        base_url: env.LLM_BASE_URL,
        model: env.LLM_MODEL,
      },
      sample_count: rows.length,
      samples: rows,
      note: 'Read-only classifier calls. No Repository or D1 write path was invoked.',
    }, null, 2)}\n`);

    expect(rows).toHaveLength(SHADOW_SAMPLES.length);
    for (const row of rows) expect(row.result).not.toBe('FAIL');
  }, 300_000);
});
