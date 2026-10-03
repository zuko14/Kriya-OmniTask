/**
 * Kriya Omnitask — Business DNA & Roster Manifest REST API Routes (§3, §4, §23)
 * Provides tenant-plane resolution and owner-plane DNA switching & manifest rollback.
 */

import { FastifyInstance } from 'fastify';
import { BusinessDnaService } from '../../governance/dna/businessDnaService.js';
import {
  SwitchDnaRequestSchema,
  RollbackRosterManifestRequestSchema,
} from '../../governance/dna/dnaTypes.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { requirePermission } from '../middleware/rbacMiddleware.js';
import { ForbiddenError } from '../../core/errors/errors.js';

export async function dnaRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new BusinessDnaService();

  // ============================================================================
  // 1. Global DNA Profiles Catalog
  // ============================================================================

  fastify.get(
    '/api/v1/dna/profiles',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const profiles = await service.listProfiles(true);
      return reply.status(200).send({ profiles, count: profiles.length });
    }
  );

  fastify.get(
    '/api/v1/dna/profiles/:id',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const profile = await service.getProfile(id);
      return reply.status(200).send(profile);
    }
  );

  // ============================================================================
  // 2. Tenant-Plane DNA Resolution & Manifest Inspection
  // ============================================================================

  fastify.get(
    '/api/v1/tenants/:id/dna',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const user = request.user!;
      const { id } = request.params as { id: string };

      // Tenant isolation: verify user belongs to tenant or is elevated operator
      if (user.tenantId !== id && !user.roles.includes('role-system-admin') && !user.isElevatedOperator) {
        throw new ForbiddenError(`Access denied to tenant '${id}' DNA resolution.`);
      }

      const resolution = await service.getTenantDnaResolution(id);
      return reply.status(200).send(resolution);
    }
  );

  fastify.get(
    '/api/v1/tenants/:id/roster/manifests',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const user = request.user!;
      const { id } = request.params as { id: string };

      if (user.tenantId !== id && !user.roles.includes('role-system-admin') && !user.isElevatedOperator) {
        throw new ForbiddenError(`Access denied to tenant '${id}' roster manifest history.`);
      }

      const history = await service.listManifestHistory(id);
      return reply.status(200).send({ manifests: history, count: history.length });
    }
  );

  // ============================================================================
  // 3. Owner-Plane DNA Switching & Roster Manifest Rollback (§3, §4, §17.2)
  // ============================================================================

  fastify.post(
    '/api/v1/admin/tenants/:id/dna/switch',
    { preHandler: [authenticate, requirePermission('system:admin')] },
    async (request, reply) => {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const body = SwitchDnaRequestSchema.parse(request.body);

      const result = await service.switchTenantDna(id, body, user.userId);
      return reply.status(200).send(result);
    }
  );

  fastify.post(
    '/api/v1/admin/tenants/:id/roster/rollback',
    { preHandler: [authenticate, requirePermission('system:admin')] },
    async (request, reply) => {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const body = RollbackRosterManifestRequestSchema.parse(request.body);

      const result = await service.rollbackRosterManifest(id, body, user.userId);
      return reply.status(200).send(result);
    }
  );
}
