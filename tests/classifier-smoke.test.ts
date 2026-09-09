import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const script = resolve(process.cwd(), 'scripts/check-classifier-capability.mjs');

describe('classifier capability smoke configuration', () => {
  it('has no fallback provider or model', () => {
    const source = readFileSync(script, 'utf8');
    expect(source).not.toContain('https://api.openai.com/v1');
    expect(source).not.toContain('gpt-4o-mini');
  });

  it.each(['LLM_API_KEY', 'LLM_BASE_URL', 'LLM_MODEL'])('fails closed before fetch when %s is missing', (missing) => {
    const environment = {
      ...process.env,
      LLM_API_KEY: 'TEST_ONLY_KEY',
      LLM_BASE_URL: 'https://staging.example.invalid/v1',
      LLM_MODEL: 'TEST_ONLY_MODEL',
    };
    delete environment[missing];

    const result = spawnSync(process.execPath, [script], {
      env: environment,
      encoding: 'utf8',
      timeout: 5_000,
    });
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;

    expect(result.status).toBe(2);
    expect(output).toContain('CLASSIFIER_SMOKE_BLOCKED_MISSING_CONFIGURATION');
    expect(output).toContain(missing);
    expect(output).not.toContain('TEST_ONLY_KEY');
    expect(output).not.toContain('TEST_ONLY_MODEL');
    expect(output).not.toContain('CLASSIFIER_SMOKE_FAILED');
  });
});
