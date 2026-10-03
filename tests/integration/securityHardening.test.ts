import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server.js';
import { db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { JwtService } from '../../src/security/auth/jwt.js';

describe('Security Hardening & Zero-Trust Audit REST Integration Tests', () => {
  let app: FastifyInstance;
  const tenantId = 'tenant_sec_hard_test';
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
      [tenantId, 'Security Hardening Test Corp', 'sec-hard-test', 'active', 'enterprise', 'combined', now, now]
    );

    adminToken = JwtService.sign({
      userId: 'usr_sec_admin',
      tenantId,
      email: 'secadmin@kriya.ai',
      roles: ['admin', 'security_admin'],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('should append chained audit events, verify cryptographic ledger, rotate secrets, and run compliance scans', async () => {
    // 1. Log Chained Audit Event #1
    const logRes1 = await app.inject({
      method: 'POST',
      url: '/api/v1/security/audit/log',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        eventType: 'AGENT_DEPLOYED',
        actorId: 'usr_sec_admin',
        actorRole: 'admin',
        targetResource: 'agent:lead_qualifier',
        action: 'DEPLOY',
        payload: { agentVersion: '1.2.0', env: 'production' },
      },
    });

    expect(logRes1.statusCode).toBe(201);
    const event1 = logRes1.json();
    expect(event1.sequence_number).toBe(1);
    expect(event1.current_hash).toBeDefined();

    // 2. Log Chained Audit Event #2
    const logRes2 = await app.inject({
      method: 'POST',
      url: '/api/v1/security/audit/log',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        eventType: 'POLICY_AMENDMENT',
        actorId: 'usr_sec_admin',
        actorRole: 'admin',
        targetResource: 'policy:refund_rules',
        action: 'UPDATE',
        payload: { maxRefundThresholdUsd: 500 },
      },
    });

    expect(logRes2.statusCode).toBe(201);
    const event2 = logRes2.json();
    expect(event2.sequence_number).toBe(2);
    expect(event2.previous_hash).toBe(event1.current_hash);

    // 3. Verify Audit Ledger Integrity
    const verifyRes = await app.inject({
      method: 'GET',
      url: '/api/v1/security/audit/verify',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(verifyRes.statusCode).toBe(200);
    const verifyReport = verifyRes.json();
    expect(verifyReport.isValid).toBe(true);
    expect(verifyReport.totalEventsChecked).toBeGreaterThanOrEqual(2);
    expect(verifyReport.tamperedEventsCount).toBe(0);

    // 4. Rotate Secret
    const rotateRes = await app.inject({
      method: 'POST',
      url: '/api/v1/security/secrets/rotate',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        secretName: 'STRIPE_WEBHOOK_SECRET',
        newSecretValue: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
        gracePeriodSeconds: 3600,
      },
    });

    expect(rotateRes.statusCode).toBe(201);
    const rotated = rotateRes.json();
    expect(rotated.secretName).toBe('STRIPE_WEBHOOK_SECRET');
    expect(rotated.newVersion).toBeGreaterThanOrEqual(1);

    // 5. List Secrets
    const listSecRes = await app.inject({
      method: 'GET',
      url: '/api/v1/security/secrets?secretName=STRIPE_WEBHOOK_SECRET',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(listSecRes.statusCode).toBe(200);
    expect(listSecRes.json().count).toBeGreaterThanOrEqual(1);

    // 6. Run Zero-Trust Compliance Scan
    const scanRes = await app.inject({
      method: 'POST',
      url: '/api/v1/security/scan',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { scanTarget: 'full_suite' },
    });

    expect(scanRes.statusCode).toBe(200);
    const compliance = scanRes.json();
    expect(compliance.status).toBe('COMPLIANT');
    expect(compliance.totalChecks).toBe(3);
  });
});
