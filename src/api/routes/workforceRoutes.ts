/**
 * Xylarc AI — Customer Lifecycle Workforce REST Routes
 * Fastify REST endpoints for Lead Qualification, Calendar Booking, Support Resolution, and Customer Reactivation (§23-§28 of CLAUDE.md).
 */

import { FastifyInstance } from 'fastify';
import { LifecycleWorkforceService } from '../../workforce/service/lifecycleWorkforceService.js';
import {
  QualifyLeadRequestSchema,
  BookSlotRequestSchema,
  HandleSupportRequestSchema,
  ReactivationRequestSchema,
  CustomerLifecycleStageEnum,
} from '../../workforce/types/workforceTypes.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { requirePermission } from '../middleware/rbacMiddleware.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import { z } from 'zod';

const TransitionStageBodySchema = z.object({
  customerId: z.string().min(1),
  stage: CustomerLifecycleStageEnum,
  reason: z.string().optional(),
});

export async function workforceRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new LifecycleWorkforceService();

  // 1. Qualify Lead
  fastify.post(
    '/api/v1/workforce/qualify-lead',
    { preHandler: [authenticate, requirePermission('customer:write')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const body = QualifyLeadRequestSchema.parse(request.body);
        const result = await service.qualifyLead(body);
        return reply.status(200).send(result);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 2. Book or Propose Calendar Slot
  fastify.post(
    '/api/v1/workforce/book-slot',
    { preHandler: [authenticate, requirePermission('customer:write')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const body = BookSlotRequestSchema.parse(request.body);
        const result = await service.bookSlot(body);
        return reply.status(200).send(result);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 3. Handle Support Ticket
  fastify.post(
    '/api/v1/workforce/handle-support',
    { preHandler: [authenticate, requirePermission('customer:write')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const body = HandleSupportRequestSchema.parse(request.body);
        const result = await service.handleSupportTicket(body);
        return reply.status(200).send(result);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 4. Trigger Win-back Reactivation
  fastify.post(
    '/api/v1/workforce/trigger-reactivation',
    { preHandler: [authenticate, requirePermission('customer:write')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const body = ReactivationRequestSchema.parse(request.body);
        const result = await service.triggerReactivation(body);
        return reply.status(200).send(result);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 5. Transition Customer Lifecycle Stage
  fastify.post(
    '/api/v1/workforce/transition-stage',
    { preHandler: [authenticate, requirePermission('customer:write')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const body = TransitionStageBodySchema.parse(request.body);
        const result = await service.transitionStage(body.customerId, body.stage, body.reason);
        return reply.status(200).send(result);
      }, { userId: user.userId, roles: user.roles });
    }
  );
}
