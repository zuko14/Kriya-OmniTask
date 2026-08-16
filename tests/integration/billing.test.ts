import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server.js';
import { db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { JwtService } from '../../src/security/auth/jwt.js';

describe('Billing and Usage REST Integration Tests', () => {
  let app: FastifyInstance;
  const tenantId = 'tenant_billing_integration';
  let token: string;

  beforeAll(async () => {
    app = await buildServer();
    await app.ready();

    const client = db.getClient();
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    const now = new Date().toISOString();
    await client.execute(
      'INSERT OR IGNORE INTO tenants (id, name, slug, status, plan_tier, channel_plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?);',
      [tenantId, 'Billing Enterprise Inc', 'billing-ent', 'active', 'growth', 'combined', now, now]
    );

    token = JwtService.sign({
      userId: 'usr_finance_lead',
      tenantId,
      email: 'finance@billingent.com',
      roles: ['owner', 'finance'],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('should manage subscription, meter usage, calculate overages, generate invoices, and handle Stripe webhooks', async () => {
    // 1. List Plans
    const plansRes = await app.inject({
      method: 'GET',
      url: '/api/v1/billing/plans',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(plansRes.statusCode).toBe(200);
    expect(plansRes.json().count).toBeGreaterThanOrEqual(3);

    // 2. Subscribe Tenant to Growth Combined Plan
    const subRes = await app.inject({
      method: 'POST',
      url: '/api/v1/billing/subscription',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        planTier: 'growth',
        channelPlan: 'combined',
      },
    });
    expect(subRes.statusCode).toBe(200);
    expect(subRes.json().planId).toBe('plan_growth_combined');

    // 3. Get Active Subscription
    const getSubRes = await app.inject({
      method: 'GET',
      url: '/api/v1/billing/subscription',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(getSubRes.statusCode).toBe(200);
    expect(getSubRes.json().status).toBe('active');

    // 4. Ingest Meter Usage Records (including overages)
    const meter1 = await app.inject({
      method: 'POST',
      url: '/api/v1/billing/meter',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        metricType: 'tokens',
        quantity: 30_000_000, // 5M over growth plan's 25M included
        idempotencyKey: 'meter_tok_batch_001',
      },
    });
    expect(meter1.statusCode).toBe(201);

    const meter2 = await app.inject({
      method: 'POST',
      url: '/api/v1/billing/meter',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        metricType: 'voice_minutes',
        quantity: 600, // 100 mins over 500 mins included
        idempotencyKey: 'meter_voice_batch_001',
      },
    });
    expect(meter2.statusCode).toBe(201);

    // 5. Get Usage Summary
    const usageRes = await app.inject({
      method: 'GET',
      url: '/api/v1/billing/usage',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(usageRes.statusCode).toBe(200);
    expect(usageRes.json().totalTokens).toBe(30_000_000);
    expect(usageRes.json().totalVoiceMinutes).toBe(600);

    // 6. Generate Invoice for Period
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();

    const invGenRes = await app.inject({
      method: 'POST',
      url: '/api/v1/billing/invoices/generate',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        periodStart,
        periodEnd,
        discount: {
          discountCode: 'SCALEUP10',
          percentageDiscount: 10,
        },
        taxJurisdiction: {
          countryCode: 'US',
          regionCode: 'NY',
          taxRatePct: 8.875,
          name: 'NY State & City Sales Tax',
        },
      },
    });

    expect(invGenRes.statusCode).toBe(201);
    const invoice = invGenRes.json();
    expect(invoice.id).toBeDefined();
    expect(invoice.status).toBe('open');
    expect(invoice.subtotalAmountCents).toBeGreaterThan(79900); // Base $799 + overages
    expect(invoice.discountAmountCents).toBeGreaterThan(0);
    expect(invoice.taxAmountCents).toBeGreaterThan(0);
    expect(invoice.lineItems.length).toBeGreaterThanOrEqual(4);

    // 7. List Invoices
    const listInvRes = await app.inject({
      method: 'GET',
      url: '/api/v1/billing/invoices',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(listInvRes.statusCode).toBe(200);
    expect(listInvRes.json().count).toBeGreaterThanOrEqual(1);

    // 8. Create Stripe Payment Intent
    const piRes = await app.inject({
      method: 'POST',
      url: `/api/v1/billing/invoices/${invoice.id}/payment-intent`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(piRes.statusCode).toBe(200);
    expect(piRes.json().paymentIntentId).toBeDefined();

    // 9. Simulate Stripe Webhook: Payment Succeeded
    const webhookRes = await app.inject({
      method: 'POST',
      url: '/api/v1/billing/payments/stripe/webhook',
      payload: {
        id: 'evt_stripe_sim_001',
        type: 'payment_intent.succeeded',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: piRes.json().paymentIntentId,
            metadata: {
              invoiceId: invoice.id,
            },
          },
        },
      },
    });
    expect(webhookRes.statusCode).toBe(200);
    expect(webhookRes.json().handled).toBe(true);

    // 10. Fetch Updated Invoice and verify status is paid
    const getInvRes = await app.inject({
      method: 'GET',
      url: `/api/v1/billing/invoices/${invoice.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(getInvRes.statusCode).toBe(200);
    expect(getInvRes.json().status).toBe('paid');
    expect(getInvRes.json().paidAt).toBeDefined();
  });
});
