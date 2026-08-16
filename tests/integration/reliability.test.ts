import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server.js';
import { db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { JwtService } from '../../src/security/auth/jwt.js';

describe('Reliability Engineering REST Integration Tests', () => {
  let app: FastifyInstance;
  const tenantId = 'tenant_reliability_test';
  let adminToken: string;

  beforeAll(async () => {
    app = await buildServer();
    await app.ready();

    const client = db.getClient();
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    const now = new Date().toISOString();
    await client.execute(
      'INSERT OR IGNORE INTO tenants (id, name, slug, status, plan_tier, channel_plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?);',
      [tenantId, 'Reliability Test Corp', 'rel-test-corp', 'active', 'enterprise', 'combined', now, now]
    );

    adminToken = JwtService.sign({
      userId: 'usr_rel_admin',
      tenantId,
      email: 'reladmin@xylarc.ai',
      roles: ['admin', 'operations_manager'],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('should enforce idempotency deduplication, record dependency probes, handle DLQ lifecycle, and formulate state recovery', async () => {
    // 1. Idempotent Execution #1
    const idemRes1 = await app.inject({
      method: 'POST',
      url: '/api/v1/reliability/idempotent-execute',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        idempotencyKey: 'tx_booking_9988',
        resourceType: 'booking_reservation',
        payload: { slotId: 'slot_55', customerId: 'cust_abc' },
      },
    });

    expect(idemRes1.statusCode).toBe(200);
    const body1 = idemRes1.json();
    expect(body1.cached).toBe(false);
    expect(body1.result.status).toBe('EXECUTED_SUCCESSFULLY');

    // 2. Idempotent Execution #2 with same key -> Must be cached
    const idemRes2 = await app.inject({
      method: 'POST',
      url: '/api/v1/reliability/idempotent-execute',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        idempotencyKey: 'tx_booking_9988',
        resourceType: 'booking_reservation',
        payload: { slotId: 'slot_55', customerId: 'cust_abc' },
      },
    });

    expect(idemRes2.statusCode).toBe(200);
    const body2 = idemRes2.json();
    expect(body2.cached).toBe(true);

    // 3. Record Dependency Probe
    const probeRes = await app.inject({
      method: 'POST',
      url: '/api/v1/reliability/dependencies/probe',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        dependencyName: 'WHATSAPP_CLOUD_API',
        isSuccess: true,
        latencyMs: 145,
      },
    });

    expect(probeRes.statusCode).toBe(200);
    expect(probeRes.json().dependencyName).toBe('WHATSAPP_CLOUD_API');
    expect(probeRes.json().state).toBe('healthy');

    // 4. List Dependencies
    const listDepRes = await app.inject({
      method: 'GET',
      url: '/api/v1/reliability/dependencies',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(listDepRes.statusCode).toBe(200);
    expect(listDepRes.json().count).toBeGreaterThanOrEqual(1);

    // 5. Enqueue Dead-Letter Job
    const dlqRes = await app.inject({
      method: 'POST',
      url: '/api/v1/reliability/dlq',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        jobType: 'OUTBOUND_SMS_DISPATCH',
        payload: { phone: '+1234567890', text: 'Appointment reminder' },
        error: 'Carrier rate limit exceeded (429)',
        maxRetries: 3,
      },
    });

    expect(dlqRes.statusCode).toBe(201);
    const job = dlqRes.json();
    expect(job.id).toBeDefined();

    // 6. Replay Dead-Letter Job
    const replayRes = await app.inject({
      method: 'POST',
      url: `/api/v1/reliability/dlq/${job.id}/replay`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(replayRes.statusCode).toBe(200);
    expect(replayRes.json().success).toBe(true);
    expect(replayRes.json().status).toBe('retrying');

    // 7. Save Checkpoint & Recover
    const checkpointRes = await app.inject({
      method: 'POST',
      url: '/api/v1/reliability/recovery/checkpoints',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        operationId: 'op_refund_443',
        operationType: 'REFUND_WORKFLOW',
        lifecycleState: 'partially_completed',
        checkpointState: { step: 2, chargeId: 'ch_443' },
        compensationAction: { action: 'RELEASE_INVENTORY_HOLD', itemId: 'item_99' },
      },
    });

    expect(checkpointRes.statusCode).toBe(201);

    const recoverRes = await app.inject({
      method: 'GET',
      url: '/api/v1/reliability/recovery/checkpoints/op_refund_443',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(recoverRes.statusCode).toBe(200);
    const recovery = recoverRes.json();
    expect(recovery.plan.recoveryAction).toBe('compensate');
    expect(recovery.plan.canRecover).toBe(true);
  });
});
