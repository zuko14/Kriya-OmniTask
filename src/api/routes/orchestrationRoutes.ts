/**
 * Xylarc AI — Orchestration & Safety Firewall REST Routes
 * Fastify routes for hierarchical agent dispatch, trace retrieval, and firewall testing.
 */

import { FastifyInstance } from 'fastify';
import { HierarchicalOrchestrator } from '../../orchestration/orchestrator/hierarchicalOrchestrator.js';
import { AgentSafetyFirewall } from '../../orchestration/firewall/agentSafetyFirewall.js';
import { AgentExecutionRepository } from '../../agents/repositories/agentRepository.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { requirePermission } from '../middleware/rbacMiddleware.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import { z } from 'zod';

const DispatchBodySchema = z.object({
  objective: z.string().min(2),
  customerId: z.string().optional(),
  entryAgentSlug: z.string().optional(),
  contextData: z.record(z.unknown()).optional(),
  delegationDepth: z.number().int().min(0).max(10).optional(),
});

const FirewallInspectSchema = z.object({
  inputContent: z.string().optional(),
  outputContent: z.string().optional(),
  requestedDataScopes: z.array(z.string()).optional(),
  allowedDataScopes: z.array(z.string()).optional(),
  actionRiskTier: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  agentAutonomyLevel: z.union([
    z.literal(0),
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
  ]).optional(),
});

export async function orchestrationRoutes(fastify: FastifyInstance): Promise<void> {
  const orchestrator = new HierarchicalOrchestrator();
  const executionRepo = new AgentExecutionRepository();

  // 1. Dispatch Business Objective / Customer Interaction
  fastify.post(
    '/api/v1/orchestration/dispatch',
    { preHandler: [authenticate, requirePermission('workflow:execute')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const body = DispatchBodySchema.parse(request.body);

        const result = await orchestrator.dispatch({
          objective: body.objective,
          customerId: body.customerId,
          entryAgentSlug: body.entryAgentSlug,
          contextData: body.contextData,
          delegationDepth: body.delegationDepth,
          correlationId: request.headers['x-correlation-id'] as string,
        });

        return reply.status(200).send(result);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 2. Safety Firewall Direct Inspection
  fastify.post(
    '/api/v1/orchestration/firewall/inspect',
    { preHandler: [authenticate, requirePermission('agent:read')] },
    async (request, reply) => {
      const user = request.user!;
      const body = FirewallInspectSchema.parse(request.body);

      const result = AgentSafetyFirewall.scan({
        tenantId: user.tenantId,
        inputContent: body.inputContent,
        outputContent: body.outputContent,
        requestedDataScopes: body.requestedDataScopes,
        allowedDataScopes: body.allowedDataScopes,
        actionRiskTier: body.actionRiskTier,
        agentAutonomyLevel: body.agentAutonomyLevel,
      });

      return reply.status(200).send(result);
    }
  );
}
