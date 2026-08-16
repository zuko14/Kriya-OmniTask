import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server.js';
import { db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { JwtService } from '../../src/security/auth/jwt.js';

describe('Adversarial Security Hardening & Audit Isolation Security Tests', () => {
  let app: FastifyInstance;
  const tenantA = 'tenant_sec_hard_alpha';
  const tenantB = 'tenant_sec_hard_beta';
  let tokenA: string;
  let tokenB: string;
  let unauthorizedToken: string;

  beforeAll(async () => {
    app = await buildServer();
    await app.ready();

    const client = db.getClient();
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    const now = new Date().toISOString();
    await client.execute(
      'INSERT OR IGNORE INTO tenants (id, name, slug, status, plan_tier, channel_plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?);',
      [tenantA, 'Tenant A Sec Corp', 'tenant-a-sec', 'active', 'enterprise', 'combined', now, now]
    );
    await client.execute(
      'INSERT OR IGNORE INTO tenants (id, name, slug, status, plan_tier, channel_plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?);',
      [tenantB, 'Tenant B Sec Corp', 'tenant-b-sec', 'active', 'standard', 'combined', now, now]
    );

    tokenA = JwtService.sign({
      userId: 'usr_admin_sec_a',
      tenantId: tenantA,
      email: 'admina@xylarc.ai',
      roles: ['admin', 'security_admin'],
    });

    tokenB = JwtService.sign({
      userId: 'usr_admin_sec_b',
      tenantId: tenantB,
      email: 'adminb@xylarc.ai',
      roles: ['admin', 'security_admin'],
    });

    unauthorizedToken = JwtService.sign({
      userId: 'usr_readonly_sec',
      tenantId: tenantA,
      email: 'readonly@xylarc.ai',
      roles: ['read_only'],
    });

    // Tenant A appends audit event and secret
    await app.inject({
      method: 'POST',
      url: '/api/v1/security/audit/log',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        eventType: 'CONFIDENTIAL_ACCESS',
        actorId: 'usr_admin_sec_a',
        actorRole: 'admin',
        targetResource: 'confidential_key',
        action: 'ACCESS',
      },
    });

    await app.inject({
      method: 'POST',
      url: '/api/v1/security/secrets/rotate',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        secretName: 'CONFIDENTIAL_MASTER_KEY',
        newSecretValue: 'super_secret_val_12345678',
        gracePeriodSeconds: 3600,
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('should isolate audit ledgers and secret vaults across tenants, and block unauthorized role escalation', async () => {
    // 1. Tenant B verifies audit ledger -> Tenant B's ledger is completely empty/separate
    const verifyResB = await app.inject({
      method: 'GET',
      url: '/api/v1/security/audit/verify',
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(verifyResB.statusCode).toBe(200);
    expect(verifyResB.json().totalEventsChecked).toBe(0);

    // 2. Tenant B lists secrets -> must NOT see Tenant A's secret
    const listSecB = await app.inject({
      method: 'GET',
      url: '/api/v1/security/secrets?secretName=CONFIDENTIAL_MASTER_KEY',
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(listSecB.statusCode).toBe(200);
    expect(listSecB.json().secrets.length).toBe(0);

    // 3. Unauthorized read_only role attempts to rotate secret -> must receive 403 Forbidden
    const rotateUnauthorized = await app.inject({
      method: 'POST',
      url: '/api/v1/security/secrets/rotate',
      headers: { authorization: `Bearer ${unauthorizedToken}` },
      payload: {
        secretName: 'ATTACK_SECRET',
        newSecretValue: 'malicious_key_payload',
        gracePeriodSeconds: 100,
      },
    });
    expect(rotateUnauthorized.statusCode).toBe(403);
  });
});
