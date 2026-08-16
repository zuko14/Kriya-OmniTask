import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server.js';
import { db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { JwtService } from '../../src/security/auth/jwt.js';

describe('Adversarial Model Provider Resilience Multi-Tenant Isolation Security Tests', () => {
  let app: FastifyInstance;
  const tenantA = 'tenant_model_alpha';
  const tenantB = 'tenant_model_beta';
  let tokenA: string;
  let tokenB: string;
  let unauthorizedToken: string;

  beforeAll(async () => {
    app = await buildServer();
    await app.ready();

    const client = db.getClient();
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    const now = new Date().toISOString();
    await client.execute(
      'INSERT OR IGNORE INTO tenants (id, name, slug, status, plan_tier, channel_plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?);',
      [tenantA, 'Tenant A Model Corp', 'model-alpha', 'active', 'enterprise', 'combined', now, now]
    );
    await client.execute(
      'INSERT OR IGNORE INTO tenants (id, name, slug, status, plan_tier, channel_plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?);',
      [tenantB, 'Tenant B Model Corp', 'model-beta', 'active', 'standard', 'combined', now, now]
    );

    tokenA = JwtService.sign({
      userId: 'usr_admin_model_a',
      tenantId: tenantA,
      email: 'admina@xylarc.ai',
      roles: ['admin', 'operations_manager'],
    });

    tokenB = JwtService.sign({
      userId: 'usr_admin_model_b',
      tenantId: tenantB,
      email: 'adminb@xylarc.ai',
      roles: ['admin', 'operations_manager'],
    });

    unauthorizedToken = JwtService.sign({
      userId: 'usr_readonly_model',
      tenantId: tenantA,
      email: 'readonly@xylarc.ai',
      roles: ['read_only'],
    });

    // Tenant A sets policy and runs task
    await app.inject({
      method: 'PUT',
      url: '/api/v1/model-resilience/policy',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        defaultPrimaryModelId: 'gemini-2.5-pro',
        defaultFallbackModelId: 'claude-3-7-sonnet',
        disallowedProviders: ['openai'],
        maxCostPerQueryUsd: 2.0,
        requireLocalForConfidential: true,
      },
    });

    await app.inject({
      method: 'POST',
      url: '/api/v1/model-resilience/execute',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        taskId: 'task_tenant_a_secret_doc',
        taskType: 'standard_reasoning',
        prompt: 'Classified merger notes',
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('should isolate model policies, routing decision logs, and block unauthorized policy mutation', async () => {
    // 1. Tenant B fetches policy -> should NOT have Tenant A's disallowedProviders
    const policyResB = await app.inject({
      method: 'GET',
      url: '/api/v1/model-resilience/policy',
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(policyResB.statusCode).toBe(200);
    // Tenant B has default policy or empty policy
    expect(policyResB.json().disallowedProviders || []).not.toEqual(['openai']);

    // 2. Tenant B lists routing decisions -> must NOT see Tenant A's decisions
    const decisionsResB = await app.inject({
      method: 'GET',
      url: '/api/v1/model-resilience/decisions',
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(decisionsResB.statusCode).toBe(200);
    const decisionsB = decisionsResB.json().decisions;
    expect(decisionsB.some((d: any) => d.taskId === 'task_tenant_a_secret_doc')).toBe(false);

    // 3. Unauthorized read_only user tries to update model policy -> must receive 403 Forbidden
    const unauthRes = await app.inject({
      method: 'PUT',
      url: '/api/v1/model-resilience/policy',
      headers: { authorization: `Bearer ${unauthorizedToken}` },
      payload: {
        defaultPrimaryModelId: 'gemini-2.5-flash',
        defaultFallbackModelId: 'gpt-4o',
        disallowedProviders: [],
        maxCostPerQueryUsd: 100.0,
        requireLocalForConfidential: false,
      },
    });
    expect(unauthRes.statusCode).toBe(403);
  });
});
