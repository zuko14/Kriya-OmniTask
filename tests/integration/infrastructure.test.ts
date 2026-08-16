import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server.js';
import { db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { JwtService } from '../../src/security/auth/jwt.js';

describe('Production Infrastructure REST Integration Tests', () => {
  let app: FastifyInstance;
  const tenantId = 'tenant_infra_integration';
  let operatorToken: string;

  beforeAll(async () => {
    app = await buildServer();
    await app.ready();

    const client = db.getClient();
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    const now = new Date().toISOString();
    await client.execute(
      'INSERT OR IGNORE INTO tenants (id, name, slug, status, plan_tier, channel_plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?);',
      [tenantId, 'Infrastructure Enterprise', 'infra-ent', 'active', 'enterprise', 'combined', now, now]
    );

    operatorToken = JwtService.sign({
      userId: 'usr_infra_admin',
      tenantId,
      email: 'sre@infraent.com',
      roles: ['system'],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('should enqueue worker jobs, query pool diagnostics, run secret audits, and register schedules', async () => {
    // 1. Enqueue High-Priority Background Job
    const job1Res = await app.inject({
      method: 'POST',
      url: '/api/v1/infra/jobs/enqueue',
      headers: { authorization: `Bearer ${operatorToken}` },
      payload: {
        jobType: 'crm_batch_sync',
        payload: { batchSize: 500, source: 'salesforce' },
        queueName: 'high',
        priority: 95,
      },
    });

    expect(job1Res.statusCode).toBe(201);
    const job1 = job1Res.json();
    expect(job1.id).toBeDefined();
    expect(job1.status).toBe('pending');
    expect(job1.priority).toBe(95);

    // 2. Enqueue Normal Job
    const job2Res = await app.inject({
      method: 'POST',
      url: '/api/v1/infra/jobs/enqueue',
      headers: { authorization: `Bearer ${operatorToken}` },
      payload: {
        jobType: 'voice_transcript_indexing',
        payload: { callSessionId: 'call_999' },
        queueName: 'default',
        priority: 50,
      },
    });
    expect(job2Res.statusCode).toBe(201);

    // 3. List Jobs for Tenant
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/infra/jobs',
      headers: { authorization: `Bearer ${operatorToken}` },
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().count).toBeGreaterThanOrEqual(2);

    // 4. Get Specific Job by ID
    const getJobRes = await app.inject({
      method: 'GET',
      url: `/api/v1/infra/jobs/${job1.id}`,
      headers: { authorization: `Bearer ${operatorToken}` },
    });
    expect(getJobRes.statusCode).toBe(200);
    expect(getJobRes.json().id).toBe(job1.id);

    // 5. Query Database Connection Pool Stats
    const poolRes = await app.inject({
      method: 'GET',
      url: '/api/v1/infra/pool/stats',
      headers: { authorization: `Bearer ${operatorToken}` },
    });
    expect(poolRes.statusCode).toBe(200);
    expect(poolRes.json().maxConnections).toBeGreaterThanOrEqual(1);
    expect(poolRes.json().status).toBe('healthy');

    // 6. Trigger Secret Inventory & Entropy Audit
    const auditRes = await app.inject({
      method: 'POST',
      url: '/api/v1/infra/secrets/audit',
      headers: { authorization: `Bearer ${operatorToken}` },
    });
    expect(auditRes.statusCode).toBe(201);
    expect(auditRes.json().scanType).toBe('config_env');

    // 7. Get Latest Secret Audit Report
    const getAuditRes = await app.inject({
      method: 'GET',
      url: '/api/v1/infra/secrets/audit/latest',
      headers: { authorization: `Bearer ${operatorToken}` },
    });
    expect(getAuditRes.statusCode).toBe(200);
    expect(getAuditRes.json().scannedAt).toBeDefined();

    // 8. Register Scheduled Job
    const schedRes = await app.inject({
      method: 'POST',
      url: '/api/v1/infra/schedules',
      headers: { authorization: `Bearer ${operatorToken}` },
      payload: {
        name: 'Nightly Inactive Lead Pruning',
        cronExpression: '0 2 * * *',
        jobType: 'lead_retention_purge',
        metadata: { maxAgeDays: 90 },
      },
    });
    expect(schedRes.statusCode).toBe(201);
    expect(schedRes.json().name).toBe('Nightly Inactive Lead Pruning');

    // 9. List Scheduled Jobs
    const listSchedRes = await app.inject({
      method: 'GET',
      url: '/api/v1/infra/schedules',
      headers: { authorization: `Bearer ${operatorToken}` },
    });
    expect(listSchedRes.statusCode).toBe(200);
    expect(listSchedRes.json().count).toBeGreaterThanOrEqual(1);
  });
});
