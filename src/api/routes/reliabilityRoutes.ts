/**
 * Xylarc AI — Reliability Engineering REST API Routes
 * Endpoints for idempotency assertion, dependency circuit monitoring, DLQ management, and state recovery.
 */

import { FastifyInstance } from 'fastify';
import { ReliabilityService } from '../../reliability/service/reliabilityService.js';
import {
  IdempotentExecuteRequestSchema,
  UpdateDependencyHealthRequestSchema,
  DeadLetterStatus,
  OperationLifecycleState,
} from '../../reliability/types/reliabilityTypes.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { requirePermission } from '../middleware/rbacMiddleware.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import { z } from 'zod';

export async function reliabilityRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new ReliabilityService();

  // 1. Execute Idempotent Operation
  fastify.post(
    '/api/v1/reliability/idempotent-execute',
    { preHandler: [authenticate, requirePermission('tenant:write')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const body = IdempotentExecuteRequestSchema.parse(request.body);
        const result = await service.executeIdempotent(body, async () => {
          // Default executed action returns processed payload confirmation
          return {
            status: 'EXECUTED_SUCCESSFULLY',
            resourceType: body.resourceType,
            processedAt: new Date().toISOString(),
            inputPayload: body.payload,
          };
        });
        return reply.status(200).send(result);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 2. Record Dependency Probe & Circuit Breaker Health
  fastify.post(
    '/api/v1/reliability/dependencies/probe',
    { preHandler: [authenticate, requirePermission('tenant:write')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const body = UpdateDependencyHealthRequestSchema.parse(request.body);
        const health = await service.recordDependencyProbe(body.dependencyName, body.isSuccess, body.latencyMs);
        return reply.status(200).send(health);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 3. List Dependency Health
  fastify.get(
    '/api/v1/reliability/dependencies',
    { preHandler: [authenticate, requirePermission('tenant:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const dependencies = await service.listDependencyHealth();
        return reply.status(200).send({ dependencies, count: dependencies.length });
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 4. Enqueue to Dead Letter Queue (DLQ)
  fastify.post(
    '/api/v1/reliability/dlq',
    { preHandler: [authenticate, requirePermission('tenant:write')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const schema = z.object({
          jobType: z.string().min(1),
          payload: z.record(z.unknown()),
          error: z.string().min(1),
          maxRetries: z.number().int().positive().optional(),
        });
        const body = schema.parse(request.body);
        const job = await service.routeToDeadLetterQueue(body);
        return reply.status(201).send(job);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 5. List DLQ Items
  fastify.get(
    '/api/v1/reliability/dlq',
    { preHandler: [authenticate, requirePermission('tenant:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const { status } = request.query as { status?: DeadLetterStatus };
        const jobs = await service.listDeadLetterJobs(status);
        return reply.status(200).send({ jobs, count: jobs.length });
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 6. Replay DLQ Item
  fastify.post(
    '/api/v1/reliability/dlq/:id/replay',
    { preHandler: [authenticate, requirePermission('tenant:write')] },
    async (request, reply) => {
      const user = request.user!;
      const { id } = request.params as { id: string };
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const result = await service.replayDeadLetterJob(id);
        return reply.status(200).send(result);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 7. Discard DLQ Item
  fastify.post(
    '/api/v1/reliability/dlq/:id/discard',
    { preHandler: [authenticate, requirePermission('tenant:write')] },
    async (request, reply) => {
      const user = request.user!;
      const { id } = request.params as { id: string };
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        await service.discardDeadLetterJob(id);
        return reply.status(200).send({ success: true, message: `DLQ job '${id}' discarded.` });
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 8. Save Operation Recovery Checkpoint
  fastify.post(
    '/api/v1/reliability/recovery/checkpoints',
    { preHandler: [authenticate, requirePermission('tenant:write')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const schema = z.object({
          operationId: z.string().min(1),
          operationType: z.string().min(1),
          lifecycleState: z.enum([
            'pending', 'running', 'verifying', 'completed', 'partially_completed',
            'failed', 'retrying', 'failed_permanently', 'cancelled', 'timed_out',
            'blocked', 'requires_approval', 'escalated',
          ]),
          checkpointState: z.record(z.unknown()),
          compensationAction: z.record(z.unknown()).optional().nullable(),
        });
        const body = schema.parse(request.body);
        const checkpoint = await service.checkpointOperation(body as any);
        return reply.status(201).send(checkpoint);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 9. Recover Operation from Checkpoint
  fastify.get(
    '/api/v1/reliability/recovery/checkpoints/:operationId',
    { preHandler: [authenticate, requirePermission('tenant:read')] },
    async (request, reply) => {
      const user = request.user!;
      const { operationId } = request.params as { operationId: string };
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const recovery = await service.recoverOperation(operationId);
        return reply.status(200).send(recovery);
      }, { userId: user.userId, roles: user.roles });
    }
  );
}
