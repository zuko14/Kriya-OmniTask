/**
 * Xylarc AI — Customer 360 & Entity Resolution REST Routes
 * Implements endpoints for customer profiles, identity resolution, timeline, consent, and GDPR rights.
 */

import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../middleware/authMiddleware.js';
import { requirePermission } from '../middleware/rbacMiddleware.js';
import { CustomerRepository } from '../../customer360/repositories/customerRepository.js';
import { ConsentRepository, ConsentType } from '../../customer360/repositories/consentRepository.js';
import { EntityResolutionService } from '../../customer360/services/entityResolutionService.js';
import { Customer360Service } from '../../customer360/services/customer360Service.js';
import { ValidationError } from '../../core/errors/errors.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';

const CreateCustomerSchema = z.object({
  fullName: z.string().min(1),
  primaryEmail: z.string().email().optional(),
  primaryPhone: z.string().optional(),
  externalCrmId: z.string().optional(),
  preferredLanguage: z.string().default('en'),
  preferredChannel: z.enum(['whatsapp', 'voice', 'email', 'web']).default('whatsapp'),
  lifecycleStage: z.enum(['lead', 'qualified', 'opportunity', 'customer', 'active', 'at_risk', 'churned', 'win_back']).default('lead'),
  attributes: z.record(z.unknown()).optional(),
});

const ResolveCustomerSchema = z.object({
  email: z.string().email().optional(),
  phone: z.string().optional(),
  whatsappId: z.string().optional(),
  externalCrmId: z.string().optional(),
  fullName: z.string().optional(),
  preferredLanguage: z.string().optional(),
  preferredChannel: z.enum(['whatsapp', 'voice', 'email', 'web']).optional(),
  source: z.string().default('api_resolve'),
});

const AppendTimelineSchema = z.object({
  channel: z.enum(['whatsapp', 'voice', 'email', 'web', 'crm', 'system']),
  eventType: z.string().min(1),
  summary: z.string().min(1),
  details: z.record(z.unknown()).optional(),
  sentimentScore: z.number().min(-1).max(1).optional(),
  lifecycleStage: z.enum(['lead', 'qualified', 'opportunity', 'customer', 'active', 'at_risk', 'churned', 'win_back']).optional(),
  actorType: z.enum(['agent', 'customer', 'human_operator', 'system']).default('system'),
  actorId: z.string().optional(),
});

const SetConsentSchema = z.object({
  consentType: z.enum(['whatsapp_marketing', 'voice_calls', 'email_newsletter', 'data_processing']),
  status: z.enum(['granted', 'revoked', 'pending']),
  source: z.string().default('web_portal'),
  ipAddress: z.string().optional(),
});

const MergeCustomerSchema = z.object({
  targetCustomerId: z.string().min(1),
  reason: z.string().min(1),
});

export async function customerRoutes(fastify: FastifyInstance): Promise<void> {
  const customerRepo = new CustomerRepository();
  const consentRepo = new ConsentRepository();
  const resolutionService = new EntityResolutionService();
  const customer360Service = new Customer360Service();

  // 1. Search / List Customers
  fastify.get('/api/v1/customers', {
    preHandler: [authenticate, requirePermission('customer:read')],
  }, async (request, reply) => {
    const user = request.user!;
    return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
      const query = request.query as {
        q?: string;
        lifecycleStage?: any;
        limit?: string;
        offset?: string;
      };

      const res = await customerRepo.search({
        query: query.q,
        lifecycleStage: query.lifecycleStage,
        limit: query.limit ? parseInt(query.limit, 10) : 50,
        offset: query.offset ? parseInt(query.offset, 10) : 0,
      });

      return reply.status(200).send(res);
    }, { userId: user.userId, roles: user.roles });
  });

  // 2. Create Customer
  fastify.post('/api/v1/customers', {
    preHandler: [authenticate, requirePermission('customer:write')],
  }, async (request, reply) => {
    const user = request.user!;
    return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
      const parseResult = CreateCustomerSchema.safeParse(request.body);
      if (!parseResult.success) {
        throw new ValidationError('Customer creation validation failed', { issues: parseResult.error.issues });
      }

      const body = parseResult.data;
      const customer = await customerRepo.create({
        full_name: body.fullName,
        primary_email: body.primaryEmail ? EntityResolutionService.normalizeEmail(body.primaryEmail) : undefined,
        primary_phone: body.primaryPhone ? EntityResolutionService.normalizePhone(body.primaryPhone) : undefined,
        external_crm_id: body.externalCrmId,
        preferred_language: body.preferredLanguage,
        preferred_channel: body.preferredChannel,
        lifecycle_stage: body.lifecycleStage,
        sentiment_score: 0.0,
        churn_risk_score: 0.0,
        attributes_json: JSON.stringify(body.attributes || {}),
        status: 'active',
      });

      return reply.status(201).send({ customer });
    }, { userId: user.userId, roles: user.roles });
  });

  // 3. Resolve Customer (Deterministic Resolution Engine)
  fastify.post('/api/v1/customers/resolve', {
    preHandler: [authenticate, requirePermission('customer:read')],
  }, async (request, reply) => {
    const user = request.user!;
    return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
      const parseResult = ResolveCustomerSchema.safeParse(request.body);
      if (!parseResult.success) {
        throw new ValidationError('Customer resolution payload invalid', { issues: parseResult.error.issues });
      }

      const result = await resolutionService.resolve(parseResult.data);
      return reply.status(200).send(result);
    }, { userId: user.userId, roles: user.roles });
  });

  // 4. Get Customer 360 View
  fastify.get('/api/v1/customers/:id', {
    preHandler: [authenticate, requirePermission('customer:read')],
  }, async (request, reply) => {
    const user = request.user!;
    return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
      const { id } = request.params as { id: string };
      const view = await customer360Service.getCustomer360(id);
      return reply.status(200).send(view);
    }, { userId: user.userId, roles: user.roles });
  });

  // 5. Append Timeline Interaction Event
  fastify.post('/api/v1/customers/:id/timeline', {
    preHandler: [authenticate, requirePermission('customer:write')],
  }, async (request, reply) => {
    const user = request.user!;
    return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
      const { id } = request.params as { id: string };
      const parseResult = AppendTimelineSchema.safeParse(request.body);
      if (!parseResult.success) {
        throw new ValidationError('Timeline event payload invalid', { issues: parseResult.error.issues });
      }

      const event = await customer360Service.recordInteraction({
        customerId: id,
        ...parseResult.data,
      });

      return reply.status(201).send({ event });
    }, { userId: user.userId, roles: user.roles });
  });

  // 6. Set Consent / Opt-In / Opt-Out
  fastify.post('/api/v1/customers/:id/consent', {
    preHandler: [authenticate, requirePermission('customer:write')],
  }, async (request, reply) => {
    const user = request.user!;
    return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
      const { id } = request.params as { id: string };
      const parseResult = SetConsentSchema.safeParse(request.body);
      if (!parseResult.success) {
        throw new ValidationError('Consent payload invalid', { issues: parseResult.error.issues });
      }

      const body = parseResult.data;
      const consent = await consentRepo.setConsent({
        customerId: id,
        consentType: body.consentType as ConsentType,
        status: body.status,
        source: body.source,
        ipAddress: body.ipAddress,
      });

      return reply.status(200).send({ consent });
    }, { userId: user.userId, roles: user.roles });
  });

  // 7. Merge Customers
  fastify.post('/api/v1/customers/:id/merge', {
    preHandler: [authenticate, requirePermission('customer:write')],
  }, async (request, reply) => {
    const user = request.user!;
    return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
      const { id } = request.params as { id: string };
      const parseResult = MergeCustomerSchema.safeParse(request.body);
      if (!parseResult.success) {
        throw new ValidationError('Merge payload invalid', { issues: parseResult.error.issues });
      }

      const merged = await resolutionService.mergeCustomers({
        sourceCustomerId: id,
        targetCustomerId: parseResult.data.targetCustomerId,
        reason: parseResult.data.reason,
      });

      return reply.status(200).send({ customer: merged });
    }, { userId: user.userId, roles: user.roles });
  });

  // 8. GDPR / DPDP Export
  fastify.get('/api/v1/customers/:id/export', {
    preHandler: [authenticate, requirePermission('customer:read')],
  }, async (request, reply) => {
    const user = request.user!;
    return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
      const { id } = request.params as { id: string };
      const exported = await customer360Service.exportCustomerData(id);
      return reply.status(200).send(exported);
    }, { userId: user.userId, roles: user.roles });
  });

  // 9. GDPR / DPDP Right to Erasure / Anonymization
  fastify.delete('/api/v1/customers/:id', {
    preHandler: [authenticate, requirePermission('customer:write')],
  }, async (request, reply) => {
    const user = request.user!;
    return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
      const { id } = request.params as { id: string };
      await customer360Service.forgetCustomer(id, 'User requested right to be forgotten (GDPR/DPDP)');
      return reply.status(200).send({ success: true, message: 'Customer record anonymized successfully' });
    }, { userId: user.userId, roles: user.roles });
  });
}
