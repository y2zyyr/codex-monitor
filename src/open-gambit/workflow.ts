import type { Env } from '../types';
import { gambitBudgetFromEnv, GambitRunBudget } from './budget';
import { canonicalJson, sha256Hex } from './canonical';
import { getGambitModelRoleConfig, providerForRole, type GambitProviderDiagnostic } from './llm';
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
  options: {
    binding?: WorkflowBindingLike;
    repository?: GambitRepository;
    providers?: Partial<Record<string, GambitLLMProvider>>;
    budget?: GambitRunBudget;
    /** Only local callers may explicitly opt into inline execution. */
    allowInlineFallback?: boolean;
  } = {},
): Promise<GambitWorkflowResult | { status: 'DISPATCHED'; workflowId: string; candidateId: number; deduplicated?: boolean }> {
  const workflowId = input.workflowId || workflowIdForCandidate(input.candidateId);
  const repository = options.repository ?? new GambitRepository(env.DB);
  const previous = await repository.getWorkflowResult(workflowId);
  if (previous) {
    if (previous.status === 'RUNNING') return { status: 'DISPATCHED', workflowId, candidateId: input.candidateId, deduplicated: true };
    return persistedWorkflowResult(workflowId, input.candidateId, previous);
  }
  if (options.binding) {
    const reserved = await repository.recordWorkflowStart({
      workflowId,
      candidateId: input.candidateId,
      startedAt: input.startedAt,
    });
    if (!reserved) return { status: 'DISPATCHED', workflowId, candidateId: input.candidateId, deduplicated: true };
    try {
      await options.binding.create({ id: workflowId, params: { ...input, workflowId } });
      return { status: 'DISPATCHED', workflowId, candidateId: input.candidateId };
    } catch (error) {
      const failed: GambitWorkflowResult = {
        workflowId,
        status: 'FAILED',
        candidateId: input.candidateId,
        reason: 'WORKFLOW_DISPATCH_FAILED',
      };
      await repository.recordWorkflowResult({
        workflowId,
        candidateId: input.candidateId,
        result: failed,
        resultHash: await workflowResultHash(failed),
        now: input.startedAt,
      });
      throw new Error('WORKFLOW_DISPATCH_FAILED');
    }
  }
  if (!options.allowInlineFallback || env.BUILD_ENVIRONMENT !== 'local') throw new Error('WORKFLOW_BINDING_UNAVAILABLE');
  const providers = options.providers ?? createConfiguredProviders(env);
  return runQualifiedGambitWorkflow({ ...input, workflowId }, {
    repository,
    providers,
    roles: getGambitModelRoleConfig(env),
    budget: options.budget ?? gambitBudgetFromEnv(env),
  });
}

function persistedWorkflowResult(
  workflowId: string,
  candidateId: number,
  previous: { status: string; articleId: number | null; revisionId: number | null; resultHash: string | null; reason?: string | null },
): GambitWorkflowResult {
  const status = previous.status === 'NO_GAMBIT'
    ? 'NO_GAMBIT'
    : previous.status === 'WAITING_FOR_REVIEW'
      ? 'WAITING_FOR_REVIEW'
      : previous.status === 'NEEDS_HUMAN_REVIEW'
        ? 'NEEDS_HUMAN_REVIEW'
        : previous.status === 'FAILED'
          ? 'FAILED'
          : 'COMPLETED';
  return {
    workflowId,
    status,
    candidateId,
    articleId: previous.articleId ?? undefined,
    revisionId: previous.revisionId ?? undefined,
    publicationDecision: status === 'COMPLETED'
      ? 'AUTO_PUBLISH_ELIGIBLE'
      : status === 'NO_GAMBIT' ? 'NO_GAMBIT_WORTH_PUBLISHING' : status === 'NEEDS_HUMAN_REVIEW' ? 'NEEDS_HUMAN_REVIEW' : undefined,
    reason: 'DUPLICATE_WORKFLOW_RESULT',
  };
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

export function createConfiguredProviders(
  env: Env,
  fetchImpl?: typeof fetch,
  onDiagnostic?: (diagnostic: GambitProviderDiagnostic) => void,
): Partial<Record<string, GambitLLMProvider>> {
  const providers: Partial<Record<string, GambitLLMProvider>> = {};
  for (const role of getGambitModelRoleConfig(env)) {
    const provider = providerForRole(role, env, fetchImpl, diagnostic => {
      // This is deliberately limited to operational metadata. Never log
      // credentials, prompts, response bodies, or model reasoning.
      console.info('[Open Gambit] provider_diagnostic', diagnostic);
      onDiagnostic?.(diagnostic);
    });
    if (provider) providers[role.role] = provider;
  }
  return providers;
}

export async function workflowResultHash(result: GambitWorkflowResult): Promise<string> {
  return sha256Hex(canonicalJson(result));
}
