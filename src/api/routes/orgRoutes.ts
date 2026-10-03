/**
 * Kriya AI — Customer Organization & Workspace Routes
 */

import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { OrganizationRepository, WorkspaceRepository } from '../../storage/repositories/orgRepository.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { requirePermission } from '../middleware/rbacMiddleware.js';
import { ValidationError } from '../../core/errors/errors.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import { auditLogger } from '../../security/audit/auditLogger.js';

const orgRepo = new OrganizationRepository();
const workspaceRepo = new WorkspaceRepository();

const CreateOrgSchema = z.object({
  name: z.string().min(2),
  slug: z.string().min(2).regex(/^[a-z0-9-]+$/),
});

const CreateWorkspaceSchema = z.object({
  name: z.string().min(2),
  slug: z.string().min(2).regex(/^[a-z0-9-]+$/),
});

export async function orgRoutes(fastify: FastifyInstance): Promise<void> {
  // 1. List Organizations
  fastify.get('/api/v1/organizations', {
    preHandler: [authenticate, requirePermission('org:read')],
  }, async (request, reply) => {
    const user = request.user!;
    return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
      const orgs = await orgRepo.findAll();
      return reply.send({ organizations: orgs });
    }, { userId: user.userId, roles: user.roles });
  });

  // 2. Create Organization
  fastify.post('/api/v1/organizations', {
    preHandler: [authenticate, requirePermission('org:write')],
  }, async (request, reply) => {
    const user = request.user!;
    const parseResult = CreateOrgSchema.safeParse(request.body);
    if (!parseResult.success) {
      throw new ValidationError('Organization validation failed', { issues: parseResult.error.issues });
    }

    const body = parseResult.data;

    return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
      const created = await orgRepo.create({
        name: body.name,
        slug: body.slug,
      });

      await auditLogger.logEvent({
        action: 'organization.created',
        resourceType: 'organization',
        resourceId: created.id,
        details: { name: created.name, slug: created.slug },
      });

      return reply.status(201).send({ organization: created });
    }, { userId: user.userId, roles: user.roles });
  });

  // 3. List Workspaces for Organization
  fastify.get('/api/v1/organizations/:orgId/workspaces', {
    preHandler: [authenticate, requirePermission('org:read')],
  }, async (request, reply) => {
    const { orgId } = request.params as { orgId: string };
    const user = request.user!;

    return TenantContextManager.withTenant(user.tenantId, orgId, async () => {
      // Verify org belongs to tenant
      await orgRepo.getById(orgId);
      const workspaces = await workspaceRepo.findByOrg(orgId);
      return reply.send({ workspaces });
    }, { userId: user.userId, roles: user.roles });
  });

  // 4. Create Workspace within Organization
  fastify.post('/api/v1/organizations/:orgId/workspaces', {
    preHandler: [authenticate, requirePermission('org:write')],
  }, async (request, reply) => {
    const { orgId } = request.params as { orgId: string };
    const user = request.user!;
    const parseResult = CreateWorkspaceSchema.safeParse(request.body);
    if (!parseResult.success) {
      throw new ValidationError('Workspace validation failed', { issues: parseResult.error.issues });
    }

    const body = parseResult.data;

    return TenantContextManager.withTenant(user.tenantId, orgId, async () => {
      // Verify org belongs to tenant
      await orgRepo.getById(orgId);

      const workspace = await workspaceRepo.create({
        organization_id: orgId,
        name: body.name,
        slug: body.slug,
      });

      await auditLogger.logEvent({
        action: 'workspace.created',
        resourceType: 'workspace',
        resourceId: workspace.id,
        details: { organizationId: orgId, name: workspace.name, slug: workspace.slug },
      });

      return reply.status(201).send({ workspace });
    }, { userId: user.userId, roles: user.roles });
  });
}
