import type { Env } from '../types';

export type GambitBudgetNamespace = 'gambit_llm' | 'gambit_search' | 'gambit_x' | 'gambit_github' | 'gambit_http';

export interface GambitBudgetLimits {
  maxLlmCalls: number;
  maxLlmTokens: number;
  maxSearchRequests: number;
  maxXRequests: number;
  maxGithubRequests: number;
  maxHttpRequests: number;
}

export interface GambitBudgetUsage {
  llmCalls: number;
  llmTokens: number;
  searchRequests: number;
  xRequests: number;
  githubRequests: number;
  httpRequests: number;
}

/** Per-run fail-closed budget. A fresh instance is created for every discovery/workflow run. */
export class GambitRunBudget {
  readonly usage: GambitBudgetUsage = {
    llmCalls: 0,
    llmTokens: 0,
    searchRequests: 0,
    xRequests: 0,
    githubRequests: 0,
    httpRequests: 0,
  };

  constructor(readonly limits: GambitBudgetLimits) {}

  consume(namespace: GambitBudgetNamespace, units = 1): boolean {
    const amount = Math.max(1, Math.floor(units));
    if (namespace === 'gambit_llm') {
      if (this.usage.llmCalls + 1 > this.limits.maxLlmCalls || this.usage.llmTokens + amount > this.limits.maxLlmTokens) return false;
      this.usage.llmCalls += 1;
      this.usage.llmTokens += amount;
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
    return Math.max(0, namespaceToLimit(namespace, this.limits) - this.usage[namespaceToUsageKey(namespace)]);
  }
}

export function gambitBudgetFromEnv(env: Pick<Env, 'GAMBIT_MAX_LLM_CALLS_PER_RUN' | 'GAMBIT_MAX_LLM_TOKENS_PER_RUN' | 'GAMBIT_MAX_SEARCH_REQUESTS_PER_RUN' | 'GAMBIT_MAX_X_REQUESTS_PER_RUN' | 'GAMBIT_MAX_GITHUB_REQUESTS_PER_RUN' | 'GAMBIT_MAX_HTTP_REQUESTS_PER_RUN' | 'GAMBIT_MAX_SOURCES_PER_RUN'>): GambitRunBudget {
  const httpDefault = bounded(env.GAMBIT_MAX_SOURCES_PER_RUN, 20, 1, 100);
  return new GambitRunBudget({
    maxLlmCalls: bounded(env.GAMBIT_MAX_LLM_CALLS_PER_RUN, 12, 1, 100),
    maxLlmTokens: bounded(env.GAMBIT_MAX_LLM_TOKENS_PER_RUN, 24_000, 1_000, 500_000),
    maxSearchRequests: bounded(env.GAMBIT_MAX_SEARCH_REQUESTS_PER_RUN, 6, 0, 100),
    maxXRequests: bounded(env.GAMBIT_MAX_X_REQUESTS_PER_RUN, 6, 0, 100),
    maxGithubRequests: bounded(env.GAMBIT_MAX_GITHUB_REQUESTS_PER_RUN, 6, 0, 100),
    maxHttpRequests: bounded(env.GAMBIT_MAX_HTTP_REQUESTS_PER_RUN, httpDefault, 1, 100),
  });
}

function namespaceToUsageKey(namespace: Exclude<GambitBudgetNamespace, 'gambit_llm'>): keyof GambitBudgetUsage {
  if (namespace === 'gambit_search') return 'searchRequests';
  if (namespace === 'gambit_x') return 'xRequests';
  if (namespace === 'gambit_github') return 'githubRequests';
  return 'httpRequests';
}

function namespaceToLimit(namespace: Exclude<GambitBudgetNamespace, 'gambit_llm'>, limits: GambitBudgetLimits): number {
  if (namespace === 'gambit_search') return limits.maxSearchRequests;
  if (namespace === 'gambit_x') return limits.maxXRequests;
  if (namespace === 'gambit_github') return limits.maxGithubRequests;
  return limits.maxHttpRequests;
}

function bounded(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.floor(parsed))) : fallback;
}
