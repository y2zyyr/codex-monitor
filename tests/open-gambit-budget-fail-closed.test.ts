import { describe, expect, it } from 'vitest';
import { gambitBudgetFromEnv, GambitRunBudget, type GambitBudgetLimits, type GambitBudgetNamespace } from '../src/open-gambit/budget';
import { getGambitModelRoleConfig, providerForRole } from '../src/open-gambit/llm';
import {
  getXApiDailyLimit,
  getXApiPollIntervalMinutes,
  shouldRunXApiSync,
} from '../src/utils/schedule';
import {
  getWebSearchDailyLimit,
  getWebSearchActiveModeDailyLimit,
  getNormalSearchIntervalHours,
} from '../src/utils/search-schedule';

/**
 * Open Gambit — Phase 1.5 T3: fail-open audit across budgets and bounded numerics.
 *
 * The defect class: an omitted or non-finite bound makes a comparison such as
 * `usage + n > undefined` or `attempt < NaN` evaluate false, so a bounded
 * resource silently becomes UNBOUNDED (or, for an attempt counter, becomes
 * ZERO ATTEMPTS). `tsconfig` typechecks `src` only, so any test file or JS
 * caller can omit a field without a compile error.
 *
 * Phase 1 fixed exactly one instance (`gambit_translation`). This suite pins
 * every Gambit budget namespace and the Tibo schedule bounds so the class
 * cannot come back through a different namespace.
 */

const ALL_NAMESPACES: GambitBudgetNamespace[] = [
  'gambit_llm',
  'gambit_translation',
  'gambit_search',
  'gambit_x',
  'gambit_github',
  'gambit_http',
];

describe('T3 fail-open audit: every Gambit budget namespace is fail-closed', () => {
  it('normalises an entirely empty limits object to documented defaults', () => {
    // The worst case: a JS caller or a stale literal supplies nothing at all.
    const budget = new GambitRunBudget({} as GambitBudgetLimits);

    // No limit may be undefined/NaN/Infinity/non-positive.
    for (const [name, value] of Object.entries(budget.limits)) {
      expect(Number.isFinite(value), `${name} must be finite, got ${value}`).toBe(true);
      expect(value, `${name} must be positive, got ${value}`).toBeGreaterThan(0);
    }

    // And the documented code defaults are what actually landed.
    expect(budget.limits).toEqual({
      maxLlmCalls: 12,
      maxLlmTokens: 24_000,
      maxTranslationLlmCalls: 8,
      maxTranslationLlmTokens: 16_000,
      maxSearchRequests: 6,
      maxXRequests: 6,
      maxGithubRequests: 6,
      maxHttpRequests: 20,
    });
  });

  it('never turns a missing limit into an unbounded quota, per namespace', () => {
    // Each namespace is bounded on its own, with every OTHER limit omitted.
    // Before the Phase 1 fix, an omitted limit meant `usage + n > undefined`,
    // which is always false, so the namespace accepted unlimited consumption.
    const perNamespace: Array<[GambitBudgetNamespace, string]> = [
      ['gambit_search', 'maxSearchRequests'],
      ['gambit_x', 'maxXRequests'],
      ['gambit_github', 'maxGithubRequests'],
      ['gambit_http', 'maxHttpRequests'],
    ];

    for (const [namespace, limitKey] of perNamespace) {
      const budget = new GambitRunBudget({} as GambitBudgetLimits);
      const limit = (budget.limits as unknown as Record<string, number>)[limitKey];
      expect(Number.isFinite(limit), `${limitKey} must be finite`).toBe(true);
      // The quota must be exactly exhausted after `limit` units, never more.
      for (let spent = 0; spent < limit; spent += 1) {
        expect(budget.consume(namespace), `${namespace} rejected at ${spent}/${limit}`).toBe(true);
      }
      expect(budget.consume(namespace), `${namespace} must fail closed past its limit`).toBe(false);
      const usageKey = {
        gambit_search: 'searchRequests',
        gambit_x: 'xRequests',
        gambit_github: 'githubRequests',
        gambit_http: 'httpRequests',
      }[namespace as 'gambit_search' | 'gambit_x' | 'gambit_github' | 'gambit_http'];
      expect(budget.usage[usageKey]).toBe(limit);
    }
  });

  it('treats NaN, zero, negative and Infinity limits as the documented default', () => {
    const invalidValues = [Number.NaN, 0, -5, Number.POSITIVE_INFINITY] as const;

    for (const invalid of invalidValues) {
      const budget = new GambitRunBudget({
        maxLlmCalls: invalid,
        maxLlmTokens: invalid,
        maxTranslationLlmCalls: invalid,
        maxTranslationLlmTokens: invalid,
        maxSearchRequests: invalid,
        maxXRequests: invalid,
        maxGithubRequests: invalid,
        maxHttpRequests: invalid,
      } as GambitBudgetLimits);

      for (const [name, value] of Object.entries(budget.limits)) {
        expect(Number.isFinite(value), `${name} with input ${invalid} -> ${value}`).toBe(true);
        expect(value, `${name} with input ${invalid} must be positive`).toBeGreaterThan(0);
      }
    }
  });

  it('bounds a quota supplied by a malformed environment variable', () => {
    const budget = gambitBudgetFromEnv({
      GAMBIT_MAX_LLM_CALLS_PER_RUN: 'not-a-number',
      GAMBIT_MAX_LLM_TOKENS_PER_RUN: '',
      GAMBIT_MAX_TRANSLATION_LLM_CALLS_PER_RUN: undefined,
      GAMBIT_MAX_TRANSLATION_LLM_TOKENS_PER_RUN: '-1',
      GAMBIT_MAX_SEARCH_REQUESTS_PER_RUN: 'NaN',
      GAMBIT_MAX_X_REQUESTS_PER_RUN: 'Infinity',
      GAMBIT_MAX_GITHUB_REQUESTS_PER_RUN: '1e999',
      GAMBIT_MAX_HTTP_REQUESTS_PER_RUN: '0',
      GAMBIT_MAX_SOURCES_PER_RUN: 'oops',
    });

    for (const [name, value] of Object.entries(budget.limits)) {
      expect(Number.isFinite(value), `${name} must be finite, got ${value}`).toBe(true);
      expect(value, `${name} must be positive, got ${value}`).toBeGreaterThan(0);
    }
    // `bounded()` clamps into [min, max]. An empty string parses to 0 and is
    // therefore lifted to the documented minimum (1,000), which is still a
    // finite, non-zero bound -- the property that matters here.
    expect(budget.limits.maxLlmCalls).toBe(12);
    expect(budget.limits.maxLlmTokens).toBe(1_000);
    expect(budget.limits.maxTranslationLlmTokens).toBe(1_000);
    expect(budget.limits.maxHttpRequests).toBeGreaterThanOrEqual(1);
  });

  it('keeps every namespace bounded when only one limit is supplied', () => {
    // The realistic regression: someone adds a new namespace and provides only
    // its limit in a test literal, leaving the rest undefined.
    const budget = new GambitRunBudget({ maxSearchRequests: 3 } as GambitBudgetLimits);
    expect(budget.consume('gambit_search')).toBe(true);
    expect(budget.consume('gambit_search')).toBe(true);
    expect(budget.consume('gambit_search')).toBe(true);
    expect(budget.consume('gambit_search')).toBe(false);
    // The omitted namespaces fall back to their defaults, not to unbounded.
    expect(budget.remaining('gambit_http')).toBe(20);
    expect(budget.remaining('gambit_x')).toBe(6);
    expect(budget.remaining('gambit_github')).toBe(6);
    expect(budget.remaining('gambit_llm')).toBe(12);
    expect(budget.remaining('gambit_translation')).toBe(8);
  });

  it('reports finite remaining() for every namespace on a default budget', () => {
    const budget = new GambitRunBudget({} as GambitBudgetLimits);
    for (const namespace of ALL_NAMESPACES) {
      const remaining = budget.remaining(namespace);
      expect(Number.isFinite(remaining), `${namespace} remaining must be finite`).toBe(true);
      expect(remaining, `${namespace} remaining must be non-negative`).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('T3 fail-open audit: bounded numeric fields in the LLM client', () => {
  it('still attempts the request when retryLimit is omitted', async () => {
    // MEASURED DEFECT (Phase 1.5): `Math.min(2, Math.max(1, undefined + 1))`
    // is NaN, and `for (let attempt = 0; attempt < NaN; ...)` never runs. The
    // loop body is the ONLY place that emits diagnostics and performs fetch, so
    // an omitted retryLimit produced zero network calls, zero diagnostics, and
    // a bare `provider_error` -- a silent no-op that reads as a provider fault.
    // A bounded numeric field must degrade to the documented default (one
    // attempt), never to no attempts at all.
    const roles = getGambitModelRoleConfig({
      GAMBIT_MODEL_ROLES_JSON: JSON.stringify({ triage: { timeoutMs: 1_000, tokenBudget: 900 } }),
      GAMBIT_LLM_MODEL: 'TEST_ONLY_RUNTIME_MODEL',
      GAMBIT_LLM_PROVIDER: 'TEST_ONLY_PROVIDER',
    });
    const triageRole = roles.find(role => role.role === 'triage')!;

    let fetchCalls = 0;
    const diagnosticPhases: string[] = [];
    const provider = providerForRole(triageRole, {
      GAMBIT_LLM_API_KEY: 'TEST_ONLY_KEY',
      GAMBIT_LLM_BASE_URL: 'https://test-only.invalid',
    }, (async () => {
      fetchCalls += 1;
      throw new Error('TEST_ONLY transport failure');
    }) as unknown as typeof fetch, diagnostic => diagnosticPhases.push(diagnostic.phase))!;
    expect(provider).toBeTruthy();

    await expect(provider.complete({
      role: 'triage',
      schemaName: 'GambitTriageV1',
      system: 'TEST_ONLY system',
      user: 'TEST_ONLY user',
      tokenBudget: 900,
      timeoutMs: 1_000,
      // retryLimit intentionally OMITTED: simulate a JS caller or stale literal.
    } as never)).rejects.toThrow();

    expect(fetchCalls, 'the request must actually be attempted').toBeGreaterThanOrEqual(1);
    expect(diagnosticPhases, 'a failure must be diagnosable').toContain('NETWORK');
  });

  it('reads retryLimit as a RETRY count, so retryLimit=1 spends two attempts', async () => {
    // Guard against the off-by-one that an early revision of this fix
    // introduced: normalising `retryLimit` into the attempt budget degraded it
    // by one, silently removing the retry the role config asks for. A 429 is
    // retryable, so retryLimit=1 must produce exactly two attempts.
    const roles = getGambitModelRoleConfig({
      GAMBIT_MODEL_ROLES_JSON: JSON.stringify({ triage: { timeoutMs: 1_000, tokenBudget: 900 } }),
      GAMBIT_LLM_MODEL: 'TEST_ONLY_RUNTIME_MODEL',
      GAMBIT_LLM_PROVIDER: 'TEST_ONLY_PROVIDER',
    });
    const triageRole = roles.find(role => role.role === 'triage')!;

    let fetchCalls = 0;
    const provider = providerForRole(triageRole, {
      GAMBIT_LLM_API_KEY: 'TEST_ONLY_KEY',
      GAMBIT_LLM_BASE_URL: 'https://test-only.invalid',
    }, (async () => {
      fetchCalls += 1;
      if (fetchCalls === 1) {
        return new Response(JSON.stringify({ type: 'rate_limit_exceeded' }), {
          status: 429,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch)!;

    const result = await provider.complete<{ ok: boolean }>({
      role: 'triage',
      schemaName: 'GambitTriageV1',
      system: 'TEST_ONLY system',
      user: 'TEST_ONLY user',
      tokenBudget: 900,
      timeoutMs: 1_000,
      retryLimit: 1,
    });

    expect(fetchCalls).toBe(2);
    expect(result.value).toEqual({ ok: true });
  });

  it('never spends more than one retry, even if retryLimit is absurd', async () => {
    const roles = getGambitModelRoleConfig({
      GAMBIT_MODEL_ROLES_JSON: JSON.stringify({ triage: { timeoutMs: 1_000, tokenBudget: 900 } }),
      GAMBIT_LLM_MODEL: 'TEST_ONLY_RUNTIME_MODEL',
      GAMBIT_LLM_PROVIDER: 'TEST_ONLY_PROVIDER',
    });
    const triageRole = roles.find(role => role.role === 'triage')!;

    let fetchCalls = 0;
    const provider = providerForRole(triageRole, {
      GAMBIT_LLM_API_KEY: 'TEST_ONLY_KEY',
      GAMBIT_LLM_BASE_URL: 'https://test-only.invalid',
    }, (async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify({ type: 'rate_limit_exceeded' }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch)!;

    await expect(provider.complete({
      role: 'triage',
      schemaName: 'GambitTriageV1',
      system: 'TEST_ONLY system',
      user: 'TEST_ONLY user',
      tokenBudget: 900,
      timeoutMs: 1_000,
      retryLimit: 100,
    } as never)).rejects.toThrow();

    // The transport bound stays 2 total attempts: the retry budget must never
    // widen into a cost amplifier.
    expect(fetchCalls).toBe(2);
  });
});

describe('T3 fail-open audit: Tibo schedule budgets are fail-closed', () => {
  it('never yields a non-finite X API daily limit', () => {
    for (const raw of ['abc', '', 'NaN', 'Infinity', '-1', '1e999', undefined]) {
      const limit = getXApiDailyLimit({ X_API_DAILY_LIMIT: raw } as never);
      expect(Number.isFinite(limit), `X_API_DAILY_LIMIT=${raw} -> ${limit}`).toBe(true);
      expect(limit).toBeGreaterThanOrEqual(0);
    }
  });

  it('never yields a non-finite X API poll interval', () => {
    for (const raw of ['abc', '', 'NaN', '-30', undefined]) {
      const interval = getXApiPollIntervalMinutes({ X_API_POLL_INTERVAL_MINUTES: raw } as never);
      expect(Number.isFinite(interval)).toBe(true);
      expect(interval).toBeGreaterThan(0);
    }
  });

  it('never yields a non-finite web search daily limit', () => {
    for (const raw of ['abc', '', 'NaN', 'Infinity', '-4', undefined]) {
      const normal = getWebSearchDailyLimit({ MAX_WEB_SEARCH_REQUESTS_PER_DAY: raw } as never);
      const active = getWebSearchActiveModeDailyLimit({ WEB_SEARCH_ACTIVE_MODE_DAILY_LIMIT: raw } as never);
      expect(Number.isFinite(normal), `normal limit from ${raw}`).toBe(true);
      expect(Number.isFinite(active), `active limit from ${raw}`).toBe(true);
      expect(normal).toBeGreaterThanOrEqual(0);
      expect(active).toBeGreaterThanOrEqual(0);
    }
  });

  it('never yields a non-finite normal search interval', () => {
    for (const raw of ['abc', '', 'NaN', '0', '-3', undefined]) {
      const hours = getNormalSearchIntervalHours({ NORMAL_SEARCH_INTERVAL_HOURS: raw } as never);
      expect(Number.isFinite(hours)).toBe(true);
      expect(hours).toBeGreaterThan(0);
    }
  });

  it('fails closed to disabled when the X API daily limit is unparseable-zero', () => {
    // A zero limit must disable the run, not allow it: `usage >= 0` is always
    // true, so the comparison direction matters and is pinned here.
    const decision = shouldRunXApiSync(
      new Date('2026-09-11T12:00:00.000Z'),
      null,
      { X_API_DAILY_LIMIT: '0' } as never,
    );
    expect(decision.allowed).toBe(false);
    expect(decision.dailyLimit).toBe(0);
    expect(Number.isFinite(decision.dailyLimit)).toBe(true);
  });
});
