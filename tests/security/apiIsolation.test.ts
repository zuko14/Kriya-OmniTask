import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server.js';
import { SQLiteDatabaseClient, db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';

describe('Adversarial Multi-Tenant API Isolation', () => {
  let app: FastifyInstance;
  let client: SQLiteDatabaseClient;

  let tokenA: string;
  let tenantAId: string;
  let orgAId: string;

  let tokenB: string;
  let tenantBId: string;

  beforeEach(async () => {
    client = new SQLiteDatabaseClient(':memory:');
    db.setClientForTesting(client);
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    app = await buildServer();
    await app.ready();

    // Register Tenant A
    const resA = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        tenantName: 'Tenant Alpha',
        tenantSlug: 'alpha-sys',
        organizationName: 'Alpha Org',
        email: 'admin@alpha.com',
        password: 'AlphaPassword123!',
        fullName: 'Alpha Admin',
      },
    });
    const bodyA = JSON.parse(resA.body);
    tokenA = bodyA.accessToken;
    tenantAId = bodyA.tenant.id;
    orgAId = bodyA.organization.id;

    // Register Tenant B
    const resB = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        tenantName: 'Tenant Beta',
        tenantSlug: 'beta-sys',
        organizationName: 'Beta Org',
        email: 'admin@beta.com',
        password: 'BetaPassword123!',
        fullName: 'Beta Admin',
      },
    });
    const bodyB = JSON.parse(resB.body);
    tokenB = bodyB.accessToken;
    tenantBId = bodyB.tenant.id;
  });

  afterEach(async () => {
    await app.close();
    await client.close();
  });

  it('should reject Tenant B token attempting to fetch Tenant A profile with 403 Forbidden', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/tenants/${tenantAId}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('should prevent Tenant B from reading or creating workspaces in Tenant A organization', async () => {
    // 1. Tenant B listing Tenant A workspaces
    const listRes = await app.inject({
      method: 'GET',
      url: `/api/v1/organizations/${orgAId}/workspaces`,
      headers: { authorization: `Bearer ${tokenB}` },
    });

    expect(listRes.statusCode).toBe(404); // Not found in tenant B's scope

    // 2. Tenant B creating workspace in Tenant A organization
    const createRes = await app.inject({
      method: 'POST',
      url: `/api/v1/organizations/${orgAId}/workspaces`,
      headers: { authorization: `Bearer ${tokenB}` },
      payload: {
        name: 'Injected Workspace',
        slug: 'injected-ws',
      },
    });

    expect(createRes.statusCode).toBe(404);
  });

  it('should isolate user lists completely across tenants via API', async () => {
    const resA = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: { authorization: `Bearer ${tokenA}` },
    });

    const bodyA = JSON.parse(resA.body);
    expect(bodyA.users.length).toBe(1);
    expect(bodyA.users[0].email).toBe('admin@alpha.com');

    const resB = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: { authorization: `Bearer ${tokenB}` },
    });

    const bodyB = JSON.parse(resB.body);
    expect(bodyB.users.length).toBe(1);
    expect(bodyB.users[0].email).toBe('admin@beta.com');
  });
});
