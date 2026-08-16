/**
 * Xylarc AI — Platform Administration REST API Routes
 * Endpoints for Operator Control Plane, Tenant Lifecycle, Fleet Health & Maintenance (§10–§14, §24).
 */

import { FastifyInstance } from 'fastify';
import { AdminService } from '../../admin/service/adminService.js';
import {
  ProvisionTenantRequestSchema,
  UpdateTenantStatusRequestSchema,
  NodeHeartbeatRequestSchema,
  CreateAnnouncementRequestSchema,
  UpdateMaintenanceStateRequestSchema,
} from '../../admin/types/adminTypes.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { requirePermission } from '../middleware/rbacMiddleware.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';

export async function adminRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new AdminService();

  // 1. Provision Tenant
  fastify.post(
    '/api/v1/admin/tenants/provision',
    { preHandler: [authenticate, requirePermission('system:admin')] },
    async (request, reply) => {
      const user = request.user!;
      const body = ProvisionTenantRequestSchema.parse(request.body);
      const tenant = await service.provisionTenant(body, user.userId);
      return reply.status(201).send(tenant);
    }
  );

  // 2. Update Tenant Lifecycle Status
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

  // 3. List All Tenants
  fastify.get(
    '/api/v1/admin/tenants',
    { preHandler: [authenticate, requirePermission('system:admin')] },
    async (request, reply) => {
      const tenants = await service.listAllTenants();
      return reply.status(200).send({ tenants, count: tenants.length });
    }
  );

  // 4. Record Node Fleet Heartbeat
  fastify.post(
    '/api/v1/admin/fleet/heartbeat',
    { preHandler: [authenticate, requirePermission('system:admin')] },
    async (request, reply) => {
      const body = NodeHeartbeatRequestSchema.parse(request.body);
      const record = await service.recordNodeHeartbeat(body);
      return reply.status(200).send(record);
    }
  );

  // 5. Get Fleet Diagnostics Overview
  fastify.get(
    '/api/v1/admin/fleet/diagnostics',
    { preHandler: [authenticate, requirePermission('system:admin')] },
    async (request, reply) => {
      const diagnostics = await service.getFleetDiagnostics();
      return reply.status(200).send(diagnostics);
    }
  );

  // 6. Update Platform Maintenance State
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

  // 7. Get Current Maintenance State
  fastify.get(
    '/api/v1/admin/maintenance',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const state = await service.getMaintenanceState();
      return reply.status(200).send(state);
    }
  );

  // 8. Create System Announcement
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

  // 9. List Active Announcements for Authenticated Tenant
  fastify.get(
    '/api/v1/admin/announcements',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const user = request.user!;
      const announcements = await service.listAnnouncementsForTenant(user.tenantId);
      return reply.status(200).send({ announcements, count: announcements.length });
    }
  );

  // 10. List Operator Audit Logs
  fastify.get(
    '/api/v1/admin/audit-logs',
    { preHandler: [authenticate, requirePermission('system:admin')] },
    async (request, reply) => {
      const { limit } = request.query as { limit?: string };
      const parsedLimit = limit ? parseInt(limit, 10) : 100;
      const logs = await service.listOperatorLogs(parsedLimit);
      return reply.status(200).send({ logs, count: logs.length });
    }
  );
}
