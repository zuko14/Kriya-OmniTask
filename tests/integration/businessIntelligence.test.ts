import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server.js';
import { db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { JwtService } from '../../src/security/auth/jwt.js';

describe('Business Intelligence & Executive Daily Briefing REST Integration Tests', () => {
  let app: FastifyInstance;
  const tenantId = 'tenant_bi_integration_test';
  let adminToken: string;
  let briefingId: string;

  beforeAll(async () => {
    app = await buildServer();
    await app.ready();

    const client = db.getClient();
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    const now = new Date().toISOString();
    await client.execute(
      'INSERT OR IGNORE INTO tenants (id, name, slug, status, plan_tier, channel_plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?);',
      [tenantId, 'BI Test Corp', 'bi-test-corp', 'active', 'enterprise', 'combined', now, now]
    );

    // Seed 1 customer for the tenant
    await client.execute(
      `INSERT INTO customers (id, tenant_id, primary_phone, full_name, lifecycle_stage, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?);`,
      ['cust_bi_1', tenantId, '+15559990', 'Executive Lead', 'lead', now, now]
    );

    adminToken = JwtService.sign({
      userId: 'usr_admin_bi',
      tenantId,
      email: 'biadmin@kriya.ai',
      roles: ['admin'],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('should generate an on-demand executive daily briefing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/bi/briefings/generate',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        briefingDate: '2026-08-15',
        briefingType: 'daily_executive',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.title).toContain('2026-08-15');
    expect(body.summary_markdown).toContain('Executive KPI Snapshot');
    expect(body.whatsapp_formatted_text).toContain('EXECUTIVE MORNING BRIEFING');
    briefingId = body.id;
  });

  it('should list past executive briefings for the tenant', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/bi/briefings',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.count).toBeGreaterThanOrEqual(1);
    expect(body.briefings.some((b: any) => b.id === briefingId)).toBe(true);
  });

  it('should retrieve a specific briefing by ID', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/bi/briefings/${briefingId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(briefingId);
    expect(body.status).toBe('generated');
  });

  it('should deliver briefing via WhatsApp outbound queue and update status to delivered', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/bi/briefings/${briefingId}/deliver`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        recipientPhoneNumber: '+15551234567',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.delivered).toBe(true);
    expect(body.queueItemId).toBeDefined();

    // Verify status updated in database
    const verifyRes = await app.inject({
      method: 'GET',
      url: `/api/v1/bi/briefings/${briefingId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(verifyRes.json().status).toBe('delivered');
    expect(verifyRes.json().delivered_at).toBeDefined();
  });
});
