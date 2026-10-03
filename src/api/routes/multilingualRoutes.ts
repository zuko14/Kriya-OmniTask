/**
 * Kriya AI — Multilingual System (Indic & Global Languages) REST Routes
 * Endpoints for Language Detection, Indic Normalization, Cross-Lingual Sentiment, Translation, and Profiles (§14, §19 of CLAUDE.md).
 */

import { FastifyInstance } from 'fastify';
import {
  DetectLanguageRequestSchema,
  NormalizeTextRequestSchema,
  AnalyzeSentimentRequestSchema,
  TranslateTextRequestSchema,
  UpdateLanguageProfileRequestSchema,
} from '../../multilingual/types/multilingualTypes.js';
import { MultilingualService } from '../../multilingual/service/multilingualService.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { requirePermission } from '../middleware/rbacMiddleware.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';

export async function multilingualRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new MultilingualService();

  // 1. Detect Language & Script
  fastify.post(
    '/api/v1/multilingual/detect',
    { preHandler: [authenticate, requirePermission('agent:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const body = DetectLanguageRequestSchema.parse(request.body);
        const result = service.detectLanguage(body.text);
        return reply.status(200).send(result);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 2. Normalize Text & Strip Format Chars
  fastify.post(
    '/api/v1/multilingual/normalize',
    { preHandler: [authenticate, requirePermission('agent:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const body = NormalizeTextRequestSchema.parse(request.body);
        const result = service.normalizeText(body.text);
        return reply.status(200).send(result);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 3. Cross-Lingual Sentiment & Urgency Analysis
  fastify.post(
    '/api/v1/multilingual/sentiment',
    { preHandler: [authenticate, requirePermission('agent:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const body = AnalyzeSentimentRequestSchema.parse(request.body);
        const result = service.analyzeSentiment(body.text, body.language);
        return reply.status(200).send(result);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 4. Translate & Localize Text
  fastify.post(
    '/api/v1/multilingual/translate',
    { preHandler: [authenticate, requirePermission('agent:write')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const body = TranslateTextRequestSchema.parse(request.body);
        const result = await service.translateText(body);
        return reply.status(200).send(result);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 5. Get Customer Language Profile
  fastify.get(
    '/api/v1/multilingual/profiles/:customerId',
    { preHandler: [authenticate, requirePermission('customer:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const { customerId } = request.params as { customerId: string };
        const profile = await service.getProfile(customerId);
        return reply.status(200).send(profile);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 6. Update Customer Language Profile
  fastify.post(
    '/api/v1/multilingual/profiles',
    { preHandler: [authenticate, requirePermission('customer:write')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const body = UpdateLanguageProfileRequestSchema.parse(request.body);
        const profile = await service.updateProfile(body);
        return reply.status(200).send(profile);
      }, { userId: user.userId, roles: user.roles });
    }
  );
}
