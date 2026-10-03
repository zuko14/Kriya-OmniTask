/**
 * Kriya AI — Reliability Engineering REST API Routes
 * Endpoints for idempotency assertion, dependency circuit monitoring, DLQ management, and state recovery.
 */

import { FastifyInstance } from 'fastify';
import { ReliabilityService } from '../../reliability/service/reliabilityService.js';
import {
  IdempotentExecuteRequestSchema,
  UpdateDependencyHealthRequestSchema,
  DeadLetterStatus,
  OperationLifecycleState,
  RunReliabilityDrillRequestSchema,
  CreatePitrSnapshotRequestSchema,
  RestorePitrRequestSchema,
  SimulateFailoverRequestSchema,
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

  // --- WP-8.4: Chaos Drills (Staging Only, Operator Only) ---

  // 10. Execute Chaos Injection Drill
  fastify.post(
    '/api/v1/reliability/drills/run',
    { preHandler: [authenticate, requirePermission('system:admin')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const body = RunReliabilityDrillRequestSchema.parse(request.body);
        const drillRun = await service.executeChaosDrill(body);
        return reply.status(201).send(drillRun);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 11. List Chaos Drill Runs
  fastify.get(
    '/api/v1/reliability/drills/runs',
    { preHandler: [authenticate, requirePermission('audit:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const { limit } = request.query as { limit?: string };
        const parsedLimit = limit ? parseInt(limit, 10) : 20;
        const drills = await service.listChaosDrills(parsedLimit);
        return reply.status(200).send({ drills, count: drills.length });
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // --- WP-8.4: Point-In-Time Recovery (PITR) & Snapshots ---

  // 12. Create PITR Snapshot
  fastify.post(
    '/api/v1/reliability/pitr/snapshots',
    { preHandler: [authenticate, requirePermission('system:admin')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const body = CreatePitrSnapshotRequestSchema.parse(request.body);
        const snapshot = await service.createPitrSnapshot(body);
        return reply.status(201).send(snapshot);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 13. List PITR Snapshots
  fastify.get(
    '/api/v1/reliability/pitr/snapshots',
    { preHandler: [authenticate, requirePermission('audit:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const { limit } = request.query as { limit?: string };
        const parsedLimit = limit ? parseInt(limit, 10) : 20;
        const snapshots = await service.listPitrSnapshots(parsedLimit);
        return reply.status(200).send({ snapshots, count: snapshots.length });
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 14. Verify Snapshot Cryptographic Checksum Integrity
  fastify.get(
    '/api/v1/reliability/pitr/snapshots/:snapshotId/verify',
    { preHandler: [authenticate, requirePermission('audit:read')] },
    async (request, reply) => {
      const user = request.user!;
      const { snapshotId } = request.params as { snapshotId: string };
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const verification = await service.verifyPitrSnapshot(snapshotId);
        return reply.status(200).send(verification);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 15. Execute PITR Restore Drill
  fastify.post(
    '/api/v1/reliability/pitr/restore',
    { preHandler: [authenticate, requirePermission('system:admin')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const body = RestorePitrRequestSchema.parse(request.body);
        const restoreOp = await service.executePitrRestore(body);
        return reply.status(200).send(restoreOp);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 16. List PITR Restore Operations
  fastify.get(
    '/api/v1/reliability/pitr/restores',
    { preHandler: [authenticate, requirePermission('audit:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const { limit } = request.query as { limit?: string };
        const parsedLimit = limit ? parseInt(limit, 10) : 20;
        const restores = await service.listPitrRestores(parsedLimit);
        return reply.status(200).send({ restores, count: restores.length });
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // --- WP-8.4: High-Availability Failover Drills ---

  // 17. Simulate Primary Database Failover
  fastify.post(
    '/api/v1/reliability/failover/simulate',
    { preHandler: [authenticate, requirePermission('system:admin')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const body = SimulateFailoverRequestSchema.parse(request.body);
        const result = await service.simulateFailover(body);
        return reply.status(200).send(result);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 18. Get Failover Cluster Topology & Readiness Status
  fastify.get(
    '/api/v1/reliability/failover/topology',
    { preHandler: [authenticate, requirePermission('audit:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const topology = service.getFailoverClusterTopology();
        return reply.status(200).send(topology);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 19. List Failover Drill Runs
  fastify.get(
    '/api/v1/reliability/failover/drills',
    { preHandler: [authenticate, requirePermission('audit:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const { limit } = request.query as { limit?: string };
        const parsedLimit = limit ? parseInt(limit, 10) : 20;
        const drills = await service.listFailoverDrills(parsedLimit);
        return reply.status(200).send({ drills, count: drills.length });
      }, { userId: user.userId, roles: user.roles });
    }
  );
}

