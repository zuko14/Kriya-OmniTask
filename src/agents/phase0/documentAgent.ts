/**
 * Kriya Omnitask — Document (Lens) Agent (docs/kriya WP-4.5, 02 §9: Extract & Validate Documents, Zero-Retention)
 *
 * Specialised agent charter for parsing, template extraction, and schema validation.
 * Operates at autonomy tier T1. Enforces zero-retention (raw payload in memory only; stores hashes + schemas).
 * Low-confidence or unparsable documents fail closed into the Attention queue.
 */

import { AgentCharterInput, buildAgentFromCharter } from '../charter/agentCharter.js';
import { ToolRegistryService } from '../../tools/registry/toolRegistry.js';
import { createRuntimeHandlers } from '../../runtime/graph/handlers.js';
import { GraphExecutor } from '../../runtime/graph/executor.js';
import { GraphRunRepository } from '../../runtime/graph/graphRunRepository.js';
import { ModelGateway } from '../../model/gateway/modelGateway.js';
import { ProofService } from '../../trust/proof/proofService.js';
import { MandateService } from '../../trust/mandate/mandateService.js';
import { DocumentService } from '../../document/service/documentService.js';
import { DatabaseClient } from '../../storage/db.js';

export const DEFAULT_DOCUMENT_CHARTER: AgentCharterInput = {
  slug: 'document',
  version: '1.0.0',
  owns: 'document extraction, template parsing, structured validation, and zero-retention compliance',
  goal:
    'You are the Document (Lens) specialist for a business. ' +
    'Extract structured fields from documents, lab reports, prescriptions, invoices, and ID cards with doc_parse. ' +
    'Validate extracted structures with doc_validate_schema, and retrieve past parsed documents with doc_get_parsed. ' +
    'Always preserve zero-retention: raw documents are never stored; only verified structured schemas and SHA-256 hashes are persisted. ' +
    'If a document is corrupted, ambiguous, or fails validation, low-confidence escalation will file an Attention item for human review.',
  tools: [
    { slug: 'doc_parse', description: 'args {"rawContent":string,"documentType"?:string,"correlationId"?:string,"confidenceThreshold"?:number}: parse document with zero-retention' },
    { slug: 'doc_validate_schema', description: 'args {"documentType":string,"data":object}: validate extracted structured data against schema' },
    { slug: 'doc_get_parsed', description: 'args {"documentId"?:string,"sha256Hash"?:string}: get previously parsed document structured record' },
  ],
  dataScope: ['request', 'document.parsed', 'validation'],
  autonomyTierCap: 'T1',
  budgets: { maxIterations: 6, maxCostUsd: 0.05 },
  modelTier: 'T2',
  owner: 'operations_lead',
  evalSuiteId: 'document-golden-v1',
};

export interface DocumentAgentExecutorDeps {
  registry: ToolRegistryService;
  gateway?: ModelGateway;
  charter?: AgentCharterInput;
  client?: DatabaseClient;
  documentService?: DocumentService;
}

export function createDocumentAgentExecutor(deps: DocumentAgentExecutorDeps) {
  return async (request: string, context: Record<string, unknown> = {}, correlationId?: string) => {
    const runs = new GraphRunRepository(deps.client);
    const built = buildAgentFromCharter(deps.charter ?? DEFAULT_DOCUMENT_CHARTER, { registry: deps.registry });
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
