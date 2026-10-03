import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server.js';
import { db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { JwtService } from '../../src/security/auth/jwt.js';

describe('Adversarial Evaluation & Golden Dataset Isolation Security Tests', () => {
  let app: FastifyInstance;
  const tenantA = 'tenant_eval_sec_alpha';
  const tenantB = 'tenant_eval_sec_beta';
  let tokenA: string;
  let tokenB: string;
  let datasetAId: string;
  let benchmarkAId: string;

  beforeAll(async () => {
    app = await buildServer();
    await app.ready();

    const client = db.getClient();
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    const now = new Date().toISOString();
    await client.execute(
      'INSERT OR IGNORE INTO tenants (id, name, slug, status, plan_tier, channel_plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?);',
      [tenantA, 'Tenant A Eval Corp', 'tenant-a-eval-corp', 'active', 'enterprise', 'combined', now, now]
    );
    await client.execute(
      'INSERT OR IGNORE INTO tenants (id, name, slug, status, plan_tier, channel_plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?);',
      [tenantB, 'Tenant B Eval Corp', 'tenant-b-eval-corp', 'active', 'standard', 'combined', now, now]
    );

    tokenA = JwtService.sign({
      userId: 'usr_admin_eval_a',
      tenantId: tenantA,
      email: 'admina@kriya.ai',
      roles: ['admin'],
    });

    tokenB = JwtService.sign({
      userId: 'usr_admin_eval_b',
      tenantId: tenantB,
      email: 'adminb@kriya.ai',
      roles: ['admin'],
    });

    // Tenant A creates a golden dataset
    const createResA = await app.inject({
      method: 'POST',
      url: '/api/v1/evaluation/datasets',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        name: 'Confidential Prop Trade Benchmark Dataset',
        description: 'Testing proprietary quantitative trading responses',
        version: '1.0.0',
        targetAgentId: 'quant_agent',
        testCases: [
          {
            id: 'tc_sec_1',
            name: 'Prop Strategy 1',
            category: 'core_flow',
            prompt: 'Explain internal alpha model',
            referenceEvidence: ['Alpha model is internal proprietary IP.'],
            groundTruthOutput: 'Alpha model is internal proprietary IP.',
            minFaithfulness: 0.70,
            maxAllowedLatencyMs: 3000,
          },
        ],
      },
    });

    expect(createResA.statusCode).toBe(201);
    datasetAId = createResA.json().id;

    // Tenant A executes benchmark
    const benchResA = await app.inject({
      method: 'POST',
      url: `/api/v1/evaluation/datasets/${datasetAId}/benchmark`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { modelId: 'gemini-2.5-flash' },
    });

    expect(benchResA.statusCode).toBe(201);
    benchmarkAId = benchResA.json().id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('should prevent cross-tenant access to golden datasets and benchmark execution runs', async () => {
    // 1. Tenant B lists datasets -> must NOT see Tenant A's dataset
    const listDatasetsB = await app.inject({
      method: 'GET',
      url: '/api/v1/evaluation/datasets',
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(listDatasetsB.statusCode).toBe(200);
    expect(listDatasetsB.json().datasets.some((d: any) => d.id === datasetAId)).toBe(false);

    // 2. Tenant B directly requests Tenant A's dataset -> must receive 404
    const getDatasetB = await app.inject({
      method: 'GET',
      url: `/api/v1/evaluation/datasets/${datasetAId}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(getDatasetB.statusCode).toBe(404);

    // 3. Tenant B attempts to run benchmark on Tenant A's dataset -> must receive 404
    const runBenchB = await app.inject({
      method: 'POST',
      url: `/api/v1/evaluation/datasets/${datasetAId}/benchmark`,
      headers: { authorization: `Bearer ${tokenB}` },
      payload: { modelId: 'gemini-2.5-flash' },
    });
    expect(runBenchB.statusCode).toBe(404);

    // 4. Tenant B lists benchmarks -> must NOT see Tenant A's benchmark
    const listBenchB = await app.inject({
      method: 'GET',
      url: '/api/v1/evaluation/benchmarks',
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(listBenchB.statusCode).toBe(200);
    expect(listBenchB.json().benchmarks.some((b: any) => b.id === benchmarkAId)).toBe(false);

    // 5. Tenant B directly requests Tenant A's benchmark -> must receive 404
    const getBenchB = await app.inject({
      method: 'GET',
      url: `/api/v1/evaluation/benchmarks/${benchmarkAId}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(getBenchB.statusCode).toBe(404);
  });
});
