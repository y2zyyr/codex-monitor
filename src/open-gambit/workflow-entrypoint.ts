import { WorkflowEntrypoint } from 'cloudflare:workers';
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import type { Env } from '../types';
import { gambitBudgetFromEnv } from './budget';
import { getGambitModelRoleConfig } from './llm';
import { GambitRepository } from './repository';
import { runQualifiedGambitWorkflow } from './pipeline';
import { createConfiguredProviders } from './workflow';
import type { GambitWorkflowInput, GambitWorkflowResult } from './types';

/** Cloudflare Workflow entrypoint; local code uses runLocalGambitWorkflow. */
export class OpenGambitAnalysisWorkflow extends WorkflowEntrypoint<Env, GambitWorkflowInput> {
  async run(event: Readonly<WorkflowEvent<GambitWorkflowInput>>, step: WorkflowStep): Promise<GambitWorkflowResult> {
    return step.do('qualified-analysis-critic-and-publication-gate', {
      retries: { limit: 1, delay: '10 seconds', backoff: 'exponential' },
      timeout: '5 minutes',
    }, async () => runQualifiedGambitWorkflow(event.payload, {
      repository: new GambitRepository(this.env.DB),
      // Cloudflare Workflow step fetches reject AbortSignal instances. The
      // enclosing five-minute step timeout plus the bounded per-run budgets
      // still cap this path; ordinary Worker/local paths keep signal-based
      // request cancellation in the provider adapter.
      providers: createConfiguredProviders(this.env, (input, init) => globalThis.fetch(input, init ? { ...init, signal: undefined } : undefined)),
      roles: getGambitModelRoleConfig(this.env),
      budget: gambitBudgetFromEnv(this.env),
    }));
  }
}
