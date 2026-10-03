/**
 * Kriya AI — Security Hardening & Zero-Trust Audit REST Routes
 * Endpoints for Chained Audit Ledger, Secret Rotation, and Zero-Trust Compliance Scans (§14, §20 of CLAUDE.md).
 */

import { FastifyInstance } from 'fastify';
import {
  LogSecurityEventRequestSchema,
  RotateSecretRequestSchema,
  RunSecurityScanRequestSchema,
} from '../../security/hardening/types/securityHardeningTypes.js';
import { SecurityHardeningService } from '../../security/hardening/service/securityHardeningService.js';
import { TenantRateLimiter, RateLimitCategory } from '../../security/ratelimit/tenantRateLimiter.js';
import { VaptEngine, VaptReport } from '../../security/vapt/vaptEngine.js';
import { DependencyAuditScanner } from '../../security/audit/dependencyAuditScanner.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { requirePermission } from '../middleware/rbacMiddleware.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';

export async function securityHardeningRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new SecurityHardeningService();
  const rateLimiter = TenantRateLimiter.getInstance();
  const vaptEngine = new VaptEngine(rateLimiter);

  // Cached latest VAPT report
  let latestVaptReport: VaptReport | null = null;

  // 1. Log Chained Audit Event
  fastify.post(
    '/api/v1/security/audit/log',
    { preHandler: [authenticate, requirePermission('tenant:write')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const body = LogSecurityEventRequestSchema.parse(request.body);
        const record = await service.logEvent(body);
        return reply.status(201).send(record);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 2. Verify Audit Ledger Integrity
  fastify.get(
    '/api/v1/security/audit/verify',
    { preHandler: [authenticate, requirePermission('audit:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const report = await service.verifyAuditLedger();
        return reply.status(200).send(report);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 3. Rotate Secret / Key
  fastify.post(
    '/api/v1/security/secrets/rotate',
    { preHandler: [authenticate, requirePermission('tenant:write')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const body = RotateSecretRequestSchema.parse(request.body);
        const result = await service.rotateSecret(body);
        return reply.status(201).send(result);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 4. List Secret Versions
  fastify.get(
    '/api/v1/security/secrets',
    { preHandler: [authenticate, requirePermission('tenant:write')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const { secretName } = request.query as { secretName?: string };
        const secrets = await service.listSecrets(secretName);
        return reply.status(200).send({ secrets, count: secrets.length });
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 5. Secret Vault Hygiene Report
  fastify.get(
    '/api/v1/security/secrets/hygiene',
    { preHandler: [authenticate, requirePermission('tenant:write')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const hygiene = await service.getSecretHygieneReport();
        return reply.status(200).send(hygiene);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 6. Run Zero-Trust Compliance Scan
  fastify.post(
    '/api/v1/security/scan',
    { preHandler: [authenticate, requirePermission('audit:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        RunSecurityScanRequestSchema.parse(request.body || {});
        const report = await service.runComplianceScan(user.roles);
        return reply.status(200).send(report);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 7. Run Automated VAPT Penetration Suite
  fastify.post(
    '/api/v1/security/vapt/run',
    { preHandler: [authenticate, requirePermission('system:admin')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const report = await vaptEngine.runFullSuite();
        latestVaptReport = report;
        return reply.status(200).send(report);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 8. Get Latest VAPT Report
  fastify.get(
    '/api/v1/security/vapt/report',
    { preHandler: [authenticate, requirePermission('audit:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        if (!latestVaptReport) {
          latestVaptReport = await vaptEngine.runFullSuite();
        }
        return reply.status(200).send(latestVaptReport);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 9. Get Tenant Rate Limit Status
  fastify.get(
    '/api/v1/security/rate-limits/status',
    { preHandler: [authenticate, requirePermission('tenant:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const status = rateLimiter.getTenantStatus(user.tenantId);
        return reply.status(200).send(status);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 10. Reset Tenant Rate Limits (Admin/Operator Only)
  fastify.post(
    '/api/v1/security/rate-limits/reset',
    { preHandler: [authenticate, requirePermission('system:admin')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const body = (request.body as { targetTenantId?: string; category?: RateLimitCategory }) || {};
        const targetTenant = body.targetTenantId || user.tenantId;
        rateLimiter.resetTenant(targetTenant, body.category);
        return reply.status(200).send({
          success: true,
          message: `Rate limit buckets and abuse strikes reset for tenant '${targetTenant}'.`,
        });
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 11. Run Dependency & Dangerous Native Code Audit Scan
  fastify.post(
    '/api/v1/security/scans/dependencies',
    { preHandler: [authenticate, requirePermission('system:admin')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const report = await DependencyAuditScanner.runAudit(process.cwd());
        return reply.status(200).send(report);
      }, { userId: user.userId, roles: user.roles });
    }
  );
}
