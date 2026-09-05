import type { Env } from '../types';
import { gambitBudgetFromEnv, GambitRunBudget } from './budget';
import { canonicalJson, sha256Hex } from './canonical';
import { getGambitModelRoleConfig, providerForRole } from './llm';
import { GambitRepository } from './repository';
import { runQualifiedGambitWorkflow } from './pipeline';
import type { GambitLLMProvider, GambitWorkflowInput, GambitWorkflowResult } from './types';

export interface WorkflowStepLike {
  do<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

export interface WorkflowBindingLike {
  create(options: { id: string; params: GambitWorkflowInput }): Promise<{ id?: string; status?: string }>;
}

export const OPEN_GAMBIT_WORKFLOW_NAME = 'gambit-analysis';

export const OPEN_GAMBIT_WORKFLOW_STEPS = [
  'bounded-evidence-load',
  'qualified-analysis',
  'independent-critic',
  'forecast-validation',
  'deterministic-publication-gate',
  'auto-publish-or-exceptional-review',
] as const;

export function workflowIdForCandidate(candidateId: number): string {
  return `gambit-analysis-candidate-${candidateId}`;
}

export async function dispatchQualifiedGambit(
  input: GambitWorkflowInput,
  env: Env,
  options: { binding?: WorkflowBindingLike; repository?: GambitRepository; providers?: Partial<Record<string, GambitLLMProvider>>; budget?: GambitRunBudget } = {},
): Promise<GambitWorkflowResult | { status: 'DISPATCHED'; workflowId: string; candidateId: number }> {
  const workflowId = input.workflowId || workflowIdForCandidate(input.candidateId);
  if (options.binding) {
    await options.binding.create({ id: workflowId, params: { ...input, workflowId } });
    return { status: 'DISPATCHED', workflowId, candidateId: input.candidateId };
  }
  const repository = options.repository ?? new GambitRepository(env.DB);
  const providers = options.providers ?? createConfiguredProviders(env);
  return runQualifiedGambitWorkflow({ ...input, workflowId }, {
    repository,
    providers,
    roles: getGambitModelRoleConfig(env),
    budget: options.budget ?? gambitBudgetFromEnv(env),
  });
}

/**
 * The class exposes the same payload/stage boundaries that a Cloudflare
 * Workflow binding uses. It is intentionally dependency-injected so the same
 * orchestration runs in local tests without creating a remote Workflow.
 */
/** Runs the Workflow payload locally with a small injectable step emulator. */
export async function runLocalGambitWorkflow(
  env: Env,
  payload: GambitWorkflowInput,
  step?: WorkflowStepLike,
): Promise<GambitWorkflowResult> {
  const execute = async (): Promise<GambitWorkflowResult> => runQualifiedGambitWorkflow(payload, {
    repository: new GambitRepository(env.DB),
    providers: createConfiguredProviders(env),
    roles: getGambitModelRoleConfig(env),
    budget: gambitBudgetFromEnv(env),
  });
  return step ? step.do('qualified-analysis-critic-and-publication-gate', execute) : execute();
}

export function createConfiguredProviders(env: Env, fetchImpl?: typeof fetch): Partial<Record<string, GambitLLMProvider>> {
  const providers: Partial<Record<string, GambitLLMProvider>> = {};
  for (const role of getGambitModelRoleConfig(env)) {
    const provider = providerForRole(role, env, fetchImpl);
    if (provider) providers[role.role] = provider;
  }
  return providers;
}

export async function workflowResultHash(result: GambitWorkflowResult): Promise<string> {
  return sha256Hex(canonicalJson(result));
}
