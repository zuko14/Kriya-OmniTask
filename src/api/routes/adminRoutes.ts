/**
 * Kriya Omnitask — Platform Administration REST API Routes
 * Endpoints for Operator Control Plane, Enterprise Provisioning, Elevation & Fleet Health (§2, §17.1, §17.2, §17.6).
 */

import { FastifyInstance } from 'fastify';
import { AdminService } from '../../admin/service/adminService.js';
import {
  ProvisionTenantRequestSchema,
  UpdateTenantStatusRequestSchema,
  ElevateSessionRequestSchema,
  NodeHeartbeatRequestSchema,
  CreateAnnouncementRequestSchema,
  UpdateMaintenanceStateRequestSchema,
} from '../../admin/types/adminTypes.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { requirePermission } from '../middleware/rbacMiddleware.js';

export async function adminRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new AdminService();

  // 1. Provision Tenant (§2, §17.2)
  fastify.post(
    '/api/v1/admin/tenants/provision',
    { preHandler: [authenticate, requirePermission('system:admin')] },
    async (request, reply) => {
      const user = request.user!;
      const body = ProvisionTenantRequestSchema.parse(request.body);
      const result = await service.provisionTenant(body, user.userId);
      return reply.status(201).send(result);
    }
  );

  // 2. Organizations Roster (§17.1)
  fastify.get(
    '/api/v1/admin/organizations/roster',
    { preHandler: [authenticate, requirePermission('system:admin')] },
    async (request, reply) => {
      const roster = await service.listOrganizationsRoster();
      return reply.status(200).send({ organizations: roster, count: roster.length });
    }
  );

  // 3. Operator Elevation into Tenant (§17.6)
  fastify.post(
    '/api/v1/admin/tenants/:id/elevate',
    { preHandler: [authenticate, requirePermission('system:admin')] },
    async (request, reply) => {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const body = ElevateSessionRequestSchema.parse(request.body);
      const result = await service.elevateIntoTenant(id, body, {
        userId: user.userId,
        email: user.email,
        fullName: 'Platform Operator',
      });
      return reply.status(200).send(result);
    }
  );

  // 4. Revoke Elevation Session
  fastify.post(
    '/api/v1/admin/tenants/:id/elevation/revoke',
    { preHandler: [authenticate, requirePermission('system:admin')] },
    async (request, reply) => {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const { sessionId } = (request.body as { sessionId: string }) || {};
      if (!sessionId) {
        return reply.status(400).send({ error: 'sessionId is required' });
      }
      await service.revokeElevation(id, sessionId, user.userId);
      return reply.status(200).send({ message: `Elevation session '${sessionId}' revoked.` });
    }
  );

  // 5. Get Active Elevation Status
  fastify.get(
    '/api/v1/admin/tenants/:id/elevation',
    { preHandler: [authenticate, requirePermission('system:admin')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const active = await service.getActiveElevation(id);
      return reply.status(200).send({ activeElevation: active });
    }
  );

  // 6. Update Tenant Lifecycle Status
  fastify.put(
    '/api/v1/admin/tenants/:id/status',
    { preHandler: [authenticate, requirePermission('system:admin')] },
    async (request, reply) => {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const body = UpdateTenantStatusRequestSchema.parse(request.body);
      await service.updateTenantStatus(id, body, user.userId);
      return reply.status(200).send({ message: `Tenant '${id}' status updated to '${body.status}'.` });
    }
  );

  // 7. List All Tenants (raw)
  fastify.get(
    '/api/v1/admin/tenants',
    { preHandler: [authenticate, requirePermission('system:admin')] },
    async (request, reply) => {
      const tenants = await service.listAllTenants();
      return reply.status(200).send({ tenants, count: tenants.length });
    }
  );

  // 8. Record Node Fleet Heartbeat
  fastify.post(
    '/api/v1/admin/fleet/heartbeat',
    { preHandler: [authenticate, requirePermission('system:admin')] },
    async (request, reply) => {
      const body = NodeHeartbeatRequestSchema.parse(request.body);
      const record = await service.recordNodeHeartbeat(body);
      return reply.status(200).send(record);
    }
  );

  // 9. Get Fleet Diagnostics Overview
  fastify.get(
    '/api/v1/admin/fleet/diagnostics',
    { preHandler: [authenticate, requirePermission('system:admin')] },
    async (request, reply) => {
      const diagnostics = await service.getFleetDiagnostics();
      return reply.status(200).send(diagnostics);
    }
  );

  // 10. Update Platform Maintenance State
  fastify.post(
    '/api/v1/admin/maintenance',
    { preHandler: [authenticate, requirePermission('system:admin')] },
    async (request, reply) => {
      const user = request.user!;
      const body = UpdateMaintenanceStateRequestSchema.parse(request.body);
      const state = await service.updateMaintenanceState(body, user.userId);
      return reply.status(200).send(state);
    }
  );

  // 11. Get Current Maintenance State
  fastify.get(
    '/api/v1/admin/maintenance',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const state = await service.getMaintenanceState();
      return reply.status(200).send(state);
    }
  );

  // 12. Create System Announcement
  fastify.post(
    '/api/v1/admin/announcements',
    { preHandler: [authenticate, requirePermission('system:admin')] },
    async (request, reply) => {
      const user = request.user!;
      const body = CreateAnnouncementRequestSchema.parse(request.body);
      const announcement = await service.createAnnouncement(body, user.userId);
      return reply.status(201).send(announcement);
    }
  );

  fastify.get(
    '/api/v1/admin/announcements',
    { preHandler: [authenticate, requirePermission('system:admin')] },
    async (request, reply) => {
      const announcements = await service.listAllAnnouncements();
      return reply.status(200).send({ announcements, count: announcements.length });
    }
  );

  // 13. List Operator Audit Logs
  fastify.get(
    '/api/v1/admin/audit-logs',
    { preHandler: [authenticate, requirePermission('system:admin')] },
    async (request, reply) => {
      const { limit } = request.query as { limit?: string };
      const logs = await service.listOperatorLogs(limit ? parseInt(limit, 10) : 100);
      return reply.status(200).send({ logs, count: logs.length });
    }
  );
}
