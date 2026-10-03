/**
 * Kriya AI — Authentication & Identity Routes
 */

import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { UserRepository } from '../../storage/repositories/userRepository.js';
import { TenantRepository } from '../../storage/repositories/tenantRepository.js';
import { OrganizationRepository } from '../../storage/repositories/orgRepository.js';
import { CryptoUtils } from '../../core/utils/crypto.js';
import { JwtService } from '../../security/auth/jwt.js';
import { ValidationError, UnauthorizedError, ConflictError } from '../../core/errors/errors.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { auditLogger } from '../../security/audit/auditLogger.js';

const userRepo = new UserRepository();
const tenantRepo = new TenantRepository();
const orgRepo = new OrganizationRepository();

const RegisterSchema = z.object({
  tenantName: z.string().min(2),
  tenantSlug: z.string().min(2).regex(/^[a-z0-9-]+$/),
  organizationName: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  fullName: z.string().min(2),
  planTier: z.enum(['standard', 'pro', 'enterprise']).default('standard'),
  channelPlan: z.enum(['whatsapp_only', 'voice_only', 'combined']).default('combined'),
});

const LoginSchema = z.object({
  tenantSlug: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(1),
});

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  // 1. Initial Tenant & Owner Registration
  fastify.post('/api/v1/auth/register', async (request, reply) => {
    const parseResult = RegisterSchema.safeParse(request.body);
    if (!parseResult.success) {
      throw new ValidationError('Registration validation failed', { issues: parseResult.error.issues });
    }

    const body = parseResult.data;

    // Check slug availability
    const existingTenant = await tenantRepo.findBySlug(body.tenantSlug);
    if (existingTenant) {
      throw new ConflictError(`Tenant slug '${body.tenantSlug}' is already registered.`);
    }

    // 1. Create Tenant
    const tenant = await tenantRepo.create({
      name: body.tenantName,
      slug: body.tenantSlug,
      plan_tier: body.planTier,
      channel_plan: body.channelPlan,
    });

    // 2. Run inside tenant context to create initial organization and owner user
    const result = await TenantContextManager.withTenant(tenant.id, 'root-org', async () => {
      // Create Organization
      const org = await orgRepo.create({
        name: body.organizationName,
        slug: 'primary',
      });

      // Create Owner User
      const user = await userRepo.createWithPassword({
        email: body.email,
        password: body.password,
        full_name: body.fullName,
      });

      // Create & Assign Owner Role
      await userRepo.assignRoleByName(user.id, 'owner');

      // Audit Log
      await auditLogger.logEvent({
        action: 'tenant.registered',
        resourceType: 'tenant',
        resourceId: tenant.id,
        details: { email: user.email, planTier: tenant.plan_tier, channelPlan: tenant.channel_plan },
      });

      // Generate Access Token
      const token = JwtService.sign({
        userId: user.id,
        tenantId: tenant.id,
        organizationId: org.id,
        roles: ['owner'],
        email: user.email,
      });

      return {
        tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug, planTier: tenant.plan_tier },
        organization: { id: org.id, name: org.name, slug: org.slug },
        user: { id: user.id, email: user.email, fullName: user.full_name },
        accessToken: token,
      };
    });

    return reply.status(201).send(result);
  });

  // 2. User Login
  fastify.post('/api/v1/auth/login', async (request, reply) => {
    const parseResult = LoginSchema.safeParse(request.body);
    if (!parseResult.success) {
      throw new ValidationError('Login validation failed', { issues: parseResult.error.issues });
    }

    const body = parseResult.data;
    const tenant = await tenantRepo.findBySlug(body.tenantSlug);
    if (!tenant || tenant.status !== 'active') {
      throw new UnauthorizedError('Invalid tenant or account is inactive');
    }

    const authResult = await TenantContextManager.withTenant(tenant.id, 'auth-lookup', async () => {
      const user = await userRepo.findByEmail(body.email);
      if (!user || user.status !== 'active') {
        throw new UnauthorizedError('Invalid email or password');
      }

      const isValid = CryptoUtils.verifyPassword(body.password, user.password_hash);
      if (!isValid) {
        throw new UnauthorizedError('Invalid email or password');
      }

      const roles = (await userRepo.getUserRoles(user.id)).map((r) => r.name);
      const effectiveRoles = roles.length > 0 ? roles : ['read_only'];

      const token = JwtService.sign({
        userId: user.id,
        tenantId: tenant.id,
        roles: effectiveRoles,
        email: user.email,
      });

      await auditLogger.logEvent({
        action: 'user.login',
        resourceType: 'user',
        resourceId: user.id,
        details: { email: user.email },
      });

      return {
        accessToken: token,
        user: {
          id: user.id,
          email: user.email,
          fullName: user.full_name,
          roles: effectiveRoles,
        },
        tenant: {
          id: tenant.id,
          name: tenant.name,
          slug: tenant.slug,
          planTier: tenant.plan_tier,
          channelPlan: tenant.channel_plan,
        },
      };
    });

    return reply.send(authResult);
  });

  // 3. Current Authenticated Profile
  fastify.get('/api/v1/auth/me', { preHandler: [authenticate] }, async (request, reply) => {
    const userPayload = request.user!;
    return TenantContextManager.withTenant(userPayload.tenantId, userPayload.organizationId || 'default', async () => {
      const user = await userRepo.findById(userPayload.userId);
      if (!user) {
        throw new UnauthorizedError('User account not found');
      }

      const tenant = await tenantRepo.findById(userPayload.tenantId);

      return reply.send({
        user: {
          id: user.id,
          email: user.email,
          fullName: user.full_name,
          roles: userPayload.roles,
        },
        tenant: {
          id: tenant?.id,
          name: tenant?.name,
          slug: tenant?.slug,
          planTier: tenant?.plan_tier,
          channelPlan: tenant?.channel_plan,
        },
      });
    }, { userId: userPayload.userId, roles: userPayload.roles });
  });
}
