import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server.js';
import { db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { JwtService } from '../../src/security/auth/jwt.js';

describe('Agent Simulation & Dry-Run Sandbox REST Integration Tests', () => {
  let app: FastifyInstance;
  const tenantId = 'tenant_sim_test';
  let adminToken: string;
  let scenarioId: string;
  let runId: string;

  beforeAll(async () => {
    app = await buildServer();
    await app.ready();

    const client = db.getClient();
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    const now = new Date().toISOString();
    await client.execute(
      'INSERT OR IGNORE INTO tenants (id, name, slug, status, plan_tier, channel_plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?);',
      [tenantId, 'Simulation Test Corp', 'sim-test-corp', 'active', 'enterprise', 'combined', now, now]
    );

    adminToken = JwtService.sign({
      userId: 'usr_admin_sim',
      tenantId,
      email: 'simadmin@xylarc.ai',
      roles: ['admin'],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('should create scenario, execute dry-run simulation, and generate comparison report', async () => {
    // 1. Create scenario
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/simulation/scenarios',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        name: 'Calendar Availability Check Simulation',
        description: 'Verifies calendar agent checks availability without booking live appointment',
        category: 'calendar_booking',
        targetAgentId: 'booking_specialist',
        initialMessage: 'Can you check if there is an opening tomorrow afternoon?',
        mockToolResponses: {
          calendar_check_availability: { slots: ['2:00 PM', '4:00 PM'] },
        },
        expectedOutcomes: {
          expectedToolsCalled: ['calendar_check_availability'],
          expectedKeywords: ['available', 'slots'],
          maxAllowedLatencyMs: 5000,
        },
      },
    });

    expect(createRes.statusCode).toBe(201);
    const scenario = createRes.json();
    expect(scenario.id).toBeDefined();
    scenarioId = scenario.id;

    // 2. Execute dry-run run
    const runRes = await app.inject({
      method: 'POST',
      url: `/api/v1/simulation/scenarios/${scenarioId}/run`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        runMode: 'dry_run',
      },
    });

    expect(runRes.statusCode).toBe(201);
    const run = runRes.json();
    expect(run.id).toBeDefined();
    expect(run.status).toBe('passed');
    expect(run.simulated_output).toBeDefined();
    expect(run.tokens_used).toBeGreaterThan(0);
    runId = run.id;

    // 3. Fetch run details
    const getRunRes = await app.inject({
      method: 'GET',
      url: `/api/v1/simulation/runs/${runId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(getRunRes.statusCode).toBe(200);
    expect(getRunRes.json().id).toBe(runId);

    // 4. List runs
    const listRunsRes = await app.inject({
      method: 'GET',
      url: '/api/v1/simulation/runs',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(listRunsRes.statusCode).toBe(200);
    expect(listRunsRes.json().count).toBeGreaterThanOrEqual(1);
  });
});
