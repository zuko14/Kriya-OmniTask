/**
 * Kriya Omnitask — Attention Agent (docs/kriya WP-4.6, 02 §14: Human Attention & Priority Exception Queue)
 *
 * Specialised agent charter for managing human escalation items, SLAs, routing matrix rules, and live takeovers.
 * Operates at autonomy tier T0 (propose/review only; cannot execute write side effects without human verification).
 */

import { AgentCharterInput, buildAgentFromCharter } from '../charter/agentCharter.js';
import { ToolRegistryService } from '../../tools/registry/toolRegistry.js';
import { createRuntimeHandlers } from '../../runtime/graph/handlers.js';
import { GraphExecutor } from '../../runtime/graph/executor.js';
import { GraphRunRepository } from '../../runtime/graph/graphRunRepository.js';
import { ModelGateway } from '../../model/gateway/modelGateway.js';
import { ProofService } from '../../trust/proof/proofService.js';
import { MandateService } from '../../trust/mandate/mandateService.js';
import { AttentionService } from '../../attention/service/attentionService.js';
import { DatabaseClient } from '../../storage/db.js';

export const DEFAULT_ATTENTION_CHARTER: AgentCharterInput = {
  slug: 'attention',
  version: '1.0.0',
  owns: 'human attention routing, triage queues, priority SLAs, and live customer takeovers',
  goal:
    'You are the Attention specialist for a business. ' +
    'Manage the attention queue by listing pending items with attention_list_queue, claiming items for operators with attention_claim_item, and resolving or re-routing them with attention_resolve_item or attention_route_item. ' +
    'For sensitive complaints or high-risk conversations, initiate a human takeover with attention_takeover, and hand back with attention_handback once resolved. ' +
    'Always observe priority SLAs (P0 critical first). Never resolve an item without specifying clear resolution notes.',
  tools: [
    { slug: 'attention_list_queue', description: 'args {"status"?:string,"priority"?:string,"assignedRole"?:string,"branchId"?:string,"limit"?:number}: list attention items' },
    { slug: 'attention_claim_item', description: 'args {"itemId":string,"userId":string}: claim an attention item' },
    { slug: 'attention_resolve_item', description: 'args {"itemId":string,"action":string,"notes"?:string}: resolve an item with verdict' },
    { slug: 'attention_route_item', description: 'args {"itemId":string,"assignedRole":string,"assignedUserId"?:string,"branchId"?:string}: re-route an item' },
    { slug: 'attention_takeover', description: 'args {"customerId":string,"channel":string,"userId":string,"reason":string}: start human takeover' },
    { slug: 'attention_handback', description: 'args {"customerId":string}: hand back customer conversation to AI' },
  ],
  dataScope: ['request', 'attention.item', 'queue'],
  autonomyTierCap: 'T0',
  budgets: { maxIterations: 6, maxCostUsd: 0.05 },
  modelTier: 'T2',
  owner: 'operations_lead',
  evalSuiteId: 'attention-golden-v1',
};

export interface AttentionAgentExecutorDeps {
  registry: ToolRegistryService;
  gateway?: ModelGateway;
  charter?: AgentCharterInput;
  client?: DatabaseClient;
  attention?: AttentionService;
}

export function createAttentionAgentExecutor(deps: AttentionAgentExecutorDeps) {
  return async (request: string, context: Record<string, unknown> = {}, correlationId?: string) => {
    const runs = new GraphRunRepository(deps.client);
    const built = buildAgentFromCharter(deps.charter ?? DEFAULT_ATTENTION_CHARTER, { registry: deps.registry });
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
