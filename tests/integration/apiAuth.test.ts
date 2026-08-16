import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server.js';
import { SQLiteDatabaseClient, db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';

describe('API Authentication Integration', () => {
  let app: FastifyInstance;
  let client: SQLiteDatabaseClient;

  beforeEach(async () => {
    client = new SQLiteDatabaseClient(':memory:');
    db.setClientForTesting(client);
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    app = await buildServer();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await client.close();
  });

  it('should register a new tenant, organization, and owner via POST /api/v1/auth/register', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        tenantName: 'Apex Dynamics',
        tenantSlug: 'apex-dynamics',
        organizationName: 'Apex Headquarters',
        email: 'ceo@apexdynamics.io',
        password: 'SuperSecretPassword123!',
        fullName: 'Apex CEO',
        planTier: 'pro',
        channelPlan: 'combined',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.tenant.id).toBeDefined();
    expect(body.tenant.slug).toBe('apex-dynamics');
    expect(body.organization.id).toBeDefined();
    expect(body.user.email).toBe('ceo@apexdynamics.io');
    expect(body.accessToken).toBeDefined();
  });

  it('should login and retrieve JWT access token via POST /api/v1/auth/login', async () => {
    // 1. Register
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        tenantName: 'Solaris Inc',
        tenantSlug: 'solaris',
        organizationName: 'Solaris Global',
        email: 'admin@solaris.com',
        password: 'SolarisPassword123!',
        fullName: 'Solaris Admin',
      },
    });

    // 2. Login
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        tenantSlug: 'solaris',
        email: 'admin@solaris.com',
        password: 'SolarisPassword123!',
      },
    });

    expect(loginRes.statusCode).toBe(200);
    const loginBody = JSON.parse(loginRes.body);
    expect(loginBody.accessToken).toBeDefined();
    expect(loginBody.user.email).toBe('admin@solaris.com');

    // 3. Verify /api/v1/auth/me with Bearer token
    const meRes = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: {
        authorization: `Bearer ${loginBody.accessToken}`,
      },
    });

    expect(meRes.statusCode).toBe(200);
    const meBody = JSON.parse(meRes.body);
    expect(meBody.user.email).toBe('admin@solaris.com');
    expect(meBody.tenant.slug).toBe('solaris');
  });

  it('should reject invalid credentials with 401 Unauthorized', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        tenantSlug: 'non-existent-tenant',
        email: 'test@example.com',
        password: 'wrong',
      },
    });

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });
});
