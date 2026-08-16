/**
 * Xylarc AI — Billing & Usage REST Routes
 * API endpoints for usage metering, channel subscriptions, invoices, and Stripe payments.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../../storage/db.js';
import { BillingRepository } from '../../billing/repositories/billingRepository.js';
import { BillingService } from '../../billing/service/billingService.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { requirePermission } from '../middleware/rbacMiddleware.js';
import { z } from 'zod';
import { ValidationError } from '../../core/errors/errors.js';

const RecordUsageBodySchema = z.object({
  metricType: z.enum([
    'tokens',
    'voice_minutes',
    'workflow_executions',
    'agent_seat_hours',
    'api_calls',
    'vector_storage_mb',
  ]),
  quantity: z.number().nonnegative(),
  idempotencyKey: z.string().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

const SubscribeBodySchema = z.object({
  planTier: z.enum(['starter', 'growth', 'enterprise', 'custom']),
  channelPlan: z.enum(['digital_only', 'voice_only', 'combined']).default('combined'),
});

const GenerateInvoiceBodySchema = z.object({
  periodStart: z.string(),
  periodEnd: z.string(),
  discount: z
    .object({
      discountCode: z.string().optional(),
      percentageDiscount: z.number().nonnegative().max(100).optional(),
      fixedDiscountCents: z.number().int().nonnegative().optional(),
      reason: z.string().optional(),
    })
    .optional(),
  taxJurisdiction: z
    .object({
      countryCode: z.string(),
      regionCode: z.string().optional(),
      taxRatePct: z.number().nonnegative().max(100),
      name: z.string(),
    })
    .optional(),
});

export async function billingRoutes(app: FastifyInstance): Promise<void> {
  const repo = new BillingRepository(db.getClient());
  const service = new BillingService(repo);

  // 1. List Available Plans
  app.get(
    '/api/v1/billing/plans',
    { preHandler: [authenticate] },
    async (_req: FastifyRequest, reply: FastifyReply) => {
      const plans = await service.listPlans();
      return reply.send({ count: plans.length, plans });
    }
  );

  // 2. Get Current Tenant Subscription
  app.get(
    '/api/v1/billing/subscription',
    { preHandler: [authenticate, requirePermission('billing:read')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const tenantId = (req as any).user.tenantId;
      const sub = await service.getSubscription(tenantId);
      return reply.send(sub || { status: 'no_subscription', tenantId });
    }
  );

  // 3. Subscribe or Upgrade Subscription
  app.post(
    '/api/v1/billing/subscription',
    { preHandler: [authenticate, requirePermission('billing:write')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const tenantId = (req as any).user.tenantId;
      const parse = SubscribeBodySchema.safeParse(req.body);
      if (!parse.success) {
        throw new ValidationError('Invalid subscription parameters', { issues: parse.error.issues });
      }

      const sub = await service.subscribeTenant(tenantId, parse.data.planTier, parse.data.channelPlan);
      return reply.status(200).send(sub);
    }
  );

  // 4. Record Metered Usage Event
  app.post(
    '/api/v1/billing/meter',
    { preHandler: [authenticate, requirePermission('billing:write')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const tenantId = (req as any).user.tenantId;
      const parse = RecordUsageBodySchema.safeParse(req.body);
      if (!parse.success) {
        throw new ValidationError('Invalid usage meter payload', { issues: parse.error.issues });
      }

      const record = await service.recordUsage(
        tenantId,
        parse.data.metricType,
        parse.data.quantity,
        parse.data.idempotencyKey,
        parse.data.metadata
      );
      return reply.status(201).send(record);
    }
  );

  // 5. Get Usage Summary for Cycle
  app.get(
    '/api/v1/billing/usage',
    { preHandler: [authenticate, requirePermission('billing:read')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const tenantId = (req as any).user.tenantId;
      const query = req.query as { periodStart?: string; periodEnd?: string };

      const summary = await service.getTenantUsageSummary(tenantId, query.periodStart, query.periodEnd);
      return reply.send(summary);
    }
  );

  // 6. Generate Invoice for Period
  app.post(
    '/api/v1/billing/invoices/generate',
    { preHandler: [authenticate, requirePermission('billing:write')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const tenantId = (req as any).user.tenantId;
      const parse = GenerateInvoiceBodySchema.safeParse(req.body);
      if (!parse.success) {
        throw new ValidationError('Invalid invoice generation payload', { issues: parse.error.issues });
      }

      const invoice = await service.generateInvoice(
        tenantId,
        parse.data.periodStart,
        parse.data.periodEnd,
        parse.data.discount,
        parse.data.taxJurisdiction
      );
      return reply.status(201).send(invoice);
    }
  );

  // 7. List Invoices
  app.get(
    '/api/v1/billing/invoices',
    { preHandler: [authenticate, requirePermission('billing:read')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const tenantId = (req as any).user.tenantId;
      const invoices = await service.listInvoices(tenantId);
      return reply.send({ count: invoices.length, invoices });
    }
  );

  // 8. Get Detailed Invoice
  app.get(
    '/api/v1/billing/invoices/:id',
    { preHandler: [authenticate, requirePermission('billing:read')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const tenantId = (req as any).user.tenantId;
      const { id } = req.params as { id: string };
      const invoice = await service.getInvoice(id, tenantId);
      if (!invoice) {
        return reply.status(404).send({ error: 'Invoice not found' });
      }
      return reply.send(invoice);
    }
  );

  // 9. Create Stripe Payment Intent
  app.post(
    '/api/v1/billing/invoices/:id/payment-intent',
    { preHandler: [authenticate, requirePermission('billing:write')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const tenantId = (req as any).user.tenantId;
      const { id } = req.params as { id: string };
      const intent = await service.createPaymentIntent(id, tenantId);
      return reply.send(intent);
    }
  );

  // 10. Handle Stripe Asynchronous Webhook
  app.post(
    '/api/v1/billing/payments/stripe/webhook',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const event = req.body as any;
      if (!event || !event.type) {
        return reply.status(400).send({ error: 'Invalid Stripe event payload' });
      }

      const res = await service.handleStripeWebhook(event);
      return reply.send({ received: true, handled: res.handled });
    }
  );
}
