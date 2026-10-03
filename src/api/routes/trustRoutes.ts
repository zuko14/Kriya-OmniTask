/**
 * Kriya Omnitask — Trust API: Kriya Mandate + Kriya Proof (docs/kriya WP-3.1, WP-3.3)
 *
 *   GET    /api/v1/mandates                 tenant:read
 *   GET    /api/v1/mandates/:id             tenant:read
 *   POST   /api/v1/mandates                 tenant:admin   (owner/admin delegates authority)
 *   DELETE /api/v1/mandates/:id             tenant:admin   (revoke; audited)
 *   GET    /api/v1/proof/receipts           tenant:read   (paginated list)
 *   GET    /api/v1/proof/receipts/:id       tenant:read
 *   GET    /api/v1/proof/receipts/:id/verify tenant:read   (hash + signature + chain link)
 *   GET    /api/v1/proof/chain/verify       tenant:read   (whole tenant chain)
 *   GET    /api/v1/proof/export             tenant:read   (auditor bundle with public keys)
 */

import { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/authMiddleware.js';
import { requirePermission } from '../middleware/rbacMiddleware.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import { MandateService, CreateMandateSchema } from '../../trust/mandate/mandateService.js';
import { ProofService } from '../../trust/proof/proofService.js';

export async function trustRoutes(fastify: FastifyInstance): Promise<void> {
  const mandates = new MandateService();
  const proofs = new ProofService();
  const inTenant = <T>(request: any, fn: () => Promise<T>) => {
    const user = request.user!;
    return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', fn, { userId: user.userId, roles: user.roles });
  };

  fastify.get('/api/v1/mandates', { preHandler: [authenticate, requirePermission('tenant:read')] }, async (request, reply) =>
    inTenant(request, async () => reply.send({ mandates: await mandates.list() }))
  );

  fastify.get('/api/v1/mandates/:id', { preHandler: [authenticate, requirePermission('tenant:read')] }, async (request, reply) =>
    inTenant(request, async () => {
      const m = await mandates.get((request.params as { id: string }).id);
      return m ? reply.send(m) : reply.status(404).send({ error: 'NOT_FOUND' });
    })
  );

  fastify.post('/api/v1/mandates', { preHandler: [authenticate, requirePermission('tenant:admin')] }, async (request, reply) =>
    inTenant(request, async () => {
      const parsed = CreateMandateSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: 'VALIDATION_ERROR', issues: parsed.error.issues });
      return reply.status(201).send(await mandates.create(parsed.data, request.user!.userId));
    })
  );

  fastify.delete('/api/v1/mandates/:id', { preHandler: [authenticate, requirePermission('tenant:admin')] }, async (request, reply) =>
    inTenant(request, async () => reply.send(await mandates.revoke((request.params as { id: string }).id, request.user!.userId)))
  );

  fastify.get('/api/v1/proof/receipts', { preHandler: [authenticate, requirePermission('tenant:read')] }, async (request, reply) =>
    inTenant(request, async () => {
      const q = request.query as { limit?: string; offset?: string; runId?: string };
      const limit = q.limit ? parseInt(q.limit, 10) : undefined;
      const offset = q.offset ? parseInt(q.offset, 10) : undefined;
      return reply.send(await proofs.listReceipts({ limit, offset, runId: q.runId }));
    })
  );

  fastify.get('/api/v1/proof/receipts/:id', { preHandler: [authenticate, requirePermission('tenant:read')] }, async (request, reply) =>
    inTenant(request, async () => {
      const r = await proofs.get((request.params as { id: string }).id);
      return r ? reply.send(r) : reply.status(404).send({ error: 'NOT_FOUND' });
    })
  );

  fastify.get('/api/v1/proof/receipts/:id/verify', { preHandler: [authenticate, requirePermission('tenant:read')] }, async (request, reply) =>
    inTenant(request, async () => reply.send(await proofs.verify((request.params as { id: string }).id)))
  );

  fastify.get('/api/v1/proof/chain/verify', { preHandler: [authenticate, requirePermission('tenant:read')] }, async (request, reply) =>
    inTenant(request, async () => reply.send(await proofs.verifyChain()))
  );

  fastify.get('/api/v1/proof/export', { preHandler: [authenticate, requirePermission('tenant:read')] }, async (request, reply) =>
    inTenant(request, async () => reply.send(await proofs.exportBundle()))
  );
}
