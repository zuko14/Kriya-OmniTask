import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server.js';
import { db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { JwtService } from '../../src/security/auth/jwt.js';

describe('Adversarial Multi-Tenant Billing Security Tests', () => {
  let app: FastifyInstance;
  const tenantAlpha = 'tenant_sec_alpha';
  const tenantBeta = 'tenant_sec_beta';

  let tokenAlpha: string;
  let tokenBeta: string;
  let tokenReadOnly: string;

  beforeAll(async () => {
    app = await buildServer();
    await app.ready();

    const client = db.getClient();
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    const now = new Date().toISOString();
    await client.execute(
      'INSERT OR IGNORE INTO tenants (id, name, slug, status, plan_tier, channel_plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?);',
      [tenantAlpha, 'Alpha Corp', 'alpha-corp', 'active', 'enterprise', 'combined', now, now]
    );
    await client.execute(
      'INSERT OR IGNORE INTO tenants (id, name, slug, status, plan_tier, channel_plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?);',
      [tenantBeta, 'Beta Corp', 'beta-corp', 'active', 'starter', 'digital_only', now, now]
    );

    tokenAlpha = JwtService.sign({
      userId: 'usr_alpha_cfo',
      tenantId: tenantAlpha,
      email: 'cfo@alpha.com',
      roles: ['owner', 'finance'],
    });

    tokenBeta = JwtService.sign({
      userId: 'usr_beta_cfo',
      tenantId: tenantBeta,
      email: 'cfo@beta.com',
      roles: ['owner', 'finance'],
    });

    tokenReadOnly = JwtService.sign({
      userId: 'usr_alpha_viewer',
      tenantId: tenantAlpha,
      email: 'viewer@alpha.com',
      roles: ['read_only'],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('should prevent cross-tenant billing leakage and block unauthorized billing mutations', async () => {
    // 1. Alpha subscribes and generates an invoice
    await app.inject({
      method: 'POST',
      url: '/api/v1/billing/subscription',
      headers: { authorization: `Bearer ${tokenAlpha}` },
      payload: { planTier: 'enterprise', channelPlan: 'combined' },
    });

    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();

    const alphaInvRes = await app.inject({
      method: 'POST',
      url: '/api/v1/billing/invoices/generate',
      headers: { authorization: `Bearer ${tokenAlpha}` },
      payload: { periodStart, periodEnd },
    });
    const alphaInvoiceId = alphaInvRes.json().id;

    // 2. Beta tries to access Alpha's invoice by ID -> Must be 404 (isolated)
    const crossTenantGet = await app.inject({
      method: 'GET',
      url: `/api/v1/billing/invoices/${alphaInvoiceId}`,
      headers: { authorization: `Bearer ${tokenBeta}` },
    });
    expect(crossTenantGet.statusCode).toBe(404);

    // 3. Beta lists invoices -> Must NOT contain Alpha's invoice
    const betaList = await app.inject({
      method: 'GET',
      url: '/api/v1/billing/invoices',
      headers: { authorization: `Bearer ${tokenBeta}` },
    });
    expect(betaList.statusCode).toBe(200);
    expect(betaList.json().invoices.some((inv: any) => inv.id === alphaInvoiceId)).toBe(false);

    // 4. Read-only user tries to subscribe -> 403 Forbidden
    const unauthSub = await app.inject({
      method: 'POST',
      url: '/api/v1/billing/subscription',
      headers: { authorization: `Bearer ${tokenReadOnly}` },
      payload: { planTier: 'growth', channelPlan: 'combined' },
    });
    expect(unauthSub.statusCode).toBe(403);

    // 5. Read-only user tries to generate invoice -> 403 Forbidden
    const unauthGen = await app.inject({
      method: 'POST',
      url: '/api/v1/billing/invoices/generate',
      headers: { authorization: `Bearer ${tokenReadOnly}` },
      payload: { periodStart, periodEnd },
    });
    expect(unauthGen.statusCode).toBe(403);

    // 6. Read-only user tries to record usage meter event -> 403 Forbidden
    const unauthMeter = await app.inject({
      method: 'POST',
      url: '/api/v1/billing/meter',
      headers: { authorization: `Bearer ${tokenReadOnly}` },
      payload: { metricType: 'tokens', quantity: 5000 },
    });
    expect(unauthMeter.statusCode).toBe(403);
  });
});
