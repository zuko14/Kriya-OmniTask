import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server.js';
import { db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { JwtService } from '../../src/security/auth/jwt.js';

describe('Adversarial Reliability Engineering Multi-Tenant Isolation Security Tests', () => {
  let app: FastifyInstance;
  const tenantA = 'tenant_rel_alpha';
  const tenantB = 'tenant_rel_beta';
  let tokenA: string;
  let tokenB: string;
  let unauthorizedToken: string;
  let jobAId: string;

  beforeAll(async () => {
    app = await buildServer();
    await app.ready();

    const client = db.getClient();
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    const now = new Date().toISOString();
    await client.execute(
      'INSERT OR IGNORE INTO tenants (id, name, slug, status, plan_tier, channel_plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?);',
      [tenantA, 'Tenant A Reliability', 'rel-alpha', 'active', 'enterprise', 'combined', now, now]
    );
    await client.execute(
      'INSERT OR IGNORE INTO tenants (id, name, slug, status, plan_tier, channel_plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?);',
      [tenantB, 'Tenant B Reliability', 'rel-beta', 'active', 'standard', 'combined', now, now]
    );

    tokenA = JwtService.sign({
      userId: 'usr_admin_rel_a',
      tenantId: tenantA,
      email: 'admina@xylarc.ai',
      roles: ['admin', 'operations_manager'],
    });

    tokenB = JwtService.sign({
      userId: 'usr_admin_rel_b',
      tenantId: tenantB,
      email: 'adminb@xylarc.ai',
      roles: ['admin', 'operations_manager'],
    });

    unauthorizedToken = JwtService.sign({
      userId: 'usr_readonly_rel',
      tenantId: tenantA,
      email: 'readonly@xylarc.ai',
      roles: ['read_only'],
    });

    // Tenant A enqueues DLQ job and records checkpoint
    const dlqRes = await app.inject({
      method: 'POST',
      url: '/api/v1/reliability/dlq',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        jobType: 'CONFIDENTIAL_PAYOUT',
        payload: { account: 'acc_secret_777' },
        error: 'Network timeout',
      },
    });

    jobAId = dlqRes.json().id;

    await app.inject({
      method: 'POST',
      url: '/api/v1/reliability/recovery/checkpoints',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        operationId: 'op_secret_vault_88',
        operationType: 'VAULT_MIGRATION',
        lifecycleState: 'running',
        checkpointState: { keyCount: 50 },
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('should isolate DLQ jobs, state checkpoints, and block cross-tenant DLQ manipulation', async () => {
    // 1. Tenant B lists DLQ -> must NOT see Tenant A's DLQ job
    const listResB = await app.inject({
      method: 'GET',
      url: '/api/v1/reliability/dlq',
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(listResB.statusCode).toBe(200);
    const jobsB = listResB.json().jobs;
    expect(jobsB.some((j: any) => j.id === jobAId)).toBe(false);

    // 2. Tenant B attempts to replay Tenant A's DLQ job -> must receive 404 Not Found
    const replayResB = await app.inject({
      method: 'POST',
      url: `/api/v1/reliability/dlq/${jobAId}/replay`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(replayResB.statusCode).toBe(404);

    // 3. Tenant B attempts to access Tenant A's operation checkpoint -> must receive 404 Not Found
    const recoveryResB = await app.inject({
      method: 'GET',
      url: '/api/v1/reliability/recovery/checkpoints/op_secret_vault_88',
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(recoveryResB.statusCode).toBe(404);

    // 4. Unauthorized read_only user tries to save recovery checkpoint -> must receive 403 Forbidden
    const unauthRes = await app.inject({
      method: 'POST',
      url: '/api/v1/reliability/recovery/checkpoints',
      headers: { authorization: `Bearer ${unauthorizedToken}` },
      payload: {
        operationId: 'op_malicious_escalation',
        operationType: 'ATTACK',
        lifecycleState: 'completed',
        checkpointState: {},
      },
    });
    expect(unauthRes.statusCode).toBe(403);
  });
});
