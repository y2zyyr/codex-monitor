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
