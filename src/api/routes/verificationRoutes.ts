/**
 * Kriya AI — Deterministic Verification & Quality Review REST Routes
 * Endpoints for Pre-flight Checks, Quality Scoring, and Review Verdicts (§14, §15 of CLAUDE.md).
 */

import { FastifyInstance } from 'fastify';
import {
  QualityReviewRequestSchema,
  ListReviewsQuerySchema,
} from '../../verification/types/verificationTypes.js';
import { VerificationService } from '../../verification/service/verificationService.js';
import { VerificationJobRepository } from '../../attention/repositories/verificationJobRepository.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { requirePermission, requireAnyPermission } from '../middleware/rbacMiddleware.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';

export async function verificationRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new VerificationService();
  const jobRepo = new VerificationJobRepository();

  // 1. Submit Content for Quality Review
  fastify.post(
    '/api/v1/verification/review',
    { preHandler: [authenticate, requirePermission('agent:write')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const body = QualityReviewRequestSchema.parse(request.body);
        const review = await service.reviewContent(body);
        return reply.status(201).send(review);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 2. List Reviews with Filters
  fastify.get(
    '/api/v1/verification/reviews',
    { preHandler: [authenticate, requirePermission('audit:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const query = ListReviewsQuerySchema.parse(request.query);
        const reviews = await service.listReviews({
          agentId: query.agentId,
          verdict: query.verdict,
          limit: query.limit,
        });
        return reply.status(200).send({ reviews, count: reviews.length });
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 3. Get Specific Review by ID
  fastify.get(
    '/api/v1/verification/reviews/:id',
    { preHandler: [authenticate, requirePermission('audit:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const { id } = request.params as { id: string };
        const review = await service.getReview(id);
        return reply.status(200).send(review);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 4. Get Verification Metrics Overview
  fastify.get(
    '/api/v1/verification/metrics',
    { preHandler: [authenticate, requirePermission('audit:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const metrics = await service.getMetricsOverview();
        return reply.status(200).send(metrics);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 5. List Verification Jobs (scoped to tenant, paginated, status-filtered)
  fastify.get(
    '/api/v1/verification/jobs',
    { preHandler: [authenticate, requireAnyPermission(['tenant:read', 'audit:read'])] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const query = request.query as {
          status?: string;
          runId?: string;
          limit?: string;
          offset?: string;
        };
        const limit = query.limit ? parseInt(query.limit, 10) : undefined;
        const offset = query.offset ? parseInt(query.offset, 10) : undefined;
        const result = await jobRepo.listJobs({
          status: query.status,
          runId: query.runId,
          limit,
          offset,
        });
        return reply.status(200).send(result);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 6. Get Specific Verification Job by ID
  fastify.get(
    '/api/v1/verification/jobs/:id',
    { preHandler: [authenticate, requireAnyPermission(['tenant:read', 'audit:read'])] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const { id } = request.params as { id: string };
        const job = await jobRepo.findById(id);
        if (!job) {
          return reply.status(404).send({ error: 'NOT_FOUND', message: `Verification job ${id} not found` });
        }
        return reply.status(200).send(job);
      }, { userId: user.userId, roles: user.roles });
    }
  );
}
