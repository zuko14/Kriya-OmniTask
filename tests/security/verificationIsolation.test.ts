import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server.js';
import { db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { JwtService } from '../../src/security/auth/jwt.js';

describe('Adversarial Verification & Quality Reviewer Isolation Security Tests', () => {
  let app: FastifyInstance;
  const tenantA = 'tenant_verif_sec_alpha';
  const tenantB = 'tenant_verif_sec_beta';
  let tokenA: string;
  let tokenB: string;
  let reviewAId: string;

  beforeAll(async () => {
    app = await buildServer();
    await app.ready();

    const client = db.getClient();
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    const now = new Date().toISOString();
    await client.execute(
      'INSERT OR IGNORE INTO tenants (id, name, slug, status, plan_tier, channel_plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?);',
      [tenantA, 'Tenant A Verif Corp', 'tenant-a-verif-corp', 'active', 'enterprise', 'combined', now, now]
    );
    await client.execute(
      'INSERT OR IGNORE INTO tenants (id, name, slug, status, plan_tier, channel_plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?);',
      [tenantB, 'Tenant B Verif Corp', 'tenant-b-verif-corp', 'active', 'standard', 'combined', now, now]
    );

    tokenA = JwtService.sign({
      userId: 'usr_admin_verif_a',
      tenantId: tenantA,
      email: 'admina@xylarc.ai',
      roles: ['admin'],
    });

    tokenB = JwtService.sign({
      userId: 'usr_admin_verif_b',
      tenantId: tenantB,
      email: 'adminb@xylarc.ai',
      roles: ['admin'],
    });

    // Tenant A creates a review
    const resA = await app.inject({
      method: 'POST',
      url: '/api/v1/verification/review',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        correlationId: 'corr_sec_verif_a',
        agentId: 'secret_agent_a',
        targetContent: 'Confidential corporate strategy output for Tenant A.',
        retrievedEvidence: ['Confidential strategy.'],
      },
    });

    expect(resA.statusCode).toBe(201);
    reviewAId = resA.json().id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('should prevent cross-tenant access to quality reviews and overview metrics', async () => {
    // 1. Tenant B lists reviews -> must NOT see Tenant A's review
    const listResB = await app.inject({
      method: 'GET',
      url: '/api/v1/verification/reviews',
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(listResB.statusCode).toBe(200);
    expect(listResB.json().reviews.some((r: any) => r.id === reviewAId)).toBe(false);

    // 2. Tenant B directly requests Tenant A's review -> must receive 404
    const getResB = await app.inject({
      method: 'GET',
      url: `/api/v1/verification/reviews/${reviewAId}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(getResB.statusCode).toBe(404);

    // 3. Tenant B metrics overview -> should report 0 reviews for Tenant B
    const metricsResB = await app.inject({
      method: 'GET',
      url: '/api/v1/verification/metrics',
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(metricsResB.statusCode).toBe(200);
    expect(metricsResB.json().totalReviews).toBe(0);
  });
});
