/**
 * Kriya AI — User Management & Invitation Routes
 */

import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { UserRepository } from '../../storage/repositories/userRepository.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { requirePermission } from '../middleware/rbacMiddleware.js';
import { ValidationError, ConflictError } from '../../core/errors/errors.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import { auditLogger } from '../../security/audit/auditLogger.js';

const userRepo = new UserRepository();

const InviteUserSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(2),
  temporaryPassword: z.string().min(8),
  role: z.enum([
    'admin',
    'operations_manager',
    'sales_manager',
    'support_manager',
    'analyst',
    'finance',
    'agent_operator',
    'read_only',
  ]).default('read_only'),
});

export async function userRoutes(fastify: FastifyInstance): Promise<void> {
  // 1. List Users in Tenant
  fastify.get('/api/v1/users', {
    preHandler: [authenticate, requirePermission('user:read')],
  }, async (request, reply) => {
    const user = request.user!;
    return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
      const users = await userRepo.findAll();
      const safeUsers = users.map(({ password_hash: _, ...u }) => u);
      return reply.send({ users: safeUsers });
    }, { userId: user.userId, roles: user.roles });
  });

  // 2. Invite/Create User in Tenant
  fastify.post('/api/v1/users/invite', {
    preHandler: [authenticate, requirePermission('user:invite')],
  }, async (request, reply) => {
    const user = request.user!;
    const parseResult = InviteUserSchema.safeParse(request.body);
    if (!parseResult.success) {
      throw new ValidationError('User invitation validation failed', { issues: parseResult.error.issues });
    }

    const body = parseResult.data;

    return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
      const existing = await userRepo.findByEmail(body.email);
      if (existing) {
        throw new ConflictError(`User with email '${body.email}' already exists in this tenant.`);
      }

      const created = await userRepo.createWithPassword({
        email: body.email,
        password: body.temporaryPassword,
        full_name: body.fullName,
      });

      await userRepo.assignRoleByName(created.id, body.role);

      await auditLogger.logEvent({
        action: 'user.invited',
        resourceType: 'user',
        resourceId: created.id,
        details: { email: created.email, assignedRole: body.role },
      });

      return reply.status(201).send({ user: created, assignedRole: body.role });
    }, { userId: user.userId, roles: user.roles });
  });
}
