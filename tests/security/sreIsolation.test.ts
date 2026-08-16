import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server.js';
import { db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { JwtService } from '../../src/security/auth/jwt.js';

describe('Adversarial SRE Security Isolation Tests', () => {
  let app: FastifyInstance;
  const tenantId = 'tenant_sre_sec';
  let nonAdminToken: string;

  beforeAll(async () => {
    app = await buildServer();
    await app.ready();

    const client = db.getClient();
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    const now = new Date().toISOString();
    await client.execute(
      'INSERT OR IGNORE INTO tenants (id, name, slug, status, plan_tier, channel_plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?);',
      [tenantId, 'Standard Client Org', 'std-client', 'active', 'standard', 'combined', now, now]
    );

    nonAdminToken = JwtService.sign({
      userId: 'usr_regular_analyst',
      tenantId,
      email: 'analyst@client.com',
      roles: ['analyst'],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('should block non-system-admin users from creating SLOs, evaluating SLOs, or managing incident alerts', async () => {
    // 1. Block unauthorized SLO creation
    const unauthCreateSlo = await app.inject({
      method: 'POST',
      url: '/api/v1/sre/slos',
      headers: { authorization: `Bearer ${nonAdminToken}` },
      payload: {
        name: 'Rogue SLO',
        serviceName: 'rogue-svc',
        targetMetric: 'availability',
        targetThreshold: 99.99,
      },
    });
    expect(unauthCreateSlo.statusCode).toBe(403);

    // 2. Block unauthorized SLO evaluation
    const unauthEvalSlo = await app.inject({
      method: 'POST',
      url: '/api/v1/sre/slos/slo_fake_123/evaluate',
      headers: { authorization: `Bearer ${nonAdminToken}` },
      payload: { actualMetricValue: 50.0 },
    });
    expect(unauthEvalSlo.statusCode).toBe(403);

    // 3. Block unauthorized alert acknowledgement
    const unauthAck = await app.inject({
      method: 'POST',
      url: '/api/v1/sre/alerts/alert_fake_123/acknowledge',
      headers: { authorization: `Bearer ${nonAdminToken}` },
    });
    expect(unauthAck.statusCode).toBe(403);

    // 4. Block unauthorized alert resolution
    const unauthResolve = await app.inject({
      method: 'POST',
      url: '/api/v1/sre/alerts/alert_fake_123/resolve',
      headers: { authorization: `Bearer ${nonAdminToken}` },
    });
    expect(unauthResolve.statusCode).toBe(403);
  });
});
