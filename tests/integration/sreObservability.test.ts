import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server.js';
import { db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { JwtService } from '../../src/security/auth/jwt.js';
import { TraceRepository } from '../../src/observability/repositories/traceRepository.js';

describe('SRE and Observability REST Integration Tests', () => {
  let app: FastifyInstance;
  const tenantId = 'tenant_sre_integration';
  let operatorToken: string;
  const traceId = 'trace_int_sre_101';

  beforeAll(async () => {
    app = await buildServer();
    await app.ready();

    const client = db.getClient();
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    const now = new Date().toISOString();
    await client.execute(
      'INSERT OR IGNORE INTO tenants (id, name, slug, status, plan_tier, channel_plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?);',
      [tenantId, 'SRE Enterprise Systems', 'sre-systems', 'active', 'enterprise', 'combined', now, now]
    );

    operatorToken = JwtService.sign({
      userId: 'usr_sre_director',
      tenantId,
      email: 'director@sre.com',
      roles: ['system'],
    });

    // Ingest sample trace and spans
    await client.execute(
      `INSERT INTO execution_traces (
        id, tenant_id, organization_id, correlation_id, root_agent_id, channel, status,
        total_latency_ms, total_tokens_input, total_tokens_output, total_cost_usd, grounding_score,
        drift_detected, drift_reasons_json, started_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        traceId,
        tenantId,
        'default',
        'corr_sre_1',
        'orchestrator_agent',
        'api',
        'completed',
        1000,
        150,
        75,
        0.003,
        1.0,
        0,
        '[]',
        '2026-03-01T10:00:00.000Z',
        '2026-03-01T10:00:01.000Z',
      ]
    );

    await client.execute(
      `INSERT INTO execution_spans (
        id, trace_id, tenant_id, parent_span_id, span_name, agent_id,
        step_type, status, latency_ms, tokens_input, tokens_output, cost_usd,
        attributes_json, started_at, ended_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        'span_root_sre',
        traceId,
        tenantId,
        null,
        'root_process_inquiry',
        'orchestrator_agent',
        'orchestration',
        'completed',
        1000,
        100,
        50,
        0.002,
        '{}',
        '2026-03-01T10:00:00.000Z',
        '2026-03-01T10:00:01.000Z',
      ]
    );

    await client.execute(
      `INSERT INTO execution_spans (
        id, trace_id, tenant_id, parent_span_id, span_name, agent_id,
        step_type, status, latency_ms, tokens_input, tokens_output, cost_usd,
        attributes_json, started_at, ended_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        'span_child_sre',
        traceId,
        tenantId,
        'span_root_sre',
        'vector_search_rag',
        'rag_agent',
        'retrieval',
        'completed',
        700,
        50,
        25,
        0.001,
        '{}',
        '2026-03-01T10:00:00.100Z',
        '2026-03-01T10:00:00.800Z',
      ]
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('should render waterfall traces, track SLOs, compute burn rates, and manage SRE incident alerts', async () => {
    // 1. Get Waterfall Trace Visualization
    const wfRes = await app.inject({
      method: 'GET',
      url: `/api/v1/sre/traces/${traceId}/waterfall`,
      headers: { authorization: `Bearer ${operatorToken}` },
    });
    expect(wfRes.statusCode).toBe(200);
    const waterfall = wfRes.json();
    expect(waterfall.traceId).toBe(traceId);
    expect(waterfall.spanCount).toBe(2);
    expect(waterfall.tree[0].spanId).toBe('span_root_sre');
    expect(waterfall.tree[0].children.length).toBe(1);

    // 2. Define New SLO
    const sloRes = await app.inject({
      method: 'POST',
      url: '/api/v1/sre/slos',
      headers: { authorization: `Bearer ${operatorToken}` },
      payload: {
        name: 'Agent Gateway P95 Latency',
        serviceName: 'agent-gateway',
        targetMetric: 'p95_latency_ms',
        targetThreshold: 450, // 450ms target
        windowDays: 30,
      },
    });
    expect(sloRes.statusCode).toBe(201);
    const slo = sloRes.json();
    expect(slo.id).toBeDefined();

    // 3. List SLOs
    const listSloRes = await app.inject({
      method: 'GET',
      url: '/api/v1/sre/slos',
      headers: { authorization: `Bearer ${operatorToken}` },
    });
    expect(listSloRes.statusCode).toBe(200);
    expect(listSloRes.json().count).toBeGreaterThanOrEqual(1);

    // 4. Evaluate SLO with high latency (spikes to 900ms -> triggers alert)
    const evalRes = await app.inject({
      method: 'POST',
      url: `/api/v1/sre/slos/${slo.id}/evaluate`,
      headers: { authorization: `Bearer ${operatorToken}` },
      payload: {
        actualMetricValue: 900,
      },
    });
    expect(evalRes.statusCode).toBe(200);
    const evaluation = evalRes.json();
    expect(evaluation.isCompliant).toBe(false);
    expect(evaluation.alertStatus).toBe('warning');

    // 5. Query SRE Incident Alerts
    const alertsRes = await app.inject({
      method: 'GET',
      url: '/api/v1/sre/alerts',
      headers: { authorization: `Bearer ${operatorToken}` },
    });
    expect(alertsRes.statusCode).toBe(200);
    expect(alertsRes.json().count).toBeGreaterThanOrEqual(1);
    const firingAlert = alertsRes.json().alerts[0];
    expect(firingAlert.status).toBe('firing');

    // 6. Acknowledge Alert
    const ackRes = await app.inject({
      method: 'POST',
      url: `/api/v1/sre/alerts/${firingAlert.id}/acknowledge`,
      headers: { authorization: `Bearer ${operatorToken}` },
    });
    expect(ackRes.statusCode).toBe(200);
    expect(ackRes.json().status).toBe('acknowledged');

    // 7. Resolve Alert
    const resolveRes = await app.inject({
      method: 'POST',
      url: `/api/v1/sre/alerts/${firingAlert.id}/resolve`,
      headers: { authorization: `Bearer ${operatorToken}` },
    });
    expect(resolveRes.statusCode).toBe(200);
    expect(resolveRes.json().status).toBe('resolved');
  });
});
