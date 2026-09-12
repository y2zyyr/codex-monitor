import { describe, expect, it } from 'vitest';
import { gambitBudgetFromEnv, GambitRunBudget, type GambitBudgetLimits, type GambitBudgetNamespace } from '../src/open-gambit/budget';
import { getGambitModelRoleConfig, providerForRole } from '../src/open-gambit/llm';
import {
  DEFAULT_X_API_DAILY_LIMIT,
  DEFAULT_X_API_POLL_INTERVAL_MINUTES,
  getXApiDailyLimit,
  getXApiPollIntervalMinutes,
  shouldRunXApiSync,
} from '../src/utils/schedule';
import {
  DEFAULT_NORMAL_SEARCH_INTERVAL_HOURS,
  DEFAULT_WEB_SEARCH_ACTIVE_MODE_DAILY_LIMIT,
  DEFAULT_WEB_SEARCH_DAILY_LIMIT,
  getWebSearchDailyLimit,
  getWebSearchActiveModeDailyLimit,
  getNormalSearchIntervalHours,
} from '../src/utils/search-schedule';
import { expectFailClosedBound, expectFailClosedZeroableBound, JSON_SAFE_DEFAULT_INPUTS, JSON_SAFE_RANGE_INPUTS } from './helpers/fail-closed-bounds';

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
      maxTranslationLlmTokens: 32_000,
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
    // `Math.max(0, ...)`: a zero limit is the documented "disabled" value, so it
    // is valid here rather than a fail-open defect.
    expectFailClosedZeroableBound(
      'X_API_DAILY_LIMIT',
      raw => getXApiDailyLimit({ X_API_DAILY_LIMIT: raw } as never),
      { documentedDefault: DEFAULT_X_API_DAILY_LIMIT, stringInputsOnly: true },
    );
  });

  it('never yields a non-finite X API poll interval', () => {
    expectFailClosedBound(
      'X_API_POLL_INTERVAL_MINUTES',
      raw => getXApiPollIntervalMinutes({ X_API_POLL_INTERVAL_MINUTES: raw } as never),
      { documentedDefault: DEFAULT_X_API_POLL_INTERVAL_MINUTES, stringInputsOnly: true },
    );
  });

  it('never yields a non-finite web search daily limit', () => {
    expectFailClosedZeroableBound(
      'MAX_WEB_SEARCH_REQUESTS_PER_DAY',
      raw => getWebSearchDailyLimit({ MAX_WEB_SEARCH_REQUESTS_PER_DAY: raw } as never),
      { documentedDefault: DEFAULT_WEB_SEARCH_DAILY_LIMIT, stringInputsOnly: true },
    );
    expectFailClosedZeroableBound(
      'WEB_SEARCH_ACTIVE_MODE_DAILY_LIMIT',
      raw => getWebSearchActiveModeDailyLimit({ WEB_SEARCH_ACTIVE_MODE_DAILY_LIMIT: raw } as never),
      { documentedDefault: DEFAULT_WEB_SEARCH_ACTIVE_MODE_DAILY_LIMIT, stringInputsOnly: true },
    );
  });

  it('never yields a non-finite normal search interval', () => {
    expectFailClosedBound(
      'NORMAL_SEARCH_INTERVAL_HOURS',
      raw => getNormalSearchIntervalHours({ NORMAL_SEARCH_INTERVAL_HOURS: raw } as never),
      { documentedDefault: DEFAULT_NORMAL_SEARCH_INTERVAL_HOURS, stringInputsOnly: true },
    );
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

/**
 * Phase 1.6 T4: the same defect class, now asserted through the shared helper
 * for the two producer shapes that Phase 1.5 audited by hand — the role config's
 * `boundedNumber` fields and the budget namespace resolvers.
 *
 * `tokenBudget` is the field N6 was about. Its resolver clamps to a hard ceiling
 * of 8,000, so an over-ask is silently LOWERED rather than rejected: a config
 * change that asks for more than the ceiling would otherwise look applied while
 * measuring something else. The ceiling is pinned here so that raising it is a
 * deliberate, visible act.
 */
describe('Phase 1.6 T4: role-config and budget bounds go through the shared helper', () => {
  const TEST_ONLY_ENV = { GAMBIT_LLM_MODEL: 'TEST_ONLY_RUNTIME_MODEL', GAMBIT_LLM_PROVIDER: 'TEST_ONLY_PROVIDER' };

  /** Resolve one role after overriding a single field. */
  function resolveRole(roleName: string, field: string, raw: unknown) {
    const roles = getGambitModelRoleConfig({
      ...TEST_ONLY_ENV,
      GAMBIT_MODEL_ROLES_JSON: JSON.stringify({ [roleName]: { [field]: raw } }),
    });
    return roles.find(role => role.role === roleName)!;
  }

  const BASELINE_ROLES = getGambitModelRoleConfig({ ...TEST_ONLY_ENV, GAMBIT_MODEL_ROLES_JSON: '{}' });

  /**
   * Every role field below is reached through `GAMBIT_MODEL_ROLES_JSON`, so the
   * input has to survive `JSON.stringify` — see `JSON_SAFE_DEFAULT_INPUTS`.
   */
  const JSON_INPUTS = {
    defaultInputs: JSON_SAFE_DEFAULT_INPUTS,
    rangeInputs: JSON_SAFE_RANGE_INPUTS,
  };

  it('clamps the role tokenBudget ceiling at 8,000 and never fails open', () => {
    for (const baseline of BASELINE_ROLES) {
      expectFailClosedBound(
        `${baseline.role}.tokenBudget`,
        raw => resolveRole(baseline.role, 'tokenBudget', raw).tokenBudget,
        { documentedDefault: baseline.tokenBudget, ...JSON_INPUTS },
      );
    }
    // The ceiling is a deliberate clamp, not a fail-open: an over-ask lands on
    // the ceiling instead of on Infinity.
    expect(resolveRole('gambit_analysis', 'tokenBudget', 1_000_000).tokenBudget).toBe(8_000);
    expect(resolveRole('gambit_analysis', 'tokenBudget', 8_000).tokenBudget).toBe(8_000);
  });

  it('keeps timeoutMs bounded per role, with the wider translation deadline', () => {
    for (const baseline of BASELINE_ROLES) {
      expectFailClosedBound(
        `${baseline.role}.timeoutMs`,
        raw => resolveRole(baseline.role, 'timeoutMs', raw).timeoutMs,
        { documentedDefault: baseline.timeoutMs, ...JSON_INPUTS },
      );
    }
    // A request deadline has no "0 means disabled" reading: 0 must be lifted to
    // the 500 ms floor rather than becoming an instant abort.
    expect(resolveRole('triage', 'timeoutMs', 0).timeoutMs).toBe(500);
    // translation may legitimately run longer than the other roles.
    expect(resolveRole('translation', 'timeoutMs', 1_000_000).timeoutMs).toBe(60_000);
    expect(resolveRole('triage', 'timeoutMs', 1_000_000).timeoutMs).toBe(30_000);
  });

  it('keeps retryLimit bounded, zeroable, and below the transport amplifier cap', () => {
    for (const baseline of BASELINE_ROLES) {
      // retryLimit=0 (no retry) is meaningful, so zero must survive.
      expectFailClosedZeroableBound(
        `${baseline.role}.retryLimit`,
        raw => resolveRole(baseline.role, 'retryLimit', raw).retryLimit,
        { documentedDefault: baseline.retryLimit, ...JSON_INPUTS },
      );
      expect(resolveRole(baseline.role, 'retryLimit', 0).retryLimit).toBe(0);
    }
    expect(resolveRole('triage', 'retryLimit', 99).retryLimit).toBe(2);
  });

  it('normalises every budget namespace resolver to its documented default', () => {
    const documentedDefaults: Array<[keyof GambitBudgetLimits, number, boolean]> = [
      ['maxLlmCalls', 12, false],
      ['maxLlmTokens', 24_000, false],
      ['maxTranslationLlmCalls', 8, false],
      ['maxTranslationLlmTokens', 32_000, false],
      ['maxSearchRequests', 6, false],
      ['maxXRequests', 6, false],
      ['maxGithubRequests', 6, false],
      ['maxHttpRequests', 20, false],
    ];
    for (const [field, documentedDefault, zeroable] of documentedDefaults) {
      const resolve = (raw: unknown) => (new GambitRunBudget({ [field]: raw } as GambitBudgetLimits).limits)[field];
      expectFailClosedBound(`GambitRunBudget.${field}`, resolve, { documentedDefault, zeroIsValid: zeroable });
    }
  });

  it('normalises every budget environment variable to its documented default', () => {
    const envDefaults: Array<[string, string, number, boolean]> = [
      ['GAMBIT_MAX_LLM_CALLS_PER_RUN', 'maxLlmCalls', 12, false],
      ['GAMBIT_MAX_LLM_TOKENS_PER_RUN', 'maxLlmTokens', 24_000, false],
      ['GAMBIT_MAX_TRANSLATION_LLM_CALLS_PER_RUN', 'maxTranslationLlmCalls', 8, false],
      ['GAMBIT_MAX_TRANSLATION_LLM_TOKENS_PER_RUN', 'maxTranslationLlmTokens', 32_000, false],
      ['GAMBIT_MAX_SEARCH_REQUESTS_PER_RUN', 'maxSearchRequests', 6, false],
      ['GAMBIT_MAX_X_REQUESTS_PER_RUN', 'maxXRequests', 6, false],
      ['GAMBIT_MAX_GITHUB_REQUESTS_PER_RUN', 'maxGithubRequests', 6, false],
      ['GAMBIT_MAX_HTTP_REQUESTS_PER_RUN', 'maxHttpRequests', 20, false],
    ];
    for (const [envName, field, documentedDefault, zeroable] of envDefaults) {
      const resolve = (raw: unknown) =>
        (gambitBudgetFromEnv({ [envName]: raw } as never).limits)[field as keyof GambitBudgetLimits];
      expectFailClosedBound(`env ${envName}`, resolve, { documentedDefault, zeroIsValid: zeroable });
    }
  });
});
