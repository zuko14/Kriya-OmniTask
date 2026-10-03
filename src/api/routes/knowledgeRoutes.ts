/**
 * Kriya AI — Knowledge Fabric REST Routes
 * Endpoints for Document Ingestion, Hybrid Search, Quality Verification & Provenance (§10, §11, §12 of CLAUDE.md).
 */

import { FastifyInstance } from 'fastify';
import {
  IngestDocumentRequestSchema,
  KnowledgeQueryRequestSchema,
  KnowledgeQualityStatusEnum,
} from '../../knowledge/types/knowledgeTypes.js';
import { KnowledgeFabricService } from '../../knowledge/service/knowledgeFabricService.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { requirePermission } from '../middleware/rbacMiddleware.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import { z } from 'zod';

const UpdateQualityStatusSchema = z.object({
  status: KnowledgeQualityStatusEnum,
});

export async function knowledgeRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new KnowledgeFabricService();

  // 1. Ingest Document
  fastify.post(
    '/api/v1/knowledge/documents',
    { preHandler: [authenticate, requirePermission('customer:write')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const body = IngestDocumentRequestSchema.parse(request.body);
        const result = await service.ingestDocument(body, {
          actorType: 'user',
          actorId: user.userId,
        });
        return reply.status(201).send(result);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 2. List Documents
  fastify.get(
    '/api/v1/knowledge/documents',
    { preHandler: [authenticate, requirePermission('customer:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const docs = await service.listDocuments();
        return reply.status(200).send({ documents: docs, total: docs.length });
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 3. Get Document Details & Chunks
  fastify.get(
    '/api/v1/knowledge/documents/:id',
    { preHandler: [authenticate, requirePermission('customer:read')] },
    async (request, reply) => {
      const user = request.user!;
      const { id } = request.params as { id: string };
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const docWithChunks = await service.getDocument(id);
        return reply.status(200).send(docWithChunks);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 4. Delete Document
  fastify.delete(
    '/api/v1/knowledge/documents/:id',
    { preHandler: [authenticate, requirePermission('customer:write')] },
    async (request, reply) => {
      const user = request.user!;
      const { id } = request.params as { id: string };
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        await service.deleteDocument(id, user.userId);
        return reply.status(200).send({ deleted: true, documentId: id });
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 5. Hybrid RAG Search Query
  fastify.post(
    '/api/v1/knowledge/query',
    { preHandler: [authenticate, requirePermission('customer:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const body = KnowledgeQueryRequestSchema.parse(request.body);
        const result = await service.query(body, {
          actorType: 'user',
          actorId: user.userId,
        });
        return reply.status(200).send(result);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 6. Update Document Quality Status
  fastify.post(
    '/api/v1/knowledge/documents/:id/verify',
    { preHandler: [authenticate, requirePermission('customer:write')] },
    async (request, reply) => {
      const user = request.user!;
      const { id } = request.params as { id: string };
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const body = UpdateQualityStatusSchema.parse(request.body);
        const updated = await service.updateQualityStatus(id, body.status, user.userId);
        return reply.status(200).send(updated);
      }, { userId: user.userId, roles: user.roles });
    }
  );
}
