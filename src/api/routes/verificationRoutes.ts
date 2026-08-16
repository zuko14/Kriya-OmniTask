/**
 * Xylarc AI — Deterministic Verification & Quality Review REST Routes
 * Endpoints for Pre-flight Checks, Quality Scoring, and Review Verdicts (§14, §15 of CLAUDE.md).
 */

import { FastifyInstance } from 'fastify';
import {
  QualityReviewRequestSchema,
  ListReviewsQuerySchema,
} from '../../verification/types/verificationTypes.js';
import { VerificationService } from '../../verification/service/verificationService.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { requirePermission } from '../middleware/rbacMiddleware.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';

export async function verificationRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new VerificationService();

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
}
