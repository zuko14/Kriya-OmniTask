import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server.js';
import { db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { JwtService } from '../../src/security/auth/jwt.js';
import { ObservabilityService } from '../../src/observability/service/observabilityService.js';
import { TenantContextManager } from '../../src/core/context/tenantContext.js';

describe('Agent Observability & Tracing REST Integration Tests', () => {
  let app: FastifyInstance;
  const tenantId = 'tenant_obs_test';
  let adminToken: string;
  let obsService: ObservabilityService;
  let traceId: string;

  beforeAll(async () => {
    app = await buildServer();
    await app.ready();

    const client = db.getClient();
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    const now = new Date().toISOString();
    await client.execute(
      'INSERT OR IGNORE INTO tenants (id, name, slug, status, plan_tier, channel_plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?);',
      [tenantId, 'Obs Test Corp', 'obs-test-corp', 'active', 'enterprise', 'combined', now, now]
    );

    adminToken = JwtService.sign({
      userId: 'usr_admin_obs',
      tenantId,
      email: 'obsadmin@xylarc.ai',
      roles: ['admin'],
    });

    obsService = new ObservabilityService();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should record execution trace with nested spans and compute waterfall', async () => {
    // 1. Create trace via Service under TenantContext
    await TenantContextManager.withTenant(tenantId, 'default', async () => {
      const trace = await obsService.startTrace({
        correlationId: 'corr_obs_1',
        rootAgentId: 'support_specialist',
        channel: 'whatsapp',
      });
      traceId = trace.id;

      // 2. Add sub-spans
      const rootSpan = await obsService.recordSpan({
        traceId,
        spanName: 'Handle Customer Support Request',
        agentId: 'support_specialist',
        stepType: 'orchestration',
        latencyMs: 350,
        tokensInput: 600,
        tokensOutput: 150,
      });

      await obsService.recordSpan({
        traceId,
        parentSpanId: rootSpan.id,
        spanName: 'Knowledge Hybrid RAG Query',
        agentId: 'support_specialist',
        stepType: 'retrieval',
        latencyMs: 120,
        tokensInput: 200,
        tokensOutput: 0,
      });

      await obsService.recordSpan({
        traceId,
        parentSpanId: rootSpan.id,
        spanName: 'Evaluate Policy Rules',
        agentId: 'support_specialist',
        stepType: 'policy_check',
        latencyMs: 40,
      });

      // 3. Finalize trace
      await obsService.completeTrace(traceId, {
        modelFinalOutput: 'Here is your policy detail as requested.',
        retrievedEvidence: ['Your policy detail coverage is active.'],
      });
    });

    // 4. Fetch waterfall view via REST endpoint
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/observability/traces/${traceId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.trace.id).toBe(traceId);
    expect(body.totalSpans).toBe(3);
    expect(body.rootSpans.length).toBe(1);
    expect(body.rootSpans[0].children.length).toBe(2);
  });

  it('should list traces with filtering and query telemetry overview metrics', async () => {
    // 1. List traces
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/observability/traces?limit=10',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(listRes.statusCode).toBe(200);
    const listBody = listRes.json();
    expect(listBody.count).toBeGreaterThanOrEqual(1);
    expect(listBody.traces.some((t: any) => t.id === traceId)).toBe(true);

    // 2. Query overview metrics
    const metricsRes = await app.inject({
      method: 'GET',
      url: '/api/v1/observability/metrics',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(metricsRes.statusCode).toBe(200);
    const metrics = metricsRes.json();
    expect(metrics.totalTraces).toBeGreaterThanOrEqual(1);
    expect(metrics.completedTraces).toBeGreaterThanOrEqual(1);
    expect(metrics.avgGroundingScore).toBeGreaterThanOrEqual(0.5);
  });
});
