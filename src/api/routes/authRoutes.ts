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
import { ValidationError, UnauthorizedError, ConflictError, ForbiddenError } from '../../core/errors/errors.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { auditLogger } from '../../security/audit/auditLogger.js';
import { isSandboxMode } from '../../core/config/runtimeMode.js';
import {
  PLATFORM_ROLES,
  isPlatformTenantSlug,
  platformTenantSlug,
  scopeRolesToTenant,
} from '../../security/auth/platformOperator.js';

/** Credential endpoints get a tight per-IP budget on top of the global limiter (brute-force guard). */
const LOGIN_RATE_LIMIT = { rateLimit: { max: 10, timeWindow: '1 minute' } };

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

const PlatformLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

async function signIn(tenantSlug: string, email: string, password: string) {
  const tenant = await tenantRepo.findBySlug(tenantSlug);
  if (!tenant || tenant.status !== 'active') {
    throw new UnauthorizedError('Invalid workspace, email or password, or the workspace is inactive');
  }

  return TenantContextManager.withTenant(tenant.id, 'auth-lookup', async () => {
    const user = await userRepo.findByEmail(email);
    if (!user || user.status !== 'active' || !CryptoUtils.verifyPassword(password, user.password_hash)) {
      await auditLogger.logEvent({
        action: 'user.login_failed',
        resourceType: 'user',
        resourceId: user?.id,
        details: { email: email.toLowerCase().trim() },
      });
      throw new UnauthorizedError('Invalid workspace, email or password, or the workspace is inactive');
    }

    const roles = scopeRolesToTenant((await userRepo.getUserRoles(user.id)).map((r) => r.name), tenant.slug);
    const effectiveRoles = roles.length > 0 ? roles : ['read_only'];

    const token = JwtService.sign({
      userId: user.id,
      tenantId: tenant.id,
      roles: effectiveRoles,
      email: user.email,
    });

    // Attribute the login to the user (the lookup itself runs before a user is in context).
    await TenantContextManager.withTenant(
      tenant.id,
      'auth-lookup',
      () =>
        auditLogger.logEvent({
          action: 'user.login',
          resourceType: 'user',
          resourceId: user.id,
          details: { email: user.email },
        }),
      { userId: user.id, roles: effectiveRoles }
    );

    return {
      accessToken: token,
      user: { id: user.id, email: user.email, fullName: user.full_name, roles: effectiveRoles },
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        planTier: tenant.plan_tier,
        channelPlan: tenant.channel_plan,
      },
      isPlatformOperator: isPlatformTenantSlug(tenant.slug),
    };
  });
}

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  // 1. Initial Tenant & Owner Registration — clients are provisioned from the /owner console;
  // public self-signup is off outside sandbox/test unless explicitly enabled.
  fastify.post('/api/v1/auth/register', { config: LOGIN_RATE_LIMIT }, async (request, reply) => {
    if (!isSandboxMode() && process.env.ALLOW_PUBLIC_SIGNUP !== 'true') {
      throw new ForbiddenError('Self-registration is disabled. Contact your platform operator for a workspace.');
    }
    const parseResult = RegisterSchema.safeParse(request.body);
    if (!parseResult.success) {
      throw new ValidationError('Registration validation failed', { issues: parseResult.error.issues });
    }

    const body = parseResult.data;
    if (isPlatformTenantSlug(body.tenantSlug)) {
      throw new ConflictError(`Tenant slug '${body.tenantSlug}' is already registered.`);
    }

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

  // 2. Client Login (/admin portal)
  fastify.post('/api/v1/auth/login', { config: LOGIN_RATE_LIMIT }, async (request, reply) => {
    const parseResult = LoginSchema.safeParse(request.body);
    if (!parseResult.success) {
      throw new ValidationError('Login validation failed', { issues: parseResult.error.issues });
    }
    const body = parseResult.data;
    return reply.send(await signIn(body.tenantSlug, body.email, body.password));
  });

  // 2b. Platform Owner Login (/owner console) — the platform tenant is implied, never typed.
  fastify.post('/api/v1/auth/platform-login', { config: LOGIN_RATE_LIMIT }, async (request, reply) => {
    const parseResult = PlatformLoginSchema.safeParse(request.body);
    if (!parseResult.success) {
      throw new ValidationError('Login validation failed', { issues: parseResult.error.issues });
    }
    const body = parseResult.data;
    const result = await signIn(platformTenantSlug(), body.email, body.password);
    if (!result.user.roles.some((r) => PLATFORM_ROLES.includes(r))) {
      throw new UnauthorizedError('Invalid email or password');
    }
    return reply.send(result);
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
        isPlatformOperator: isPlatformTenantSlug(tenant?.slug),
      });
    }, { userId: userPayload.userId, roles: userPayload.roles });
  });
}
