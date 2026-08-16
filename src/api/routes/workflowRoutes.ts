/**
 * Xylarc AI — Workflow DAG Engine REST Routes
 * Fastify REST endpoints for managing DAG workflows, dispatching executions, and resolving human approval gates.
 */

import { FastifyInstance } from 'fastify';
import { WorkflowService } from '../../workflows/service/workflowService.js';
import { WorkflowDefinitionSchema } from '../../workflows/types/workflowTypes.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { requirePermission } from '../middleware/rbacMiddleware.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import { z } from 'zod';

const TriggerWorkflowBodySchema = z.object({
  context: z.record(z.unknown()).default({}),
  correlationId: z.string().optional(),
});

const DecideApprovalBodySchema = z.object({
  executionId: z.string().min(1),
  stepId: z.string().min(1),
  decision: z.enum(['approved', 'rejected']),
  notes: z.string().optional(),
});

export async function workflowRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new WorkflowService();

  // 1. List Workflow Definitions
  fastify.get(
    '/api/v1/workflows',
    { preHandler: [authenticate, requirePermission('workflow:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const workflows = await service.listWorkflows();
        return reply.status(200).send({
          total: workflows.length,
          workflows,
        });
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 2. Create or Update Workflow Definition
  fastify.post(
    '/api/v1/workflows',
    { preHandler: [authenticate, requirePermission('workflow:write')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const body = WorkflowDefinitionSchema.parse(request.body);
        const wf = await service.createWorkflow(body);
        return reply.status(201).send(wf);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 3. Get Workflow Definition by Slug
  fastify.get(
    '/api/v1/workflows/:slug',
    { preHandler: [authenticate, requirePermission('workflow:read')] },
    async (request, reply) => {
      const user = request.user!;
      const { slug } = request.params as { slug: string };
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const wf = await service.getWorkflowBySlug(slug);
        return reply.status(200).send(wf);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 4. Delete Workflow Definition
  fastify.delete(
    '/api/v1/workflows/:slug',
    { preHandler: [authenticate, requirePermission('workflow:write')] },
    async (request, reply) => {
      const user = request.user!;
      const { slug } = request.params as { slug: string };
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        await service.deleteWorkflow(slug);
        return reply.status(200).send({ success: true, slug });
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 5. Trigger Workflow Execution
  fastify.post(
    '/api/v1/workflows/:slug/trigger',
    { preHandler: [authenticate, requirePermission('workflow:execute')] },
    async (request, reply) => {
      const user = request.user!;
      const { slug } = request.params as { slug: string };
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const body = TriggerWorkflowBodySchema.parse(request.body || {});
        const execution = await service.triggerWorkflow(slug, body.context, body.correlationId);
        return reply.status(200).send(execution);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 6. List Workflow Executions
  fastify.get(
    '/api/v1/workflows/executions',
    { preHandler: [authenticate, requirePermission('workflow:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const { status } = request.query as { status?: string };
        const executions = await service.listExecutions(50, status);
        return reply.status(200).send({
          total: executions.length,
          executions,
        });
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 7. Get Workflow Execution Details
  fastify.get(
    '/api/v1/workflows/executions/:id',
    { preHandler: [authenticate, requirePermission('workflow:read')] },
    async (request, reply) => {
      const user = request.user!;
      const { id } = request.params as { id: string };
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const execution = await service.getExecution(id);
        return reply.status(200).send(execution);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 8. List Pending Human Approval Requests
  fastify.get(
    '/api/v1/workflows/approvals',
    { preHandler: [authenticate, requirePermission('attention:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const approvals = await service.listPendingApprovals(50);
        return reply.status(200).send({
          total: approvals.length,
          approvals,
        });
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 9. Decide Human Approval Step
  fastify.post(
    '/api/v1/workflows/approvals/decide',
    { preHandler: [authenticate, requirePermission('attention:approve')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const body = DecideApprovalBodySchema.parse(request.body);
        const execution = await service.decideApproval({
          executionId: body.executionId,
          stepId: body.stepId,
          decision: body.decision,
          notes: body.notes,
        });
        return reply.status(200).send(execution);
      }, { userId: user.userId, roles: user.roles });
    }
  );
}
