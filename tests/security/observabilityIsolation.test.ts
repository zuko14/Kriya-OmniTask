import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server.js';
import { db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { JwtService } from '../../src/security/auth/jwt.js';
import { ObservabilityService } from '../../src/observability/service/observabilityService.js';
import { TenantContextManager } from '../../src/core/context/tenantContext.js';

describe('Adversarial Observability & Tracing Isolation Security Tests', () => {
  let app: FastifyInstance;
  const tenantA = 'tenant_obs_sec_alpha';
  const tenantB = 'tenant_obs_sec_beta';
  let tokenA: string;
  let tokenB: string;
  let traceAId: string;

  beforeAll(async () => {
    app = await buildServer();
    await app.ready();

    const client = db.getClient();
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    const now = new Date().toISOString();
    await client.execute(
      'INSERT OR IGNORE INTO tenants (id, name, slug, status, plan_tier, channel_plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?);',
      [tenantA, 'Tenant A Obs Corp', 'tenant-a-obs-corp', 'active', 'enterprise', 'combined', now, now]
    );
    await client.execute(
      'INSERT OR IGNORE INTO tenants (id, name, slug, status, plan_tier, channel_plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?);',
      [tenantB, 'Tenant B Obs Corp', 'tenant-b-obs-corp', 'active', 'standard', 'combined', now, now]
    );

    tokenA = JwtService.sign({
      userId: 'usr_admin_a',
      tenantId: tenantA,
      email: 'admina@kriya.ai',
      roles: ['admin'],
    });

    tokenB = JwtService.sign({
      userId: 'usr_admin_b',
      tenantId: tenantB,
      email: 'adminb@kriya.ai',
      roles: ['admin'],
    });

    const obsService = new ObservabilityService();
    await TenantContextManager.withTenant(tenantA, 'default', async () => {
      const trace = await obsService.startTrace({
        correlationId: 'corr_sec_a',
        rootAgentId: 'confidential_agent_a',
        channel: 'api',
      });
      traceAId = trace.id;

      await obsService.recordSpan({
        traceId: traceAId,
        spanName: 'Confidential Internal Logic',
        agentId: 'confidential_agent_a',
        stepType: 'model_inference',
        latencyMs: 200,
        tokensInput: 1000,
        tokensOutput: 200,
      });

      await obsService.completeTrace(traceAId, {
        status: 'completed',
        modelFinalOutput: 'Confidential output A',
      });
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('should prevent cross-tenant access to traces, waterfall spans, and metrics', async () => {
    // 1. Tenant B lists traces -> must NOT see Tenant A's trace
    const listResB = await app.inject({
      method: 'GET',
      url: '/api/v1/observability/traces',
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(listResB.statusCode).toBe(200);
    expect(listResB.json().traces.some((t: any) => t.id === traceAId)).toBe(false);

    // 2. Tenant B directly requests Tenant A's trace waterfall -> must receive 404
    const waterfallResB = await app.inject({
      method: 'GET',
      url: `/api/v1/observability/traces/${traceAId}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(waterfallResB.statusCode).toBe(404);

    // 3. Tenant B metrics overview -> should report 0 traces for Tenant B
    const metricsResB = await app.inject({
      method: 'GET',
      url: '/api/v1/observability/metrics',
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(metricsResB.statusCode).toBe(200);
    expect(metricsResB.json().totalTraces).toBe(0);
  });
});
