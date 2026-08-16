import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server.js';
import { db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { JwtService } from '../../src/security/auth/jwt.js';

describe('Adversarial Hardening Security Isolation Tests', () => {
  let app: FastifyInstance;
  const tenantId = 'tenant_hardening_sec';
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

  it('should block non-system-admin users from launching stress runs, chaos injections, or red-team audits', async () => {
    // 1. Block unauthorized stress test execution
    const unauthStress = await app.inject({
      method: 'POST',
      url: '/api/v1/hardening/stress/run',
      headers: { authorization: `Bearer ${nonAdminToken}` },
      payload: {
        concurrency: 50,
      },
    });
    expect(unauthStress.statusCode).toBe(403);

    // 2. Block unauthorized chaos experiment
    const unauthChaos = await app.inject({
      method: 'POST',
      url: '/api/v1/hardening/chaos/experiments',
      headers: { authorization: `Bearer ${nonAdminToken}` },
      payload: {
        experimentName: 'Rogue Chaos Attack',
        faultType: 'network_error',
      },
    });
    expect(unauthChaos.statusCode).toBe(403);

    // 3. Block unauthorized red-team audit execution
    const unauthRedTeam = await app.inject({
      method: 'POST',
      url: '/api/v1/hardening/red-team/audit',
      headers: { authorization: `Bearer ${nonAdminToken}` },
    });
    expect(unauthRedTeam.statusCode).toBe(403);
  });
});
