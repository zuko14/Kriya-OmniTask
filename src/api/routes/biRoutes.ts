/**
 * Xylarc AI — Business Intelligence & Executive Daily Briefing REST Routes
 * Endpoints for multi-source daily summaries, metric snapshots, and outbound delivery (§13, §14 of CLAUDE.md).
 */

import { FastifyInstance } from 'fastify';
import {
  GenerateBriefingRequestSchema,
  DeliverBriefingRequestSchema,
} from '../../bi/types/biTypes.js';
import { BusinessIntelligenceService } from '../../bi/service/businessIntelligenceService.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { requirePermission } from '../middleware/rbacMiddleware.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import { z } from 'zod';

const ListBriefingsQuerySchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

export async function biRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new BusinessIntelligenceService();

  // 1. Generate Executive Daily Briefing On-Demand
  fastify.post(
    '/api/v1/bi/briefings/generate',
    { preHandler: [authenticate, requirePermission('audit:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const body = GenerateBriefingRequestSchema.parse(request.body || {});
        const result = await service.generateDailyBriefing(body);
        return reply.status(201).send(result);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 2. List Past Briefings
  fastify.get(
    '/api/v1/bi/briefings',
    { preHandler: [authenticate, requirePermission('audit:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const query = ListBriefingsQuerySchema.parse(request.query);
        const briefings = await service.listBriefings(query.startDate, query.endDate);
        return reply.status(200).send({ briefings, count: briefings.length });
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 3. Get Specific Briefing by ID
  fastify.get(
    '/api/v1/bi/briefings/:id',
    { preHandler: [authenticate, requirePermission('audit:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const { id } = request.params as { id: string };
        const briefing = await service.getBriefingById(id);
        return reply.status(200).send(briefing);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 4. Deliver Briefing via WhatsApp Outbound Queue
  fastify.post(
    '/api/v1/bi/briefings/:id/deliver',
    { preHandler: [authenticate, requirePermission('audit:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const { id } = request.params as { id: string };
        const body = DeliverBriefingRequestSchema.parse(request.body);
        const result = await service.deliverBriefingViaWhatsApp(id, body.recipientPhoneNumber);
        return reply.status(200).send(result);
      }, { userId: user.userId, roles: user.roles });
    }
  );
}
