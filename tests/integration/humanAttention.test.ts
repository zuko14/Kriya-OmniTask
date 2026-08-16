import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server.js';
import { db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { JwtService } from '../../src/security/auth/jwt.js';

describe('Human Attention Center & Live Takeover REST Integration Tests', () => {
  let app: FastifyInstance;
  const tenantId = 'tenant_att_test';
  let adminToken: string;
  let itemId: string;
  const customerId = 'cust_att_123';

  beforeAll(async () => {
    app = await buildServer();
    await app.ready();

    const client = db.getClient();
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    const now = new Date().toISOString();
    await client.execute(
      'INSERT OR IGNORE INTO tenants (id, name, slug, status, plan_tier, channel_plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?);',
      [tenantId, 'Attention Test Corp', 'attention-test-corp', 'active', 'enterprise', 'combined', now, now]
    );

    adminToken = JwtService.sign({
      userId: 'usr_admin_att',
      tenantId,
      email: 'attadmin@xylarc.ai',
      roles: ['admin'],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('should escalate event to attention queue, claim it, and resolve with approval', async () => {
    // 1. Escalate to human
    const escRes = await app.inject({
      method: 'POST',
      url: '/api/v1/attention/items',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        correlationId: 'corr_att_int_1',
        customerId,
        sourceAgentId: 'support_specialist',
        title: 'Customer requested 50% discount refund',
        description: 'Customer demanding non-standard refund amount exceeding agent policy autonomy.',
        reasonCategory: 'financial_threshold',
        financialValueUsd: 1500, // Trigger P1_HIGH
        recommendedAction: 'Grant 25% credit note instead',
      },
    });

    expect(escRes.statusCode).toBe(201);
    const item = escRes.json();
    expect(item.id).toBeDefined();
    expect(item.priority).toBe('P1_HIGH');
    expect(item.status).toBe('pending');
    itemId = item.id;

    // 2. Claim item
    const claimRes = await app.inject({
      method: 'POST',
      url: `/api/v1/attention/items/${itemId}/claim`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(claimRes.statusCode).toBe(200);
    expect(claimRes.json().status).toBe('claimed');
    expect(claimRes.json().assigned_user_id).toBe('usr_admin_att');

    // 3. Resolve item
    const resolveRes = await app.inject({
      method: 'POST',
      url: `/api/v1/attention/items/${itemId}/resolve`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        action: 'approved',
        notes: 'Approved $250 credit compensation.',
      },
    });
    expect(resolveRes.statusCode).toBe(200);
    expect(resolveRes.json().status).toBe('resolved');
    expect(resolveRes.json().resolution_action).toBe('approved');
  });

  it('should manage live human conversation takeover and handback to AI', async () => {
    // 1. Start live takeover
    const startRes = await app.inject({
      method: 'POST',
      url: '/api/v1/attention/takeovers',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        customerId,
        channel: 'whatsapp',
        reason: 'Customer requested human manager call',
      },
    });
    expect(startRes.statusCode).toBe(201);
    expect(startRes.json().is_active).toBe(1);

    // 2. Check active takeover status
    const statusRes = await app.inject({
      method: 'GET',
      url: `/api/v1/attention/takeovers/active/${customerId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(statusRes.statusCode).toBe(200);
    expect(statusRes.json().isUnderTakeover).toBe(true);

    // 3. Hand back conversation to AI
    const handbackRes = await app.inject({
      method: 'POST',
      url: `/api/v1/attention/takeovers/${customerId}/handback`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(handbackRes.statusCode).toBe(200);
    expect(handbackRes.json().handedBack).toBe(true);

    // 4. Verify no longer under takeover
    const statusAfter = await app.inject({
      method: 'GET',
      url: `/api/v1/attention/takeovers/active/${customerId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(statusAfter.statusCode).toBe(200);
    expect(statusAfter.json().isUnderTakeover).toBe(false);

    // 5. Query attention overview metrics
    const metricsRes = await app.inject({
      method: 'GET',
      url: '/api/v1/attention/metrics',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(metricsRes.statusCode).toBe(200);
    const metrics = metricsRes.json();
    expect(metrics.totalItems).toBeGreaterThanOrEqual(1);
    expect(metrics.resolvedCount).toBeGreaterThanOrEqual(1);
  });
});
