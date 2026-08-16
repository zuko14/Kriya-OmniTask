/**
 * Xylarc AI — Security Hardening & Zero-Trust Audit REST Routes
 * Endpoints for Chained Audit Ledger, Secret Rotation, and Zero-Trust Compliance Scans (§14, §20 of CLAUDE.md).
 */

import { FastifyInstance } from 'fastify';
import {
  LogSecurityEventRequestSchema,
  RotateSecretRequestSchema,
  RunSecurityScanRequestSchema,
} from '../../security/hardening/types/securityHardeningTypes.js';
import { SecurityHardeningService } from '../../security/hardening/service/securityHardeningService.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { requirePermission } from '../middleware/rbacMiddleware.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';

export async function securityHardeningRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new SecurityHardeningService();

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

  // 5. Run Zero-Trust Compliance Scan
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
}
