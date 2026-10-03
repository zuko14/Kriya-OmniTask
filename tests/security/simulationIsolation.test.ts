import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server.js';
import { db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { JwtService } from '../../src/security/auth/jwt.js';

describe('Adversarial Simulation & Sandbox Isolation Security Tests', () => {
  let app: FastifyInstance;
  const tenantA = 'tenant_sim_sec_alpha';
  const tenantB = 'tenant_sim_sec_beta';
  let tokenA: string;
  let tokenB: string;
  let scenarioAId: string;
  let runAId: string;

  beforeAll(async () => {
    app = await buildServer();
    await app.ready();

    const client = db.getClient();
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    const now = new Date().toISOString();
    await client.execute(
      'INSERT OR IGNORE INTO tenants (id, name, slug, status, plan_tier, channel_plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?);',
      [tenantA, 'Tenant A Sim Corp', 'tenant-a-sim-corp', 'active', 'enterprise', 'combined', now, now]
    );
    await client.execute(
      'INSERT OR IGNORE INTO tenants (id, name, slug, status, plan_tier, channel_plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?);',
      [tenantB, 'Tenant B Sim Corp', 'tenant-b-sim-corp', 'active', 'standard', 'combined', now, now]
    );

    tokenA = JwtService.sign({
      userId: 'usr_admin_sim_a',
      tenantId: tenantA,
      email: 'admina@kriya.ai',
      roles: ['admin'],
    });

    tokenB = JwtService.sign({
      userId: 'usr_admin_sim_b',
      tenantId: tenantB,
      email: 'adminb@kriya.ai',
      roles: ['admin'],
    });

    // Tenant A creates a scenario
    const createResA = await app.inject({
      method: 'POST',
      url: '/api/v1/simulation/scenarios',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        name: 'Confidential Internal Agent Simulation',
        description: 'Testing confidential trade agent responses',
        category: 'lead_qualification',
        targetAgentId: 'confidential_agent_a',
        initialMessage: 'Secret message for Tenant A',
      },
    });

    expect(createResA.statusCode).toBe(201);
    scenarioAId = createResA.json().id;

    // Tenant A executes run
    const runResA = await app.inject({
      method: 'POST',
      url: `/api/v1/simulation/scenarios/${scenarioAId}/run`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { runMode: 'dry_run' },
    });

    expect(runResA.statusCode).toBe(201);
    runAId = runResA.json().id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('should prevent cross-tenant access to simulation scenarios and execution runs', async () => {
    // 1. Tenant B lists scenarios -> must NOT see Tenant A's scenario
    const listScenB = await app.inject({
      method: 'GET',
      url: '/api/v1/simulation/scenarios',
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(listScenB.statusCode).toBe(200);
    expect(listScenB.json().scenarios.some((s: any) => s.id === scenarioAId)).toBe(false);

    // 2. Tenant B directly requests Tenant A's scenario -> must receive 404
    const getScenB = await app.inject({
      method: 'GET',
      url: `/api/v1/simulation/scenarios/${scenarioAId}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(getScenB.statusCode).toBe(404);

    // 3. Tenant B attempts to run Tenant A's scenario -> must receive 404
    const runScenB = await app.inject({
      method: 'POST',
      url: `/api/v1/simulation/scenarios/${scenarioAId}/run`,
      headers: { authorization: `Bearer ${tokenB}` },
      payload: { runMode: 'dry_run' },
    });
    expect(runScenB.statusCode).toBe(404);

    // 4. Tenant B lists runs -> must NOT see Tenant A's run
    const listRunsB = await app.inject({
      method: 'GET',
      url: '/api/v1/simulation/runs',
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(listRunsB.statusCode).toBe(200);
    expect(listRunsB.json().runs.some((r: any) => r.id === runAId)).toBe(false);

    // 5. Tenant B directly requests Tenant A's run -> must receive 404
    const getRunB = await app.inject({
      method: 'GET',
      url: `/api/v1/simulation/runs/${runAId}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(getRunB.statusCode).toBe(404);
  });
});
