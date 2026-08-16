import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server.js';
import { db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { JwtService } from '../../src/security/auth/jwt.js';

describe('Model Provider Resilience REST Integration Tests', () => {
  let app: FastifyInstance;
  const tenantId = 'tenant_model_resil_test';
  let adminToken: string;

  beforeAll(async () => {
    app = await buildServer();
    await app.ready();

    const client = db.getClient();
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    const now = new Date().toISOString();
    await client.execute(
      'INSERT OR IGNORE INTO tenants (id, name, slug, status, plan_tier, channel_plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?);',
      [tenantId, 'Model Resilience Test Corp', 'model-resil-corp', 'active', 'enterprise', 'combined', now, now]
    );

    adminToken = JwtService.sign({
      userId: 'usr_model_admin',
      tenantId,
      email: 'modeladmin@xylarc.ai',
      roles: ['admin', 'operations_manager'],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('should register approved models, update tenant policy, execute with automated failover, and log routing decisions', async () => {
    // 1. Register New Model
    const regRes = await app.inject({
      method: 'POST',
      url: '/api/v1/model-resilience/models',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        provider: 'anthropic',
        modelIdentifier: 'claude-3-5-haiku-v2',
        displayName: 'Anthropic Claude 3.5 Haiku v2',
        status: 'active',
        contextWindowTokens: 200000,
        inputCostPer1k: 0.0008,
        outputCostPer1k: 0.004,
        capabilities: ['fast_classification', 'standard_reasoning'],
        allowedDataClassifications: ['public', 'internal', 'confidential', 'restricted'],
      },
    });

    expect(regRes.statusCode).toBe(201);
    expect(regRes.json().modelIdentifier).toBe('claude-3-5-haiku-v2');

    // 2. List Models
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/model-resilience/models',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().count).toBeGreaterThanOrEqual(1);

    // 3. Update Tenant Model Policy
    const updatePolicyRes = await app.inject({
      method: 'PUT',
      url: '/api/v1/model-resilience/policy',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        defaultPrimaryModelId: 'gemini-2.5-flash',
        defaultFallbackModelId: 'gpt-4o',
        disallowedProviders: [],
        maxCostPerQueryUsd: 0.5,
        requireLocalForConfidential: false,
      },
    });

    expect(updatePolicyRes.statusCode).toBe(200);
    expect(updatePolicyRes.json().defaultPrimaryModelId).toBe('gemini-2.5-flash');

    // 4. Execute with Resilience
    const execRes = await app.inject({
      method: 'POST',
      url: '/api/v1/model-resilience/execute',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        taskId: 'task_classify_99',
        taskType: 'fast_classification',
        prompt: 'Is this customer inquiry urgent?',
        dataClassification: 'internal',
      },
    });

    expect(execRes.statusCode).toBe(200);
    const execBody = execRes.json();
    expect(execBody.taskId).toBe('task_classify_99');
    expect(execBody.outputContent).toBeDefined();
    expect(execBody.totalCostUsd).toBeGreaterThan(0);

    // 5. Inspect Routing Decision Log
    const decisionsRes = await app.inject({
      method: 'GET',
      url: '/api/v1/model-resilience/decisions',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(decisionsRes.statusCode).toBe(200);
    expect(decisionsRes.json().count).toBeGreaterThanOrEqual(1);
    expect(decisionsRes.json().decisions[0].taskId).toBe('task_classify_99');
  });
});
