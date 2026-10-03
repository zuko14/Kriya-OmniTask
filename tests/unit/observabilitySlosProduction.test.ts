/**
 * Kriya AI — Observability & SLOs Production Test Suite (WP-8.3, Milestone M8)
 *
 * Verifies 100% production compliance:
 * 1. Prometheus Metrics Engine: Counter, Gauge, Histogram, exposition formatting (# HELP, # TYPE, buckets, sum, count)
 * 2. Platform Indicators: HTTP requests, agent runs, model tokens, tool execution, SLO burn rate gauges
 * 3. W3C Distributed Tracing: W3C traceparent (version-traceid-parentid-flags), tracestate, correlation ID, AsyncLocalStorage
 * 4. Multi-Window SLO Burn Rate Engine: 1h (14.4x), 6h (6.0x), 24h (3.0x), error budget depletion, Attention Center auto-escalation
 * 5. Fastify REST Endpoints: /metrics scrape endpoint, /api/v1/observability/metrics/prometheus, /slos, /alerts, /spans
 * 6. Automated Request Hooks: W3C traceparent injection and HTTP request duration histogram tracking
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { TenantContextManager } from '../../src/core/context/tenantContext.js';
import { JwtService } from '../../src/security/auth/jwt.js';
import {
  PrometheusRegistry,
  globalPrometheusRegistry,
  Counter,
  Gauge,
  Histogram,
} from '../../src/observability/metrics/prometheusRegistry.js';
import { PlatformMetrics } from '../../src/observability/metrics/platformMetrics.js';
import {
  DistributedContextManager,
  DistributedTraceContext,
} from '../../src/observability/tracing/distributedContext.js';
import { SloBurnRateTracker } from '../../src/sre/slo/sloBurnRateTracker.js';
import { SloEvaluationEngine } from '../../src/observability/slo/sloEvaluationEngine.js';
import { SreRepository } from '../../src/sre/repositories/sreRepository.js';
import { AttentionService } from '../../src/attention/service/attentionService.js';
import { TraceRepository } from '../../src/observability/repositories/traceRepository.js';
import { observabilityRoutes } from '../../src/api/routes/observabilityRoutes.js';
import { buildServer } from '../../src/api/server.js';
import { SloDefinition } from '../../src/sre/types/sreTypes.js';

describe('WP-8.3: Observability + SLOs Production Suite', () => {
  const tenantId = 'tenant_obs_test_01';
  let adminToken: string;
  let viewerToken: string;

  beforeEach(async () => {
    const client = db.getClient();
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    // Reset platform metrics
    PlatformMetrics.resetAll();

    // Seed test tenant fixture
    await client.execute(
      `INSERT OR IGNORE INTO tenants (id, name, slug, status, created_at, updated_at)
       VALUES (?, ?, ?, 'active', datetime('now'), datetime('now'));`,
      [tenantId, 'Observability Test Tenant', 'obs-test-tenant']
    );

    // Clean tables for this tenant
    await client.execute(`DELETE FROM slo_alert_incidents WHERE tenant_id = ?;`, [tenantId]);
    await client.execute(`DELETE FROM sre_alerts WHERE id LIKE 'alert_%';`);
    await client.execute(`DELETE FROM slo_evaluations WHERE id LIKE 'eval_%';`);
    await client.execute(`DELETE FROM slo_definitions WHERE id LIKE 'slo_%';`);
    await client.execute(`DELETE FROM attention_items WHERE tenant_id = ?;`, [tenantId]);
    await client.execute(`DELETE FROM execution_spans WHERE tenant_id = ?;`, [tenantId]);
    await client.execute(`DELETE FROM execution_traces WHERE tenant_id = ?;`, [tenantId]);

    // Create auth tokens
    adminToken = JwtService.sign({
      userId: 'user_admin_obs',
      tenantId,
      organizationId: 'default',
      email: 'admin@obs.com',
      roles: ['super_admin', 'owner'],
    });

    viewerToken = JwtService.sign({
      userId: 'user_viewer_obs',
      tenantId,
      organizationId: 'default',
      email: 'viewer@obs.com',
      roles: ['admin'],
    });
  });

  describe('1. Prometheus Metrics Engine & Registry', () => {
    it('should correctly increment Counter and serialize to Prometheus format', () => {
      const registry = new PrometheusRegistry();
      const counter = registry.registerCounter('test_requests_total', 'Total test requests', ['method', 'status']);

      counter.inc({ method: 'GET', status: '200' });
      counter.inc({ method: 'GET', status: '200' }, 4);
      counter.inc({ method: 'POST', status: '500' }, 2);

      expect(counter.get({ method: 'GET', status: '200' })).toBe(5);
      expect(counter.get({ method: 'POST', status: '500' })).toBe(2);

      const serialized = registry.metrics();
      expect(serialized).toContain('# HELP test_requests_total Total test requests');
      expect(serialized).toContain('# TYPE test_requests_total counter');
      expect(serialized).toContain('test_requests_total{method="GET",status="200"} 5');
      expect(serialized).toContain('test_requests_total{method="POST",status="500"} 2');
    });

    it('should reject negative increments on Counter', () => {
      const counter = new Counter({ name: 'safe_counter', help: 'Safe counter' });
      expect(() => counter.inc({}, -1)).toThrow(/cannot decrease/);
    });

    it('should manage Gauge values with set, inc, and dec', () => {
      const registry = new PrometheusRegistry();
      const gauge = registry.registerGauge('queue_size_active', 'Active items in queue', ['queue']);

      gauge.set({ queue: 'default' }, 10);
      expect(gauge.get({ queue: 'default' })).toBe(10);

      gauge.inc({ queue: 'default' }, 5);
      expect(gauge.get({ queue: 'default' })).toBe(15);

      gauge.dec({ queue: 'default' }, 7);
      expect(gauge.get({ queue: 'default' })).toBe(8);

      const serialized = registry.metrics();
      expect(serialized).toContain('# HELP queue_size_active Active items in queue');
      expect(serialized).toContain('# TYPE queue_size_active gauge');
      expect(serialized).toContain('queue_size_active{queue="default"} 8');
    });

    it('should observe values in Histogram and correctly populate buckets, sum, and count', () => {
      const registry = new PrometheusRegistry();
      const histogram = registry.registerHistogram(
        'request_duration_seconds',
        'Request latency in seconds',
        ['handler'],
        [0.01, 0.05, 0.1, 0.5, 1.0]
      );

      histogram.observe({ handler: 'search' }, 0.005);
      histogram.observe({ handler: 'search' }, 0.04);
      histogram.observe({ handler: 'search' }, 0.08);
      histogram.observe({ handler: 'search' }, 0.6);
      histogram.observe({ handler: 'search' }, 2.0);

      const stats = histogram.get({ handler: 'search' });
      expect(stats.count).toBe(5);
      expect(stats.sum).toBeCloseTo(2.725, 3);

      const output = registry.metrics();
      expect(output).toContain('# TYPE request_duration_seconds histogram');
      expect(output).toContain('request_duration_seconds_bucket{handler="search",le="0.01"} 1');
      expect(output).toContain('request_duration_seconds_bucket{handler="search",le="0.05"} 2');
      expect(output).toContain('request_duration_seconds_bucket{handler="search",le="0.1"} 3');
      expect(output).toContain('request_duration_seconds_bucket{handler="search",le="0.5"} 3');
      expect(output).toContain('request_duration_seconds_bucket{handler="search",le="1"} 4');
      expect(output).toContain('request_duration_seconds_bucket{handler="search",le="+Inf"} 5');
      expect(output).toContain('request_duration_seconds_count{handler="search"} 5');
    });

    it('should escape special characters in label values', () => {
      const registry = new PrometheusRegistry();
      const counter = registry.registerCounter('error_messages_total', 'Errors', ['message']);
      counter.inc({ message: 'Error: "Failed\\Timeout"\nRetry' });

      const metrics = registry.metrics();
      expect(metrics).toContain('message="Error: \\"Failed\\\\Timeout\\"\\nRetry"');
    });
  });

  describe('2. Standard Platform Metrics', () => {
    it('should record platform HTTP, model, tool, and agent metrics', () => {
      PlatformMetrics.httpRequestsTotal.inc({
        method: 'POST',
        route: '/api/v1/chat',
        status_code: 200,
        tenant_id: tenantId,
      }, 3);

      PlatformMetrics.modelTokensTotal.inc({
        model_id: 'gpt-4o',
        token_type: 'input',
        tenant_id: tenantId,
      }, 1500);

      PlatformMetrics.modelTokensTotal.inc({
        model_id: 'gpt-4o',
        token_type: 'output',
        tenant_id: tenantId,
      }, 450);

      PlatformMetrics.toolExecutionsTotal.inc({
        tool_name: 'database.query',
        status: 'success',
        tenant_id: tenantId,
      });

      const metricsOutput = globalPrometheusRegistry.metrics();
      expect(metricsOutput).toContain('http_requests_total{method="POST",route="/api/v1/chat",status_code="200",tenant_id="tenant_obs_test_01"} 3');
      expect(metricsOutput).toContain('model_tokens_total{model_id="gpt-4o",tenant_id="tenant_obs_test_01",token_type="input"} 1500');
      expect(metricsOutput).toContain('model_tokens_total{model_id="gpt-4o",tenant_id="tenant_obs_test_01",token_type="output"} 450');
      expect(metricsOutput).toContain('tool_executions_total{status="success",tenant_id="tenant_obs_test_01",tool_name="database.query"} 1');
    });
  });

  describe('3. W3C Distributed Tracing & Trace Context', () => {
    it('should correctly generate and validate 32-hex traceId and 16-hex spanId', () => {
      const traceId = DistributedContextManager.generateTraceId();
      const spanId = DistributedContextManager.generateSpanId();

      expect(traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(spanId).toMatch(/^[0-9a-f]{16}$/);
      expect(traceId).not.toBe('00000000000000000000000000000000');
      expect(spanId).not.toBe('0000000000000000');
    });

    it('should parse and format valid W3C traceparent headers', () => {
      const validHeader = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
      const parsed = DistributedContextManager.parseTraceparent(validHeader);

      expect(parsed).not.toBeNull();
      expect(parsed!.version).toBe('00');
      expect(parsed!.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
      expect(parsed!.parentId).toBe('00f067aa0ba902b7');
      expect(parsed!.flags).toBe('01');

      const formatted = DistributedContextManager.formatTraceparent(
        parsed!.traceId,
        parsed!.parentId,
        parsed!.flags
      );
      expect(formatted).toBe(validHeader);
    });

    it('should reject malformed or illegal W3C traceparent headers', () => {
      expect(DistributedContextManager.parseTraceparent(null)).toBeNull();
      expect(DistributedContextManager.parseTraceparent('')).toBeNull();
      expect(DistributedContextManager.parseTraceparent('invalid-trace-parent')).toBeNull();
      // Version ff is prohibited
      expect(DistributedContextManager.parseTraceparent('ff-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01')).toBeNull();
      // All-zero traceId is prohibited
      expect(DistributedContextManager.parseTraceparent('00-00000000000000000000000000000000-00f067aa0ba902b7-01')).toBeNull();
      // All-zero parentId is prohibited
      expect(DistributedContextManager.parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01')).toBeNull();
    });

    it('should parse and format W3C tracestate vendor pairs', () => {
      const stateHeader = 'kriya=t:tenant123,congo=t61rcWkgMzE';
      const parsed = DistributedContextManager.parseTracestate(stateHeader);

      expect(parsed['kriya']).toBe('t:tenant123');
      expect(parsed['congo']).toBe('t61rcWkgMzE');

      const formatted = DistributedContextManager.formatTracestate(parsed);
      expect(formatted).toContain('kriya=t:tenant123');
      expect(formatted).toContain('congo=t61rcWkgMzE');
    });

    it('should propagate trace context across async boundaries with AsyncLocalStorage', async () => {
      const rootContext: DistributedTraceContext = {
        traceId: '1234567890abcdef1234567890abcdef',
        spanId: 'abcdef1234567890',
        traceFlags: '01',
        correlationId: 'corr_test_async_123',
        tenantId,
        baggage: { origin: 'api_gateway' },
      };

      await DistributedContextManager.run(rootContext, async () => {
        const current = DistributedContextManager.current();
        expect(current?.traceId).toBe(rootContext.traceId);
        expect(current?.correlationId).toBe(rootContext.correlationId);

        // Child span within async task
        const child = DistributedContextManager.createChildContext();
        expect(child.traceId).toBe(rootContext.traceId);
        expect(child.parentSpanId).toBe(rootContext.spanId);
        expect(child.spanId).not.toBe(rootContext.spanId);
      });
    });

    it('should extract trace context from incoming headers or fallback to fresh root context', () => {
      const existingHeaders = {
        traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
        'x-correlation-id': 'custom_corr_id_99',
      };

      const extracted = DistributedContextManager.extractFromHeaders(existingHeaders);
      expect(extracted.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
      expect(extracted.parentSpanId).toBe('00f067aa0ba902b7');
      expect(extracted.correlationId).toBe('custom_corr_id_99');

      const emptyExtracted = DistributedContextManager.extractFromHeaders({});
      expect(emptyExtracted.traceId).toHaveLength(32);
      expect(emptyExtracted.spanId).toHaveLength(16);
      expect(emptyExtracted.parentSpanId).toBeUndefined();
    });
  });

  describe('4. Multi-Window SLO Burn Rate Engine & Attention Escalation', () => {
    let sreRepo: SreRepository;
    let engine: SloEvaluationEngine;
    let attentionService: AttentionService;
    let testSlo: SloDefinition;

    beforeEach(async () => {
      sreRepo = new SreRepository(db.getClient());
      attentionService = new AttentionService(db.getClient());
      engine = new SloEvaluationEngine(db.getClient(), sreRepo, attentionService);

      testSlo = {
        id: 'slo_core_api_avail',
        name: 'Core Agent Gateway 99.9% Availability',
        serviceName: 'core-agent-gateway',
        targetMetric: 'availability',
        targetThreshold: 99.9, // 99.9% target -> 0.1% error budget
        windowDays: 30,
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await sreRepo.saveSloDefinition(testSlo);
    });

    it('should compute normal status when actual metrics meet SLO target', async () => {
      const result = await engine.evaluateSlo(tenantId, testSlo.id, 99.95);

      expect(result.evaluation.isCompliant).toBe(true);
      expect(result.evaluation.burnRate1h).toBeLessThan(1.0);
      expect(result.evaluation.errorBudgetRemainingPct).toBe(50); // 0.05% out of 0.1% used
      expect(result.evaluation.alertStatus).toBe('normal');
      expect(result.alert).toBeUndefined();
      expect(result.attentionItemId).toBeUndefined();

      // Verify Prometheus Gauge values updated
      expect(
        PlatformMetrics.sloErrorBudgetRemainingPercent.get({
          slo_id: testSlo.id,
          service_name: testSlo.serviceName,
        })
      ).toBe(50);
    });

    it('should trigger warning status on elevated burn rate (3.0x)', async () => {
      // Metric drops to 99.7% -> 0.3% error / 0.1% budget -> 3.0x burn rate
      const result = await engine.evaluateSlo(tenantId, testSlo.id, 99.7);

      expect(result.evaluation.isCompliant).toBe(false);
      expect(result.evaluation.burnRate1h).toBe(3.0);
      expect(result.evaluation.alertStatus).toBe('warning');
      expect(result.alert).toBeDefined();
      expect(result.alert?.severity).toBe('P2_HIGH');
      expect(result.attentionItemId).toBeUndefined(); // Warning does not page Attention Center

      // Verify Prometheus Gauge
      expect(
        PlatformMetrics.sloBurnRateRatio.get({
          slo_id: testSlo.id,
          service_name: testSlo.serviceName,
          window: '1h',
        })
      ).toBe(3.0);
    });

    it('should trigger critical status on 14.4x burn rate and auto-escalate to Human Attention Center (reasonCategory: slo_burn)', async () => {
      // Metric drops to 98.0% -> 2.0% error on 0.1% budget -> 20x burn rate (>= 14.4x)
      const result = await engine.evaluateSlo(tenantId, testSlo.id, 98.0);

      expect(result.evaluation.isCompliant).toBe(false);
      expect(result.evaluation.burnRate1h).toBe(20.0);
      expect(result.evaluation.alertStatus).toBe('critical');
      expect(result.alert).toBeDefined();
      expect(result.alert?.severity).toBe('P1_CRITICAL');

      // Crucial: Must be auto-escalated to Attention Center
      expect(result.attentionItemId).toBeDefined();

      // Verify Attention Center record in database
      const client = db.getClient();
      const attentionRow = await client.queryOne<any>(
        `SELECT * FROM attention_items WHERE id = ?`,
        [result.attentionItemId]
      );

      expect(attentionRow).not.toBeNull();
      expect(attentionRow.reason_category).toBe('slo_burn');
      expect(attentionRow.priority).toBe('P1_HIGH');
      expect(attentionRow.title).toContain('[SLO CRITICAL BURN]');
      expect(attentionRow.title).toContain('20x');

      // Verify incident recorded in migration 055 table
      const incidentRow = await client.queryOne<any>(
        `SELECT * FROM slo_alert_incidents WHERE slo_id = ? AND status = 'firing'`,
        [testSlo.id]
      );
      expect(incidentRow).not.toBeNull();
      expect(incidentRow.burn_rate_1h).toBe(20.0);
      expect(incidentRow.escalated_attention_item_id).toBe(result.attentionItemId);

      // Verify Prometheus Gauge updated to 20x
      expect(
        PlatformMetrics.sloBurnRateRatio.get({
          slo_id: testSlo.id,
          service_name: testSlo.serviceName,
          window: '1h',
        })
      ).toBe(20.0);
    });

    it('should allow acknowledging and resolving SLO alert incidents', async () => {
      await engine.evaluateSlo(tenantId, testSlo.id, 98.0);
      const incidents = await engine.listIncidents(tenantId, 'firing');
      expect(incidents.length).toBeGreaterThan(0);
      const incidentId = incidents[0].id;

      await engine.acknowledgeIncident(tenantId, incidentId);
      const acknowledged = await engine.listIncidents(tenantId, 'acknowledged');
      expect(acknowledged.some((inc) => inc.id === incidentId)).toBe(true);

      await engine.resolveIncident(tenantId, incidentId);
      const resolved = await engine.listIncidents(tenantId, 'resolved');
      expect(resolved.some((inc) => inc.id === incidentId)).toBe(true);
    });
  });

  describe('5. Fastify REST Endpoints & Request Tracing Hooks', () => {
    let app: FastifyInstance;

    beforeEach(async () => {
      app = await buildServer();
    });

    afterEach(async () => {
      await app.close();
    });

    it('GET /metrics should expose standard Prometheus exposition format without authentication', async () => {
      // Record a test metric
      PlatformMetrics.httpRequestsTotal.inc({
        method: 'GET',
        route: '/metrics',
        status_code: 200,
        tenant_id: 'system',
      });

      const res = await app.inject({
        method: 'GET',
        url: '/metrics',
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/plain');
      expect(res.payload).toContain('# HELP http_requests_total');
      expect(res.payload).toContain('# TYPE http_requests_total counter');
      expect(res.payload).toContain('http_requests_total{method="GET",route="/metrics",status_code="200",tenant_id="system"}');
    });

    it('GET /api/v1/observability/metrics/prometheus should require authentication', async () => {
      const unauthRes = await app.inject({
        method: 'GET',
        url: '/api/v1/observability/metrics/prometheus',
      });
      expect(unauthRes.statusCode).toBe(401);

      const authRes = await app.inject({
        method: 'GET',
        url: '/api/v1/observability/metrics/prometheus',
        headers: {
          authorization: `Bearer ${viewerToken}`,
        },
      });
      expect(authRes.statusCode).toBe(200);
      expect(authRes.headers['content-type']).toContain('text/plain');
    });

    it('should inject W3C traceparent and correlation ID into response headers and observe request metrics', async () => {
      const incomingTraceparent = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';

      const res = await app.inject({
        method: 'GET',
        url: '/health',
        headers: {
          traceparent: incomingTraceparent,
          'x-correlation-id': 'corr_test_header_99',
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['x-correlation-id']).toBe('corr_test_header_99');
      expect(res.headers['traceparent']).toMatch(/^00-0af7651916cd43dd8448eb211c80319c-[0-9a-f]{16}-01$/);

      // Verify that PlatformMetrics captured the HTTP request
      const metricsOutput = globalPrometheusRegistry.metrics();
      expect(metricsOutput).toContain('http_requests_total');
      expect(metricsOutput).toContain('route="/health"');
      expect(metricsOutput).toContain('http_request_duration_seconds_count');
    });

    it('should create, list, and evaluate SLOs via REST API', async () => {
      // 1. Create SLO (System Admin)
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/observability/slos',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
        payload: {
          name: 'Checkout Gateway Latency',
          serviceName: 'checkout-service',
          targetMetric: 'p95_latency_ms',
          targetThreshold: 250, // 250ms threshold
          windowDays: 30,
        },
      });

      expect(createRes.statusCode).toBe(201);
      const slo = JSON.parse(createRes.payload);
      expect(slo.id).toBeDefined();
      expect(slo.targetMetric).toBe('p95_latency_ms');

      // 2. List SLOs
      const listRes = await app.inject({
        method: 'GET',
        url: '/api/v1/observability/slos',
        headers: {
          authorization: `Bearer ${viewerToken}`,
        },
      });

      expect(listRes.statusCode).toBe(200);
      const listData = JSON.parse(listRes.payload);
      expect(listData.count).toBeGreaterThanOrEqual(1);

      // 3. Evaluate SLO with elevated latency (400ms > 250ms target -> Warning/Critical)
      const evalRes = await app.inject({
        method: 'POST',
        url: `/api/v1/observability/slos/${slo.id}/evaluate`,
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
        payload: {
          actualMetricValue: 400,
        },
      });

      expect(evalRes.statusCode).toBe(200);
      const evalData = JSON.parse(evalRes.payload);
      expect(evalData.evaluation.isCompliant).toBe(false);
      expect(evalData.alert).toBeDefined();

      // 4. List Alerts via REST API
      const alertsRes = await app.inject({
        method: 'GET',
        url: '/api/v1/observability/alerts',
        headers: {
          authorization: `Bearer ${viewerToken}`,
        },
      });

      expect(alertsRes.statusCode).toBe(200);
      const alertsData = JSON.parse(alertsRes.payload);
      expect(alertsData.sreAlerts.length).toBeGreaterThan(0);
    });

    it('should search and filter distributed spans with tenant isolation', async () => {
      const traceRepo = new TraceRepository(db.getClient());

      // Seed a trace and two spans
      const trace = await traceRepo.createTrace({
        correlationId: 'run_span_test_01',
        rootAgentId: 'order_orchestrator',
        tenantId,
      });

      await traceRepo.recordSpan({
        traceId: trace.id,
        spanName: 'validate_payload',
        agentId: 'order_orchestrator',
        stepType: 'policy_check',
        latencyMs: 15,
        tenantId,
      });

      await traceRepo.recordSpan({
        traceId: trace.id,
        spanName: 'charge_card',
        agentId: 'payments_agent',
        stepType: 'tool_execution',
        latencyMs: 120,
        tenantId,
      });

      // Query spans via REST API
      const spansRes = await app.inject({
        method: 'GET',
        url: `/api/v1/observability/spans?traceId=${trace.id}&stepType=tool_execution`,
        headers: {
          authorization: `Bearer ${viewerToken}`,
        },
      });

      expect(spansRes.statusCode).toBe(200);
      const body = JSON.parse(spansRes.payload);
      expect(body.count).toBe(1);
      expect(body.spans[0].span_name).toBe('charge_card');
      expect(body.spans[0].step_type).toBe('tool_execution');
    });
  });
});
