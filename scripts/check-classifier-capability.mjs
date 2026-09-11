#!/usr/bin/env node

/**
 * Safe, provider-only classifier capability check.
 *
 * This intentionally does not construct a Repository, read source posts, or
 * write D1/R2/public events. Run it only against an explicitly selected
 * environment after a secret/deployment change.
 */

const requiredConfiguration = ['LLM_API_KEY', 'LLM_BASE_URL', 'LLM_MODEL'];
const missingConfiguration = requiredConfiguration.filter(name => !process.env[name]?.trim());

if (missingConfiguration.length > 0) {
  console.error(`CLASSIFIER_SMOKE_BLOCKED_MISSING_CONFIGURATION ${missingConfiguration.join(',')}`);
  process.exitCode = 2;
}

if (process.exitCode !== 2) {
  const apiKey = process.env.LLM_API_KEY.trim();
  const baseUrl = process.env.LLM_BASE_URL.trim().replace(/\/+$/, '');
  const model = process.env.LLM_MODEL.trim();
  const timeoutMs = 30_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        ...(new URL(baseUrl).origin === 'https://api.deepseek.com' ? { thinking: { type: 'disabled' } } : {}),
        response_format: { type: 'json_object' },
        temperature: 0,
        max_tokens: 32,
        messages: [
          { role: 'system', content: 'Return only strict JSON with the boolean field ok.' },
          { role: 'user', content: 'TEST_ONLY classifier capability check. Return {"ok":true}.' },
        ],
      }),
    });

    if (!response.ok) {
      const status = Number.isInteger(response.status) && response.status >= 100 && response.status <= 599
        ? response.status
        : 0;
      console.error(`CLASSIFIER_SMOKE_FAILED HTTP_${status || 'UNKNOWN'}`);
      process.exitCode = 1;
    } else {
      let payload;
      try {
        payload = await response.json();
      } catch {
        console.error('CLASSIFIER_SMOKE_FAILED INVALID_JSON_RESPONSE');
        process.exitCode = 1;
      }
      const content = payload?.choices?.[0]?.message?.content;
      if (process.exitCode !== 1) {
        try {
          const parsed = JSON.parse(typeof content === 'string' ? content : '');
          if (parsed?.ok !== true) throw new Error('invalid capability result');
          console.log('CLASSIFIER_SMOKE_PASS');
        } catch {
          console.error('CLASSIFIER_SMOKE_FAILED INVALID_STRUCTURED_RESPONSE');
          process.exitCode = 1;
        }
      }
    }
  } catch (error) {
    console.error(error?.name === 'AbortError' ? 'CLASSIFIER_SMOKE_FAILED TIMEOUT' : 'CLASSIFIER_SMOKE_FAILED NETWORK_ERROR');
    process.exitCode = 1;
  } finally {
    clearTimeout(timeout);
  }
}
