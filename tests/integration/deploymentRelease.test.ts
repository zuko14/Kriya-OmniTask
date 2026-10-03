import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server.js';
import { db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { JwtService } from '../../src/security/auth/jwt.js';

describe('Deployment & Release Engineering REST Integration Tests', () => {
  let app: FastifyInstance;
  const tenantId = 'tenant_deployment_int';
  let operatorToken: string;

  beforeAll(async () => {
    app = await buildServer();
    await app.ready();

    const client = db.getClient();
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    const now = new Date().toISOString();
    await client.execute(
      'INSERT OR IGNORE INTO tenants (id, name, slug, status, plan_tier, channel_plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?);',
      [tenantId, 'Deployment Release Org', 'deploy-release-org', 'active', 'enterprise', 'combined', now, now]
    );

    operatorToken = JwtService.sign({
      userId: 'usr_release_lead',
      tenantId,
      email: 'release.lead@kriya.ai',
      roles: ['system'],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('should manage deployment quality gates, canary rollouts, feature flags, and schema transitions', async () => {
    // 1. Create Deployment with Quality Gates
    const deployRes = await app.inject({
      method: 'POST',
      url: '/api/v1/deployment/releases',
      headers: { authorization: `Bearer ${operatorToken}` },
      payload: {
        versionTag: 'v2.4.0',
        environment: 'production',
        deployedBy: 'usr_release_lead',
        gateInput: {
          testPassRate: 0.99,
          semanticDriftScore: 0.02,
          criticalSecurityVulnerabilitiesCount: 0,
          p95LatencyMs: 350,
          p95LatencyBudgetMs: 500,
        },
      },
    });
    expect(deployRes.statusCode).toBe(201);
    const deployment = deployRes.json();
    expect(deployment.id).toBeDefined();
    expect(deployment.gateVerdict).toBe('approved');

    // 2. Adjust Canary Weight to 25%
    const canaryRes = await app.inject({
      method: 'POST',
      url: `/api/v1/deployment/releases/${deployment.id}/canary`,
      headers: { authorization: `Bearer ${operatorToken}` },
      payload: {
        canaryWeightPct: 25,
      },
    });
    expect(canaryRes.statusCode).toBe(200);
    expect(canaryRes.json().deployment.canaryWeightPct).toBe(25);

    // 3. Promote Deployment to 100%
    const promoteRes = await app.inject({
      method: 'POST',
      url: `/api/v1/deployment/releases/${deployment.id}/promote`,
      headers: { authorization: `Bearer ${operatorToken}` },
    });
    expect(promoteRes.statusCode).toBe(200);
    expect(promoteRes.json().status).toBe('promoted');
    expect(promoteRes.json().canaryWeightPct).toBe(100);

    // 4. Create and Evaluate Feature Flag
    const flagRes = await app.inject({
      method: 'POST',
      url: '/api/v1/deployment/flags',
      headers: { authorization: `Bearer ${operatorToken}` },
      payload: {
        flagKey: 'neural_voice_synthesis',
        name: 'Neural Voice Synthesis',
        isEnabled: true,
        allowedTenants: [tenantId],
        allowedRoles: ['super_admin'],
        rolloutPct: 100,
      },
    });
    expect(flagRes.statusCode).toBe(200);
    const flag = flagRes.json();
    expect(flag.flagKey).toBe('neural_voice_synthesis');

    const evalFlagRes = await app.inject({
      method: 'POST',
      url: `/api/v1/deployment/flags/${flag.flagKey}/evaluate`,
      headers: { authorization: `Bearer ${operatorToken}` },
      payload: {
        tenantId,
      },
    });
    expect(evalFlagRes.statusCode).toBe(200);
    expect(evalFlagRes.json().isEnabled).toBe(true);

    // 5. Execute 3-Phase Schema Transition (Expand -> Migrate -> Contract)
    const expandRes = await app.inject({
      method: 'POST',
      url: '/api/v1/deployment/schema-transitions',
      headers: { authorization: `Bearer ${operatorToken}` },
      payload: {
        tableName: 'customer_identities',
        version: 'v2.4.0',
        phase: 'expand',
        details: { addedColumn: 'biometric_hash' },
      },
    });
    expect(expandRes.statusCode).toBe(201);
    expect(expandRes.json().phase).toBe('expand');

    const migrateRes = await app.inject({
      method: 'POST',
      url: '/api/v1/deployment/schema-transitions',
      headers: { authorization: `Bearer ${operatorToken}` },
      payload: {
        tableName: 'customer_identities',
        version: 'v2.4.0',
        phase: 'migrate',
        details: { backfillBatchSize: 1000 },
      },
    });
    expect(migrateRes.statusCode).toBe(201);
    expect(migrateRes.json().phase).toBe('migrate');

    const contractRes = await app.inject({
      method: 'POST',
      url: '/api/v1/deployment/schema-transitions',
      headers: { authorization: `Bearer ${operatorToken}` },
      payload: {
        tableName: 'customer_identities',
        version: 'v2.4.0',
        phase: 'contract',
        details: { deprecatedColumn: 'legacy_hash' },
      },
    });
    expect(contractRes.statusCode).toBe(201);
    expect(contractRes.json().phase).toBe('contract');
  });
});
