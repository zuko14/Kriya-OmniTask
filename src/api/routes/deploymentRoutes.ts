/**
 * Xylarc AI — Deployment & Release REST Routes
 * API endpoints for CI/CD gates, canary traffic shifting, feature flag targeting, and Expand-Migrate-Contract schema migrations.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../../storage/db.js';
import { DeploymentRepository } from '../../deployment/repositories/deploymentRepository.js';
import { DeploymentService } from '../../deployment/service/deploymentService.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { requirePermission } from '../middleware/rbacMiddleware.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import {
  CreateDeploymentSchema,
  UpdateCanaryWeightSchema,
  CreateFeatureFlagSchema,
  TriggerSchemaTransitionSchema,
} from '../../deployment/types/deploymentTypes.js';
import { ValidationError } from '../../core/errors/errors.js';
import { z } from 'zod';

const GateEvaluationInputSchema = z.object({
  testPassRate: z.number().min(0).max(1),
  semanticDriftScore: z.number().min(0).max(1),
  criticalSecurityVulnerabilitiesCount: z.number().int().min(0),
  p95LatencyMs: z.number().nonnegative(),
  p95LatencyBudgetMs: z.number().positive(),
}).optional();

const CreateDeploymentBodySchema = CreateDeploymentSchema.extend({
  gateInput: GateEvaluationInputSchema,
});

export async function deploymentRoutes(app: FastifyInstance): Promise<void> {
  const repo = new DeploymentRepository(db.getClient());
  const service = new DeploymentService(repo);

  // 1. Create Deployment with Quality Gates (Operator Only)
  app.post(
    '/api/v1/deployment/releases',
    { preHandler: [authenticate, requirePermission('system:admin')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = req.user!;
      return TenantContextManager.withTenant(
        user.tenantId,
        user.organizationId || 'default',
        async () => {
          const parse = CreateDeploymentBodySchema.safeParse(req.body);
          if (!parse.success) {
            throw new ValidationError('Invalid deployment payload', { issues: parse.error.issues });
          }

          const deployment = await service.createDeployment(
            parse.data.versionTag,
            parse.data.environment,
            parse.data.deployedBy,
            parse.data.gateInput
          );
          return reply.status(201).send(deployment);
        },
        { userId: user.userId, roles: user.roles }
      );
    }
  );

  // 2. List Deployments
  app.get(
    '/api/v1/deployment/releases',
    { preHandler: [authenticate, requirePermission('audit:read')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = req.user!;
      return TenantContextManager.withTenant(
        user.tenantId,
        user.organizationId || 'default',
        async () => {
          const query = req.query as { environment?: string; limit?: string };
          const limit = query.limit ? parseInt(query.limit, 10) : 50;
          const deployments = await service.listDeployments(query.environment, limit);
          return reply.send({ count: deployments.length, deployments });
        },
        { userId: user.userId, roles: user.roles }
      );
    }
  );

  // 3. Adjust Canary Traffic Weight (Operator Only)
  app.post(
    '/api/v1/deployment/releases/:id/canary',
    { preHandler: [authenticate, requirePermission('system:admin')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = req.user!;
      return TenantContextManager.withTenant(
        user.tenantId,
        user.organizationId || 'default',
        async () => {
          const { id } = req.params as { id: string };
          const parse = UpdateCanaryWeightSchema.safeParse(req.body);
          if (!parse.success) {
            throw new ValidationError('Invalid canary weight payload', { issues: parse.error.issues });
          }

          const body = req.body as any;
          const result = await service.setCanaryTrafficWeight(id, parse.data.canaryWeightPct, body.telemetry);
          return reply.send(result);
        },
        { userId: user.userId, roles: user.roles }
      );
    }
  );

  // 4. Promote Deployment (Operator Only)
  app.post(
    '/api/v1/deployment/releases/:id/promote',
    { preHandler: [authenticate, requirePermission('system:admin')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = req.user!;
      return TenantContextManager.withTenant(
        user.tenantId,
        user.organizationId || 'default',
        async () => {
          const { id } = req.params as { id: string };
          const promoted = await service.promoteDeployment(id);
          return reply.send(promoted);
        },
        { userId: user.userId, roles: user.roles }
      );
    }
  );

  // 5. Rollback Deployment (Operator Only)
  app.post(
    '/api/v1/deployment/releases/:id/rollback',
    { preHandler: [authenticate, requirePermission('system:admin')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = req.user!;
      return TenantContextManager.withTenant(
        user.tenantId,
        user.organizationId || 'default',
        async () => {
          const { id } = req.params as { id: string };
          const rolledBack = await service.rollbackDeployment(id);
          return reply.send(rolledBack);
        },
        { userId: user.userId, roles: user.roles }
      );
    }
  );

  // 6. Upsert Feature Flag (Operator Only)
  app.post(
    '/api/v1/deployment/flags',
    { preHandler: [authenticate, requirePermission('system:admin')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = req.user!;
      return TenantContextManager.withTenant(
        user.tenantId,
        user.organizationId || 'default',
        async () => {
          const parse = CreateFeatureFlagSchema.safeParse(req.body);
          if (!parse.success) {
            throw new ValidationError('Invalid feature flag payload', { issues: parse.error.issues });
          }

          const flag = await service.upsertFeatureFlag(parse.data);
          return reply.status(200).send(flag);
        },
        { userId: user.userId, roles: user.roles }
      );
    }
  );

  // 7. List Feature Flags
  app.get(
    '/api/v1/deployment/flags',
    { preHandler: [authenticate, requirePermission('tenant:read')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = req.user!;
      return TenantContextManager.withTenant(
        user.tenantId,
        user.organizationId || 'default',
        async () => {
          const flags = await service.listFeatureFlags();
          return reply.send({ count: flags.length, flags });
        },
        { userId: user.userId, roles: user.roles }
      );
    }
  );

  // 8. Evaluate Feature Flag
  app.post(
    '/api/v1/deployment/flags/:key/evaluate',
    { preHandler: [authenticate, requirePermission('tenant:read')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = req.user!;
      return TenantContextManager.withTenant(
        user.tenantId,
        user.organizationId || 'default',
        async () => {
          const { key } = req.params as { key: string };
          const body = (req.body as any) || {};
          const context = {
            tenantId: body.tenantId || user.tenantId,
            userId: body.userId || user.userId,
            roles: body.roles || user.roles,
          };
          const evaluation = await service.evaluateFeatureFlag(key, context);
          return reply.send(evaluation);
        },
        { userId: user.userId, roles: user.roles }
      );
    }
  );

  // 9. Trigger Schema Transition Phase (Operator Only)
  app.post(
    '/api/v1/deployment/schema-transitions',
    { preHandler: [authenticate, requirePermission('system:admin')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = req.user!;
      return TenantContextManager.withTenant(
        user.tenantId,
        user.organizationId || 'default',
        async () => {
          const parse = TriggerSchemaTransitionSchema.safeParse(req.body);
          if (!parse.success) {
            throw new ValidationError('Invalid schema transition payload', { issues: parse.error.issues });
          }

          const transition = await service.triggerSchemaTransition(
            parse.data.tableName,
            parse.data.version,
            parse.data.phase,
            parse.data.details
          );
          return reply.status(201).send(transition);
        },
        { userId: user.userId, roles: user.roles }
      );
    }
  );

  // 10. List Schema Transitions
  app.get(
    '/api/v1/deployment/schema-transitions',
    { preHandler: [authenticate, requirePermission('audit:read')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = req.user!;
      return TenantContextManager.withTenant(
        user.tenantId,
        user.organizationId || 'default',
        async () => {
          const query = req.query as { tableName?: string };
          const transitions = await service.listSchemaTransitions(query.tableName);
          return reply.send({ count: transitions.length, transitions });
        },
        { userId: user.userId, roles: user.roles }
      );
    }
  );
}
