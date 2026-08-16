/**
 * Xylarc AI — Tenant Management & Quotas Routes
 */

import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { TenantRepository } from '../../storage/repositories/tenantRepository.js';
import { QuotaService } from '../../control-plane/quotas/quotaService.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { requirePermission } from '../middleware/rbacMiddleware.js';
import { ValidationError, NotFoundError, ForbiddenError } from '../../core/errors/errors.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import { auditLogger } from '../../security/audit/auditLogger.js';

const tenantRepo = new TenantRepository();
const quotaService = new QuotaService(tenantRepo);

const ConfigUpdateSchema = z.object({
  settings: z.record(z.unknown()),
});

export async function tenantRoutes(fastify: FastifyInstance): Promise<void> {
  // 1. Get Tenant Profile
  fastify.get('/api/v1/tenants/:id', {
    preHandler: [authenticate, requirePermission('tenant:read')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;

    if (user.tenantId !== id && !user.roles.includes('system')) {
      throw new ForbiddenError('Cannot access other tenant details');
    }

    const tenant = await tenantRepo.findById(id);
    if (!tenant) {
      throw new NotFoundError(`Tenant ${id} not found`);
    }

    const config = await tenantRepo.getConfiguration(id);
    const limits = await quotaService.getEffectiveLimits(id);

    return reply.send({
      tenant,
      configuration: config,
      limits,
    });
  });

  // 2. Update Tenant Configuration & Feature Flags
  fastify.patch('/api/v1/tenants/:id/config', {
    preHandler: [authenticate, requirePermission('tenant:admin')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;

    if (user.tenantId !== id && !user.roles.includes('system')) {
      throw new ForbiddenError('Cannot modify other tenant configuration');
    }

    const parseResult = ConfigUpdateSchema.safeParse(request.body);
    if (!parseResult.success) {
      throw new ValidationError('Config validation failed', { issues: parseResult.error.issues });
    }

    await tenantRepo.setConfiguration(id, parseResult.data.settings);

    await TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
      await auditLogger.logEvent({
        action: 'tenant.config_updated',
        resourceType: 'tenant',
        resourceId: id,
        details: parseResult.data.settings,
      });
    }, { userId: user.userId, roles: user.roles });

    return reply.send({ success: true, message: 'Tenant configuration updated successfully' });
  });

  // 3. Get Effective Quotas & Plan Limits
  fastify.get('/api/v1/tenants/:id/limits', {
    preHandler: [authenticate, requirePermission('tenant:read')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;

    if (user.tenantId !== id && !user.roles.includes('system')) {
      throw new ForbiddenError('Cannot access other tenant limits');
    }

    const limits = await quotaService.getEffectiveLimits(id);
    return reply.send({ limits });
  });
}
