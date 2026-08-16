import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server.js';
import { db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { JwtService } from '../../src/security/auth/jwt.js';

describe('Deterministic Verification & Quality Reviewer REST Integration Tests', () => {
  let app: FastifyInstance;
  const tenantId = 'tenant_verif_test';
  let adminToken: string;
  let reviewId: string;

  beforeAll(async () => {
    app = await buildServer();
    await app.ready();

    const client = db.getClient();
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    const now = new Date().toISOString();
    await client.execute(
      'INSERT OR IGNORE INTO tenants (id, name, slug, status, plan_tier, channel_plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?);',
      [tenantId, 'Verif Test Corp', 'verif-test-corp', 'active', 'enterprise', 'combined', now, now]
    );

    adminToken = JwtService.sign({
      userId: 'usr_admin_verif',
      tenantId,
      email: 'verifadmin@xylarc.ai',
      roles: ['admin'],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('should submit content for quality review and receive structured verdict', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/verification/review',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        correlationId: 'corr_verif_int_1',
        agentId: 'lead_qualifier',
        targetContent: 'Our support team is available Monday through Friday to assist you with scheduling consultations.',
        retrievedEvidence: [
          'Our support team is available Monday through Friday.',
          'You can schedule consultations with our support team to assist you.',
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.verdict).toBe('approved');
    expect(body.faithfulness_score).toBeGreaterThanOrEqual(0.60);
    expect(body.overall_score).toBeGreaterThanOrEqual(0.80);
    reviewId = body.id;
  });

  it('should list reviews, fetch by ID, and query overview metrics', async () => {
    // 1. Get by ID
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/verification/reviews/${reviewId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().id).toBe(reviewId);

    // 2. List reviews
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/verification/reviews',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().count).toBeGreaterThanOrEqual(1);

    // 3. Get metrics overview
    const metricsRes = await app.inject({
      method: 'GET',
      url: '/api/v1/verification/metrics',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(metricsRes.statusCode).toBe(200);
    const metrics = metricsRes.json();
    expect(metrics.totalReviews).toBeGreaterThanOrEqual(1);
    expect(metrics.approvedCount).toBeGreaterThanOrEqual(1);
    expect(metrics.approvalRatePct).toBeGreaterThanOrEqual(50);
  });
});
