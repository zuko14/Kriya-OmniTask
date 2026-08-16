import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server.js';
import { db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { JwtService } from '../../src/security/auth/jwt.js';

describe('Adversarial Business Intelligence & Briefing Isolation Security Tests', () => {
  let app: FastifyInstance;
  const tenantA = 'tenant_bi_sec_alpha';
  const tenantB = 'tenant_bi_sec_beta';
  let tokenA: string;
  let tokenB: string;

  beforeAll(async () => {
    app = await buildServer();
    await app.ready();

    const client = db.getClient();
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    const now = new Date().toISOString();
    await client.execute(
      'INSERT OR IGNORE INTO tenants (id, name, slug, status, plan_tier, channel_plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?);',
      [tenantA, 'Tenant A BI Corp', 'tenant-a-bi-corp', 'active', 'enterprise', 'combined', now, now]
    );
    await client.execute(
      'INSERT OR IGNORE INTO tenants (id, name, slug, status, plan_tier, channel_plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?);',
      [tenantB, 'Tenant B BI Corp', 'tenant-b-bi-corp', 'active', 'standard', 'combined', now, now]
    );

    tokenA = JwtService.sign({
      userId: 'usr_admin_a',
      tenantId: tenantA,
      email: 'admina@xylarc.ai',
      roles: ['admin'],
    });

    tokenB = JwtService.sign({
      userId: 'usr_admin_b',
      tenantId: tenantB,
      email: 'adminb@xylarc.ai',
      roles: ['admin'],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('should prevent cross-tenant access to executive briefings', async () => {
    // 1. Tenant A generates confidential briefing
    const resA = await app.inject({
      method: 'POST',
      url: '/api/v1/bi/briefings/generate',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        briefingDate: '2026-08-15',
        briefingType: 'daily_executive',
      },
    });
    expect(resA.statusCode).toBe(201);
    const briefingAId = resA.json().id;

    // 2. Tenant B lists briefings -> must NOT see Tenant A's briefing
    const listResB = await app.inject({
      method: 'GET',
      url: '/api/v1/bi/briefings',
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(listResB.statusCode).toBe(200);
    expect(listResB.json().briefings.some((b: any) => b.id === briefingAId)).toBe(false);

    // 3. Tenant B directly queries Tenant A's briefing ID -> must receive 404
    const getResB = await app.inject({
      method: 'GET',
      url: `/api/v1/bi/briefings/${briefingAId}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(getResB.statusCode).toBe(404);

    // 4. Tenant B attempts to deliver Tenant A's briefing -> must receive 404
    const delivResB = await app.inject({
      method: 'POST',
      url: `/api/v1/bi/briefings/${briefingAId}/deliver`,
      headers: { authorization: `Bearer ${tokenB}` },
      payload: {
        recipientPhoneNumber: '+15550009999',
      },
    });
    expect(delivResB.statusCode).toBe(404);
  });
});
