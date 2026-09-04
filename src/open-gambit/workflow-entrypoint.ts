import { WorkflowEntrypoint } from 'cloudflare:workers';
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import type { Env } from '../types';
import { gambitBudgetFromEnv } from './budget';
import { GambitProviderError, getGambitModelRoleConfig } from './llm';
import { GambitRepository } from './repository';
import { runQualifiedGambitWorkflow } from './pipeline';
import { createConfiguredProviders } from './workflow';
import type { GambitWorkflowInput, GambitWorkflowResult } from './types';

/** Cloudflare Workflow entrypoint; local code uses runLocalGambitWorkflow. */
export class OpenGambitAnalysisWorkflow extends WorkflowEntrypoint<Env, GambitWorkflowInput> {
  async run(event: Readonly<WorkflowEvent<GambitWorkflowInput>>, step: WorkflowStep): Promise<GambitWorkflowResult> {
    if (this.env.BUILD_ENVIRONMENT === 'staging' && event.payload.candidateId === 0) {
      return step.do('staging-provider-diagnostic', { retries: { limit: 0, delay: '1 second' }, timeout: '1 minute' }, async () => {
        const provider = createConfiguredProviders(this.env, (input, init) => globalThis.fetch(input, init ? { ...init, signal: undefined } : undefined)).triage;
        const baseResult = { workflowId: event.payload.workflowId, status: 'NEEDS_HUMAN_REVIEW' as const, candidateId: 0 };
        if (!provider) return { ...baseResult, reason: 'DIAGNOSTIC_PROVIDER_UNAVAILABLE' };
        try {
          const response = await provider.complete<{ ok: boolean }>({
            role: 'triage',
            schemaName: 'StagingProviderDiagnosticV1',
            system: 'Return only valid JSON.',
            user: 'Return exactly {"ok":true,"fixture":"TEST_ONLY"}.',
            tokenBudget: 40,
            timeoutMs: 20_000,
            retryLimit: 0,
          });
          return { ...baseResult, reason: `DIAGNOSTIC_OK:${response.provider}:${response.modelId ?? 'unknown'}:${response.inputTokens ?? 0}:${response.outputTokens ?? 0}` };
        } catch (error) {
          const code = error instanceof GambitProviderError ? error.code : 'unknown';
          return { ...baseResult, reason: `DIAGNOSTIC_ERROR:${code}` };
        }
      });
    }
    return step.do('qualified-analysis-and-critic', {
      retries: { limit: 1, delay: '10 seconds', backoff: 'exponential' },
      timeout: '5 minutes',
    }, async () => runQualifiedGambitWorkflow(event.payload, {
      repository: new GambitRepository(this.env.DB),
      providers: createConfiguredProviders(this.env),
      roles: getGambitModelRoleConfig(this.env),
      budget: gambitBudgetFromEnv(this.env),
    }));
  }
}
