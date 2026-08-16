import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server.js';
import { db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { JwtService } from '../../src/security/auth/jwt.js';

describe('Adversarial Multilingual Profile Isolation Security Tests', () => {
  let app: FastifyInstance;
  const tenantA = 'tenant_multi_sec_alpha';
  const tenantB = 'tenant_multi_sec_beta';
  const customerA = 'cust_multi_sec_a';
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
      [tenantA, 'Tenant A Multi Corp', 'tenant-a-multi-corp', 'active', 'enterprise', 'combined', now, now]
    );
    await client.execute(
      'INSERT OR IGNORE INTO tenants (id, name, slug, status, plan_tier, channel_plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?);',
      [tenantB, 'Tenant B Multi Corp', 'tenant-b-multi-corp', 'active', 'standard', 'combined', now, now]
    );

    await client.execute(
      `INSERT OR IGNORE INTO customers (
        id, tenant_id, organization_id, primary_phone, full_name, lifecycle_stage, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
      [customerA, tenantA, 'default', '+919999911111', 'Secret Customer A', 'lead', now, now]
    );

    tokenA = JwtService.sign({
      userId: 'usr_admin_multi_a',
      tenantId: tenantA,
      email: 'admina@xylarc.ai',
      roles: ['admin'],
    });

    tokenB = JwtService.sign({
      userId: 'usr_admin_multi_b',
      tenantId: tenantB,
      email: 'adminb@xylarc.ai',
      roles: ['admin'],
    });

    // Tenant A sets profile
    const profileResA = await app.inject({
      method: 'POST',
      url: '/api/v1/multilingual/profiles',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        customerId: customerA,
        primaryLanguage: 'te',
        preferredScript: 'Telugu',
      },
    });

    expect(profileResA.statusCode).toBe(200);
  });

  afterAll(async () => {
    await app.close();
  });

  it('should prevent cross-tenant access to customer language profiles', async () => {
    // Tenant B attempts to read Tenant A's customer profile -> must receive 404
    const getProfB = await app.inject({
      method: 'GET',
      url: `/api/v1/multilingual/profiles/${customerA}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(getProfB.statusCode).toBe(404);
  });
});
