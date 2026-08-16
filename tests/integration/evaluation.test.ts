import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server.js';
import { db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { JwtService } from '../../src/security/auth/jwt.js';

describe('Agent Evaluation Benchmark & Golden Test Suite REST Integration Tests', () => {
  let app: FastifyInstance;
  const tenantId = 'tenant_eval_test';
  let adminToken: string;
  let datasetId: string;
  let benchmarkId: string;

  beforeAll(async () => {
    app = await buildServer();
    await app.ready();

    const client = db.getClient();
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    const now = new Date().toISOString();
    await client.execute(
      'INSERT OR IGNORE INTO tenants (id, name, slug, status, plan_tier, channel_plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?);',
      [tenantId, 'Evaluation Test Corp', 'eval-test-corp', 'active', 'enterprise', 'combined', now, now]
    );

    adminToken = JwtService.sign({
      userId: 'usr_admin_eval',
      tenantId,
      email: 'evaladmin@xylarc.ai',
      roles: ['admin'],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('should create golden dataset, execute batch benchmark, and produce release gate verdict', async () => {
    // 1. Create golden dataset
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/evaluation/datasets',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        name: 'Enterprise Customer Support Golden Dataset',
        description: 'Benchmark suite covering refund, shipping, and SLA queries',
        version: '1.0.0',
        targetAgentId: 'customer_support',
        testCases: [
          {
            id: 'tc_eval_1',
            name: 'Standard Shipping Query',
            category: 'core_flow',
            prompt: 'How long does standard delivery take?',
            referenceEvidence: ['Standard delivery takes 3-5 business days.'],
            groundTruthOutput: 'Standard delivery takes 3-5 business days.',
            minFaithfulness: 0.70,
            maxAllowedLatencyMs: 3000,
          },
        ],
      },
    });

    expect(createRes.statusCode).toBe(201);
    const dataset = createRes.json();
    expect(dataset.id).toBeDefined();
    datasetId = dataset.id;

    // 2. Execute benchmark
    const benchRes = await app.inject({
      method: 'POST',
      url: `/api/v1/evaluation/datasets/${datasetId}/benchmark`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        modelId: 'gemini-2.5-flash',
        promptVersion: 'v2.0',
      },
    });

    expect(benchRes.statusCode).toBe(201);
    const bench = benchRes.json();
    expect(bench.id).toBeDefined();
    expect(bench.verdict).toBe('release_approved');
    expect(bench.pass_rate).toBe(1.0);
    benchmarkId = bench.id;

    // 3. Fetch benchmark details
    const getBenchRes = await app.inject({
      method: 'GET',
      url: `/api/v1/evaluation/benchmarks/${benchmarkId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(getBenchRes.statusCode).toBe(200);
    expect(getBenchRes.json().id).toBe(benchmarkId);

    // 4. List benchmarks
    const listBenchRes = await app.inject({
      method: 'GET',
      url: '/api/v1/evaluation/benchmarks',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(listBenchRes.statusCode).toBe(200);
    expect(listBenchRes.json().count).toBeGreaterThanOrEqual(1);
  });
});
