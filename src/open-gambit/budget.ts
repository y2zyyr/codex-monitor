import type { Env } from '../types';

export type GambitBudgetNamespace = 'gambit_llm' | 'gambit_translation' | 'gambit_search' | 'gambit_x' | 'gambit_github' | 'gambit_http';

export interface GambitBudgetLimits {
  maxLlmCalls: number;
  maxLlmTokens: number;
  /**
   * Translation completions get their own quota, deliberately separate from
   * `maxLlmCalls`/`maxLlmTokens`.
   *
   * Measured Phase 0 budget for the best case of one Workflow was 7 calls /
   * 17,400 tokens against a single ceiling of 8 calls / 18,000 tokens -- a 3.3%
   * token margin. One locale needing its (already implemented) corrective
   * second attempt costs 2,000 more and fails the whole publication with
   * GAMBIT_LLM_BUDGET_EXCEEDED, and an analysis re-sample (T2) costs 4,000 more.
   * Deep analysis and translation are sequential phases with independent,
   * independently bounded costs, so giving translation its own fail-closed
   * quota is the honest model: it stops analysis from squeezing translation
   * while keeping every number explicit and measurable. The analysis quota is
   * NOT reduced, so the worst case for the combined path is now
   * `maxLlmTokens + maxTranslationLlmTokens`.
   */
  maxTranslationLlmCalls: number;
  maxTranslationLlmTokens: number;
  maxSearchRequests: number;
  maxXRequests: number;
  maxGithubRequests: number;
  maxHttpRequests: number;
}

export interface GambitBudgetUsage {
  llmCalls: number;
  llmTokens: number;
  translationLlmCalls: number;
  translationLlmTokens: number;
  searchRequests: number;
  xRequests: number;
  githubRequests: number;
  httpRequests: number;
}

/** Per-run fail-closed budget. A fresh instance is created for every discovery/workflow run. */
export class GambitRunBudget {
  readonly limits: GambitBudgetLimits;
  readonly usage: GambitBudgetUsage = {
    llmCalls: 0,
    llmTokens: 0,
    translationLlmCalls: 0,
    translationLlmTokens: 0,
    searchRequests: 0,
    xRequests: 0,
    githubRequests: 0,
    httpRequests: 0,
  };

  constructor(limits: GambitBudgetLimits) {
    // Normalise every limit. A `NaN`/`undefined`/non-positive limit makes
    // `usage + n > limit` compare false, which silently turns a bounded quota
    // into an UNBOUNDED one -- the exact opposite of a fail-closed budget, and a
    // real risk here because `tsconfig` typechecks `src` only, so a stale object
    // literal in a test or a JS caller can omit a limit entirely. A missing limit
    // therefore resolves to its documented code default, never to "no limit".
    this.limits = normalizeBudgetLimits(limits);
  }

  consume(namespace: GambitBudgetNamespace, units = 1): boolean {
    const amount = Math.max(1, Math.floor(units));
    if (namespace === 'gambit_llm' || namespace === 'gambit_translation') {
      const translation = namespace === 'gambit_translation';
      const callKey = translation ? 'translationLlmCalls' as const : 'llmCalls' as const;
      const tokenKey = translation ? 'translationLlmTokens' as const : 'llmTokens' as const;
      const maxCalls = translation ? this.limits.maxTranslationLlmCalls : this.limits.maxLlmCalls;
      const maxTokens = translation ? this.limits.maxTranslationLlmTokens : this.limits.maxLlmTokens;
      if (this.usage[callKey] + 1 > maxCalls || this.usage[tokenKey] + amount > maxTokens) return false;
      this.usage[callKey] += 1;
      this.usage[tokenKey] += amount;
      return true;
    }
    const key = namespaceToUsageKey(namespace);
    const limit = namespaceToLimit(namespace, this.limits);
    if (this.usage[key] + amount > limit) return false;
    this.usage[key] += amount;
    return true;
  }

  remaining(namespace: GambitBudgetNamespace): number {
    if (namespace === 'gambit_llm') return Math.max(0, Math.min(this.limits.maxLlmCalls - this.usage.llmCalls, this.limits.maxLlmTokens - this.usage.llmTokens));
    if (namespace === 'gambit_translation') {
      return Math.max(0, Math.min(this.limits.maxTranslationLlmCalls - this.usage.translationLlmCalls, this.limits.maxTranslationLlmTokens - this.usage.translationLlmTokens));
    }
    return Math.max(0, namespaceToLimit(namespace, this.limits) - this.usage[namespaceToUsageKey(namespace)]);
  }
}

export function gambitBudgetFromEnv(env: Pick<Env, 'GAMBIT_MAX_LLM_CALLS_PER_RUN' | 'GAMBIT_MAX_LLM_TOKENS_PER_RUN' | 'GAMBIT_MAX_TRANSLATION_LLM_CALLS_PER_RUN' | 'GAMBIT_MAX_TRANSLATION_LLM_TOKENS_PER_RUN' | 'GAMBIT_MAX_SEARCH_REQUESTS_PER_RUN' | 'GAMBIT_MAX_X_REQUESTS_PER_RUN' | 'GAMBIT_MAX_GITHUB_REQUESTS_PER_RUN' | 'GAMBIT_MAX_HTTP_REQUESTS_PER_RUN' | 'GAMBIT_MAX_SOURCES_PER_RUN'>): GambitRunBudget {
  const httpDefault = bounded(env.GAMBIT_MAX_SOURCES_PER_RUN, 20, 1, 100);
  return new GambitRunBudget({
    maxLlmCalls: bounded(env.GAMBIT_MAX_LLM_CALLS_PER_RUN, 12, 1, 100),
    maxLlmTokens: bounded(env.GAMBIT_MAX_LLM_TOKENS_PER_RUN, 24_000, 1_000, 500_000),
    // Measured worst case for the translation phase of one Workflow: 4 locales
    // (zh/ja/fr/es) x 2 attempts (initial + the corrective retry) = 8 calls, at
    // the translation role's 4,000-token budget each = 32,000 tokens.
    //
    // This default is the fallback whenever `GAMBIT_MAX_TRANSLATION_LLM_TOKENS_PER_RUN`
    // is absent, so it must satisfy the same invariant the deployment configs do:
    //   quota >= locales x maxAttemptsPerLocale x roleBudget
    // It previously defaulted to 16,000 against a 2,000-token role budget, and
    // Phase 1.7 measured that pair as unusable (empty content on every locale).
    // Leaving 16,000 here while the role default became 4,000 would make the
    // quota fund only TWO locales (4,000 x 2 x 2 = 16,000), silently failing the
    // rest closed. The two must move together.
    maxTranslationLlmCalls: bounded(env.GAMBIT_MAX_TRANSLATION_LLM_CALLS_PER_RUN, 8, 1, 100),
    maxTranslationLlmTokens: bounded(env.GAMBIT_MAX_TRANSLATION_LLM_TOKENS_PER_RUN, 32_000, 1_000, 500_000),
    maxSearchRequests: bounded(env.GAMBIT_MAX_SEARCH_REQUESTS_PER_RUN, 6, 0, 100),
    maxXRequests: bounded(env.GAMBIT_MAX_X_REQUESTS_PER_RUN, 6, 0, 100),
    maxGithubRequests: bounded(env.GAMBIT_MAX_GITHUB_REQUESTS_PER_RUN, 6, 0, 100),
    maxHttpRequests: bounded(env.GAMBIT_MAX_HTTP_REQUESTS_PER_RUN, httpDefault, 1, 100),
  });
}

function namespaceToUsageKey(namespace: Exclude<GambitBudgetNamespace, 'gambit_llm' | 'gambit_translation'>): keyof GambitBudgetUsage {
  if (namespace === 'gambit_search') return 'searchRequests';
  if (namespace === 'gambit_x') return 'xRequests';
  if (namespace === 'gambit_github') return 'githubRequests';
  return 'httpRequests';
}

function namespaceToLimit(namespace: Exclude<GambitBudgetNamespace, 'gambit_llm' | 'gambit_translation'>, limits: GambitBudgetLimits): number {
  if (namespace === 'gambit_search') return limits.maxSearchRequests;
  if (namespace === 'gambit_x') return limits.maxXRequests;
  if (namespace === 'gambit_github') return limits.maxGithubRequests;
  return limits.maxHttpRequests;
}

function bounded(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.floor(parsed))) : fallback;
}

/**
 * Fill in any missing or non-positive limit with its documented code default.
 * See the constructor for why this must never resolve to "unbounded".
 */
function normalizeBudgetLimits(limits: GambitBudgetLimits): GambitBudgetLimits {
  return {
    maxLlmCalls: positiveLimit(limits.maxLlmCalls, 12),
    maxLlmTokens: positiveLimit(limits.maxLlmTokens, 24_000),
    maxTranslationLlmCalls: positiveLimit(limits.maxTranslationLlmCalls, 8),
    maxTranslationLlmTokens: positiveLimit(limits.maxTranslationLlmTokens, 32_000),
    maxSearchRequests: positiveLimit(limits.maxSearchRequests, 6),
    maxXRequests: positiveLimit(limits.maxXRequests, 6),
    maxGithubRequests: positiveLimit(limits.maxGithubRequests, 6),
    maxHttpRequests: positiveLimit(limits.maxHttpRequests, 20),
  };
}

function positiveLimit(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}
