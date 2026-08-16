import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server.js';
import { db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { JwtService } from '../../src/security/auth/jwt.js';

describe('Adversarial Human Attention & Takeover Isolation Security Tests', () => {
  let app: FastifyInstance;
  const tenantA = 'tenant_att_sec_alpha';
  const tenantB = 'tenant_att_sec_beta';
  let tokenA: string;
  let tokenB: string;
  let itemAId: string;
  const customerA = 'cust_sec_att_a';

  beforeAll(async () => {
    app = await buildServer();
    await app.ready();

    const client = db.getClient();
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    const now = new Date().toISOString();
    await client.execute(
      'INSERT OR IGNORE INTO tenants (id, name, slug, status, plan_tier, channel_plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?);',
      [tenantA, 'Tenant A Attention Corp', 'tenant-a-att-corp', 'active', 'enterprise', 'combined', now, now]
    );
    await client.execute(
      'INSERT OR IGNORE INTO tenants (id, name, slug, status, plan_tier, channel_plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?);',
      [tenantB, 'Tenant B Attention Corp', 'tenant-b-att-corp', 'active', 'standard', 'combined', now, now]
    );

    tokenA = JwtService.sign({
      userId: 'usr_admin_att_a',
      tenantId: tenantA,
      email: 'admina@xylarc.ai',
      roles: ['admin'],
    });

    tokenB = JwtService.sign({
      userId: 'usr_admin_att_b',
      tenantId: tenantB,
      email: 'adminb@xylarc.ai',
      roles: ['admin'],
    });

    // Tenant A creates an attention item
    const resA = await app.inject({
      method: 'POST',
      url: '/api/v1/attention/items',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        correlationId: 'corr_sec_att_a',
        customerId: customerA,
        sourceAgentId: 'secret_agent_a',
        title: 'Confidential investigation escalation',
        description: 'Customer requesting executive level review.',
        reasonCategory: 'security_anomaly',
      },
    });

    expect(resA.statusCode).toBe(201);
    itemAId = resA.json().id;

    // Tenant A takes over customerA
    await app.inject({
      method: 'POST',
      url: '/api/v1/attention/takeovers',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        customerId: customerA,
        channel: 'whatsapp',
        reason: 'Confidential executive intervention',
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('should prevent cross-tenant access to attention items, claims, and takeovers', async () => {
    // 1. Tenant B lists attention items -> must NOT see Tenant A's item
    const listResB = await app.inject({
      method: 'GET',
      url: '/api/v1/attention/items',
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(listResB.statusCode).toBe(200);
    expect(listResB.json().items.some((i: any) => i.id === itemAId)).toBe(false);

    // 2. Tenant B directly requests Tenant A's item -> must receive 404
    const getResB = await app.inject({
      method: 'GET',
      url: `/api/v1/attention/items/${itemAId}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(getResB.statusCode).toBe(404);

    // 3. Tenant B attempts to claim Tenant A's item -> must receive 404
    const claimResB = await app.inject({
      method: 'POST',
      url: `/api/v1/attention/items/${itemAId}/claim`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(claimResB.statusCode).toBe(404);

    // 4. Tenant B checks takeover status for customerA -> must return false in Tenant B context
    const takeoverResB = await app.inject({
      method: 'GET',
      url: `/api/v1/attention/takeovers/active/${customerA}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(takeoverResB.statusCode).toBe(200);
    expect(takeoverResB.json().isUnderTakeover).toBe(false);

    // 5. Tenant B metrics overview -> should report 0 items and 0 active takeovers
    const metricsResB = await app.inject({
      method: 'GET',
      url: '/api/v1/attention/metrics',
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(metricsResB.statusCode).toBe(200);
    expect(metricsResB.json().totalItems).toBe(0);
    expect(metricsResB.json().activeTakeoversCount).toBe(0);
  });
});
