import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server.js';
import { db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { JwtService } from '../../src/security/auth/jwt.js';

describe('Adversarial Platform Administration Operator Security Tests', () => {
  let app: FastifyInstance;
  const tenantId = 'tenant_standard_client';
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
      [tenantId, 'Standard Client Tenant', 'standard-client', 'active', 'standard', 'combined', now, now]
    );

    nonAdminToken = JwtService.sign({
      userId: 'usr_regular_dev',
      tenantId,
      email: 'dev@client.com',
      roles: ['developer'],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('should block non-system-admin users from accessing operator control plane endpoints', async () => {
    // 1. Block unauthorized tenant provisioning
    const unauthProv = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/tenants/provision',
      headers: { authorization: `Bearer ${nonAdminToken}` },
      payload: {
        id: 'tenant_hacked',
        name: 'Hacked Tenant',
        slug: 'hacked-tenant',
        adminEmail: 'hacker@evil.com',
      },
    });
    expect(unauthProv.statusCode).toBe(403);

    // 2. Block unauthorized maintenance toggling
    const unauthMaint = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/maintenance',
      headers: { authorization: `Bearer ${nonAdminToken}` },
      payload: {
        isMaintenanceActive: true,
        emergencyKillActive: true,
        reason: 'Malicious shutdown attempt',
      },
    });
    expect(unauthMaint.statusCode).toBe(403);

    // 3. Block unauthorized fleet diagnostics inspection
    const unauthFleet = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/fleet/diagnostics',
      headers: { authorization: `Bearer ${nonAdminToken}` },
    });
    expect(unauthFleet.statusCode).toBe(403);

    // 4. Block unauthorized operator audit log viewing
    const unauthAudit = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/audit-logs',
      headers: { authorization: `Bearer ${nonAdminToken}` },
    });
    expect(unauthAudit.statusCode).toBe(403);
  });
});
