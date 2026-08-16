import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server.js';
import { db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { JwtService } from '../../src/security/auth/jwt.js';

describe('Adversarial Deployment Security Isolation Tests', () => {
  let app: FastifyInstance;
  const tenantId = 'tenant_deployment_sec';
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

  it('should block non-system-admin users from creating releases, adjusting canary traffic, creating flags, or mutating schemas', async () => {
    // 1. Block unauthorized deployment creation
    const unauthDeploy = await app.inject({
      method: 'POST',
      url: '/api/v1/deployment/releases',
      headers: { authorization: `Bearer ${nonAdminToken}` },
      payload: {
        versionTag: 'v9.9.9',
        environment: 'production',
        deployedBy: 'usr_regular_analyst',
      },
    });
    expect(unauthDeploy.statusCode).toBe(403);

    // 2. Block unauthorized canary weight adjustment
    const unauthCanary = await app.inject({
      method: 'POST',
      url: '/api/v1/deployment/releases/dep_fake_123/canary',
      headers: { authorization: `Bearer ${nonAdminToken}` },
      payload: { canaryWeightPct: 50 },
    });
    expect(unauthCanary.statusCode).toBe(403);

    // 3. Block unauthorized feature flag creation
    const unauthFlag = await app.inject({
      method: 'POST',
      url: '/api/v1/deployment/flags',
      headers: { authorization: `Bearer ${nonAdminToken}` },
      payload: {
        flagKey: 'unauthorized_flag',
        name: 'Unauthorized Flag',
        isEnabled: true,
      },
    });
    expect(unauthFlag.statusCode).toBe(403);

    // 4. Block unauthorized schema transition
    const unauthSchema = await app.inject({
      method: 'POST',
      url: '/api/v1/deployment/schema-transitions',
      headers: { authorization: `Bearer ${nonAdminToken}` },
      payload: {
        tableName: 'tenants',
        version: 'v9.9.9',
        phase: 'expand',
      },
    });
    expect(unauthSchema.statusCode).toBe(403);
  });
});
