/**
 * Kriya Omnitask — Verification Agent (docs/kriya WP-4.6, 02 §7, §14: Read-Back Verification & Audit)
 *
 * Specialised agent charter for async read-back verification against external systems of record.
 * Detects discrepancies, prevents unverified state, and fails closed into the Attention queue.
 * Operates at autonomy tier T0 (audit and read-back only).
 */

import { AgentCharterInput, buildAgentFromCharter } from '../charter/agentCharter.js';
import { ToolRegistryService } from '../../tools/registry/toolRegistry.js';
import { createRuntimeHandlers } from '../../runtime/graph/handlers.js';
import { GraphExecutor } from '../../runtime/graph/executor.js';
import { GraphRunRepository } from '../../runtime/graph/graphRunRepository.js';
import { ModelGateway } from '../../model/gateway/modelGateway.js';
import { ProofService } from '../../trust/proof/proofService.js';
import { MandateService } from '../../trust/mandate/mandateService.js';
import { VerificationJobService } from '../../attention/service/verificationJobService.js';
import { DatabaseClient } from '../../storage/db.js';

export const DEFAULT_VERIFICATION_CHARTER: AgentCharterInput = {
  slug: 'verification',
  version: '1.0.0',
  owns: 'asynchronous read-back verification of actions against external systems of record',
  goal:
    'You are the Verification agent for a business. ' +
    'Poll pending verification jobs with verification_poll_jobs, and execute read-backs using verification_run_job. ' +
    'Check run verification health with verification_check_run. ' +
    'Never mark an action verified unless the external system of record confirms the exact state. If external state contradicts the action, the job will fail into the attention queue.',
  tools: [
    { slug: 'verification_create_job', description: 'args {"runId":string,"toolSlug":string,"actionInput":object,"actionOutput":object,"idempotencyKey":string}: enqueue verification job' },
    { slug: 'verification_poll_jobs', description: 'args {"limit"?:number}: poll pending jobs due for verification' },
    { slug: 'verification_run_job', description: 'args {"jobId":string}: run read-back verification for a job' },
    { slug: 'verification_check_run', description: 'args {"runId":string}: check verification status of a run' },
  ],
  dataScope: ['request', 'verification.job', 'run.status'],
  autonomyTierCap: 'T0',
  budgets: { maxIterations: 6, maxCostUsd: 0.05 },
  modelTier: 'T2',
  owner: 'compliance_officer',
  evalSuiteId: 'verification-golden-v1',
};

export interface VerificationAgentExecutorDeps {
  registry: ToolRegistryService;
  gateway?: ModelGateway;
  charter?: AgentCharterInput;
  client?: DatabaseClient;
  verificationService?: VerificationJobService;
}

export function createVerificationAgentExecutor(deps: VerificationAgentExecutorDeps) {
  return async (request: string, context: Record<string, unknown> = {}, correlationId?: string) => {
    const runs = new GraphRunRepository(deps.client);
    const built = buildAgentFromCharter(deps.charter ?? DEFAULT_VERIFICATION_CHARTER, { registry: deps.registry });
    const { handlers, compensator } = createRuntimeHandlers({
      agentSlug: built.agentSlug,
      agentVersion: built.agentVersion,
      gateway: deps.gateway,
      schemas: built.schemas,
      rules: built.rules,
      toolRegistry: deps.registry,
      proofService: new ProofService(deps.client),
      mandateService: new MandateService(deps.client),
      dbClient: deps.client,
    });

    return new GraphExecutor(handlers, runs, compensator).start(
      built.graph,
      {
        request,
        ...context,
      },
      { correlationId }
    );
  };
}
