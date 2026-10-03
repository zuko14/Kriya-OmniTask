/**
 * Kriya AI — Deployment & Release REST Routes
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
  ExecuteRollbackSchema,
  IngestCanaryTelemetrySchema,
  RegisterApiVersionSchema,
  UpsertDataResidencySchema,
  ValidateResidencyRequestSchema,
} from '../../deployment/types/deploymentTypes.js';
import { AttentionService } from '../../attention/service/attentionService.js';
import { ProofService } from '../../trust/proof/proofService.js';
import { LaunchGateReviewEngine } from '../../deployment/gate/launchGateReviewEngine.js';
import { LaunchGateEvaluationRequestSchema } from '../../deployment/gate/launchGateTypes.js';
import { ValidationError, NotFoundError } from '../../core/errors/errors.js';
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
  const attentionService = new AttentionService(db.getClient());
  const proofService = new ProofService();
  const service = new DeploymentService(repo, attentionService, proofService);

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

  // 11. One-Step Instant Rollback (Operator Only)
  app.post(
    '/api/v1/deployment/releases/:id/rollback/instant',
    { preHandler: [authenticate, requirePermission('system:admin')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = req.user!;
      return TenantContextManager.withTenant(
        user.tenantId,
        user.organizationId || 'default',
        async () => {
          const { id } = req.params as { id: string };
          const parse = ExecuteRollbackSchema.safeParse(req.body || {});
          if (!parse.success) {
            throw new ValidationError('Invalid rollback payload', { issues: parse.error.issues });
          }

          const result = await service.executeInstantRollback(id, parse.data);
          return reply.status(200).send(result);
        },
        { userId: user.userId, roles: user.roles }
      );
    }
  );

  // 12. List Deployment Rollback Audit Events
  app.get(
    '/api/v1/deployment/releases/:id/rollback-events',
    { preHandler: [authenticate, requirePermission('audit:read')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = req.user!;
      return TenantContextManager.withTenant(
        user.tenantId,
        user.organizationId || 'default',
        async () => {
          const { id } = req.params as { id: string };
          const events = await service.listRollbackEvents(id);
          return reply.send({ count: events.length, events });
        },
        { userId: user.userId, roles: user.roles }
      );
    }
  );

  // 13. Evaluate Canary Telemetry & Auto-Rollback
  app.post(
    '/api/v1/deployment/canary/evaluate',
    { preHandler: [authenticate, requirePermission('system:admin')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = req.user!;
      return TenantContextManager.withTenant(
        user.tenantId,
        user.organizationId || 'default',
        async () => {
          const parse = IngestCanaryTelemetrySchema.safeParse(req.body);
          if (!parse.success) {
            throw new ValidationError('Invalid canary telemetry payload', { issues: parse.error.issues });
          }

          const result = await service.evaluateAndIngestCanaryTelemetry(parse.data);
          return reply.status(200).send(result);
        },
        { userId: user.userId, roles: user.roles }
      );
    }
  );

  // 14. Check Tenant Canary Route Assignment
  app.get(
    '/api/v1/deployment/canary/:deploymentId/route-check',
    { preHandler: [authenticate, requirePermission('tenant:read')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = req.user!;
      return TenantContextManager.withTenant(
        user.tenantId,
        user.organizationId || 'default',
        async () => {
          const { deploymentId } = req.params as { deploymentId: string };
          const query = req.query as { tenantId?: string };
          const targetTenant = query.tenantId || user.tenantId;
          const decision = await service.routeTenantForCanary(deploymentId, targetTenant);
          return reply.send(decision);
        },
        { userId: user.userId, roles: user.roles }
      );
    }
  );

  // 15. List Canary Telemetry Snapshots
  app.get(
    '/api/v1/deployment/canary/:deploymentId/telemetry',
    { preHandler: [authenticate, requirePermission('audit:read')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = req.user!;
      return TenantContextManager.withTenant(
        user.tenantId,
        user.organizationId || 'default',
        async () => {
          const { deploymentId } = req.params as { deploymentId: string };
          const query = req.query as { limit?: string };
          const limit = query.limit ? parseInt(query.limit, 10) : 50;
          const snapshots = await service.listCanaryTelemetrySnapshots(deploymentId, limit);
          return reply.send({ count: snapshots.length, snapshots });
        },
        { userId: user.userId, roles: user.roles }
      );
    }
  );

  // 16. Register / Update API Version (Operator Only)
  app.post(
    '/api/v1/deployment/versions',
    { preHandler: [authenticate, requirePermission('system:admin')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = req.user!;
      return TenantContextManager.withTenant(
        user.tenantId,
        user.organizationId || 'default',
        async () => {
          const parse = RegisterApiVersionSchema.safeParse(req.body);
          if (!parse.success) {
            throw new ValidationError('Invalid API version payload', { issues: parse.error.issues });
          }

          const versionReg = await service.registerApiVersion(parse.data);
          return reply.status(201).send(versionReg);
        },
        { userId: user.userId, roles: user.roles }
      );
    }
  );

  // 17. List Registered API Versions
  app.get(
    '/api/v1/deployment/versions',
    { preHandler: [authenticate, requirePermission('tenant:read')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = req.user!;
      return TenantContextManager.withTenant(
        user.tenantId,
        user.organizationId || 'default',
        async () => {
          const query = req.query as { status?: string };
          const versions = await service.listApiVersions(query.status);
          return reply.send({ count: versions.length, versions });
        },
        { userId: user.userId, roles: user.roles }
      );
    }
  );

  // 18. Upsert Data Residency Configuration (Tenant Admin / System Admin)
  app.post(
    '/api/v1/deployment/residency',
    { preHandler: [authenticate, requirePermission('tenant:write')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = req.user!;
      return TenantContextManager.withTenant(
        user.tenantId,
        user.organizationId || 'default',
        async () => {
          const parse = UpsertDataResidencySchema.safeParse(req.body);
          if (!parse.success) {
            throw new ValidationError('Invalid data residency payload', { issues: parse.error.issues });
          }

          const config = await service.upsertDataResidency(user.tenantId, parse.data);
          return reply.status(200).send(config);
        },
        { userId: user.userId, roles: user.roles }
      );
    }
  );

  // 19. Get Tenant Data Residency Configuration
  app.get(
    '/api/v1/deployment/residency',
    { preHandler: [authenticate, requirePermission('tenant:read')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = req.user!;
      return TenantContextManager.withTenant(
        user.tenantId,
        user.organizationId || 'default',
        async () => {
          const config = await service.getDataResidency(user.tenantId);
          return reply.send(config);
        },
        { userId: user.userId, roles: user.roles }
      );
    }
  );

  app.get(
    '/api/v1/deployment/residency/:tenantId',
    { preHandler: [authenticate, requirePermission('system:admin')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = req.user!;
      return TenantContextManager.withTenant(
        user.tenantId,
        user.organizationId || 'default',
        async () => {
          const { tenantId } = req.params as { tenantId: string };
          const config = await service.getDataResidency(tenantId);
          return reply.send(config);
        },
        { userId: user.userId, roles: user.roles }
      );
    }
  );

  // 20. Validate Data Residency & Regional Boundaries
  app.post(
    '/api/v1/deployment/residency/validate',
    { preHandler: [authenticate, requirePermission('tenant:read')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = req.user!;
      return TenantContextManager.withTenant(
        user.tenantId,
        user.organizationId || 'default',
        async () => {
          const parse = ValidateResidencyRequestSchema.safeParse(req.body);
          if (!parse.success) {
            throw new ValidationError('Invalid validation payload', { issues: parse.error.issues });
          }

          const result = await service.validateDataResidency(user.tenantId, parse.data);
          return reply.send(result);
        },
        { userId: user.userId, roles: user.roles }
      );
    }
  );

  // 21. Get India Hosting Blueprint
  app.get(
    '/api/v1/deployment/hosting/config',
    async (_req: FastifyRequest, reply: FastifyReply) => {
      const blueprint = service.getIndiaHostingBlueprint();
      return reply.send(blueprint);
    }
  );

  // 22. Evaluate Launch Gates (WP-8.6 - Operator Only)
  const launchGateEngine = new LaunchGateReviewEngine(db.getClient(), repo, proofService);

  app.post(
    '/api/v1/deployment/launch-gate/evaluate',
    { preHandler: [authenticate, requirePermission('system:admin')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const parse = LaunchGateEvaluationRequestSchema.safeParse(req.body || {});
      if (!parse.success) {
        throw new ValidationError('Invalid launch gate evaluation payload', { issues: parse.error.issues });
      }

      const report = await launchGateEngine.evaluateAllGates(parse.data);
      return reply.send(report);
    }
  );

  // 23. Get Current Launch Gate Status / Latest Review
  app.get(
    '/api/v1/deployment/launch-gate/status',
    { preHandler: [authenticate] },
    async (_req: FastifyRequest, reply: FastifyReply) => {
      let report = await repo.getLatestLaunchGateReview();
      if (!report) {
        report = await launchGateEngine.evaluateAllGates();
      }
      return reply.send(report);
    }
  );

  // 24. List Historic Launch Gate Reviews
  app.get(
    '/api/v1/deployment/launch-gate/reviews',
    { preHandler: [authenticate, requirePermission('system:admin')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const query = req.query as { limit?: string };
      const limit = query.limit ? Math.min(100, Math.max(1, parseInt(query.limit, 10))) : 20;
      const reviews = await repo.listLaunchGateReviews(limit);
      return reply.send({ count: reviews.length, reviews });
    }
  );

  // 25. Get Specific Launch Gate Review
  app.get(
    '/api/v1/deployment/launch-gate/reviews/:reviewId',
    { preHandler: [authenticate, requirePermission('system:admin')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { reviewId } = req.params as { reviewId: string };
      const review = await repo.getLaunchGateReview(reviewId);
      if (!review) {
        throw new NotFoundError(`Launch gate review '${reviewId}' not found.`);
      }
      return reply.send(review);
    }
  );
}

