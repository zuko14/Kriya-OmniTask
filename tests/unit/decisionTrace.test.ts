/**
 * Kriya AI — Decision Trace & Observability Integration Tests (WP-2.6)
 *
 * Verifies:
 * 1. Graph execution automatically starts an execution trace and records OpenTelemetry-shaped spans.
 * 2. Spans contain OpenTelemetry semantic attributes (workflow.run.id, workflow.node.id, workflow.step, etc.).
 * 3. Decision trace timeline synthesis (ObservabilityService.getDecisionTrace) combines graph runs, checkpoints, and spans.
 * 4. Strict PII sanitization in trace summaries and attributes (email, phone, Aadhaar, PAN, SSN, credit cards).
 * 5. Async read-back verification jobs record child spans linked to the run's trace.
 * 6. Parked and escalated runs correctly record span outcomes and finalize trace states.
 * 7. Fastify REST API endpoints:
 *    - GET /api/v1/workflows/runs/:runId/trace
 *    - GET /api/v1/observability/decision-traces/:id
 * 8. Strict multi-tenant isolation on trace queries and endpoints.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { db, SQLiteDatabaseClient } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { TenantRepository } from '../../src/storage/repositories/tenantRepository.js';
import { TenantContextManager } from '../../src/core/context/tenantContext.js';
import { GraphExecutor, NodeHandlers, hashState } from '../../src/runtime/graph/executor.js';
import { GraphRunRepository } from '../../src/runtime/graph/graphRunRepository.js';
import { GraphDefinition } from '../../src/runtime/graph/types.js';
import { ObservabilityService } from '../../src/observability/service/observabilityService.js';
import { TraceRepository } from '../../src/observability/repositories/traceRepository.js';
import { SemanticAttributes } from '../../src/observability/types/observabilityTypes.js';
import { VerificationJobService } from '../../src/attention/service/verificationJobService.js';
import { VerificationJobRepository } from '../../src/attention/repositories/verificationJobRepository.js';
import { ToolRegistryService } from '../../src/tools/registry/toolRegistry.js';
import { z } from 'zod';
import { workflowRoutes } from '../../src/api/routes/workflowRoutes.js';
import { observabilityRoutes } from '../../src/api/routes/observabilityRoutes.js';
import { JwtService } from '../../src/security/auth/jwt.js';

const sampleWorkflowGraph = (): GraphDefinition => ({
  id: 'order_fulfillment_flow',
  version: '1.0.0',
  entry: 'validate_order',
  maxSteps: 30,
  nodes: [
    { id: 'validate_order', kind: 'router', config: { tier: 'T1' } },
    { id: 'policy', kind: 'policy', config: {} },
    { id: 'mandate', kind: 'mandate', config: {} },
    {
      id: 'process_payment',
      kind: 'tool',
      actionTier: 'T2',
      config: { tool: 'payments.charge', costUsd: 0.05, modelId: 'gpt-4o' },
    },
    { id: 'verify_payment', kind: 'verify', config: {} },
    { id: 'generate_receipt', kind: 'proof', config: {} },
    { id: 'done', kind: 'end', outcome: 'verified', config: {} },
  ],
  edges: [
    { from: 'validate_order', to: 'policy' },
    { from: 'policy', to: 'mandate' },
    { from: 'mandate', to: 'process_payment' },
    { from: 'process_payment', to: 'verify_payment' },
    { from: 'verify_payment', to: 'generate_receipt' },
    { from: 'generate_receipt', to: 'done' },
  ],
});

const humanGateGraph = (): GraphDefinition => ({
  id: 'wire_transfer_gate',
  version: '1.0.0',
  entry: 'prepare',
  maxSteps: 20,
  nodes: [
    { id: 'prepare', kind: 'router', config: {} },
    { id: 'policy', kind: 'policy', config: {} },
    { id: 'mandate', kind: 'mandate', config: {} },
    {
      id: 'approval_gate',
      kind: 'human_gate',
      config: {
        reason: 'Large transfer over $10,000 requires VP approval',
        requiredRole: 'vp_finance',
      },
    },
    { id: 'execute_transfer', kind: 'tool', actionTier: 'T2', config: { tool: 'wire.send' } },
    { id: 'verify_transfer', kind: 'verify', config: {} },
    { id: 'receipt_transfer', kind: 'proof', config: {} },
    { id: 'done', kind: 'end', outcome: 'verified', config: {} },
    { id: 'rejected_end', kind: 'end', outcome: 'escalated', config: {} },
  ],
  edges: [
    { from: 'prepare', to: 'policy' },
    { from: 'policy', to: 'mandate' },
    { from: 'mandate', to: 'approval_gate' },
    { from: 'approval_gate', to: 'execute_transfer', when: [{ path: 'approval.decision', op: 'eq', value: 'approved' }] },
    { from: 'approval_gate', to: 'rejected_end' },
    { from: 'execute_transfer', to: 'verify_transfer' },
    { from: 'verify_transfer', to: 'receipt_transfer' },
    { from: 'receipt_transfer', to: 'done' },
  ],
});

const defaultBaseHandlers: NodeHandlers = {
  router: async () => ({ patch: { routerPassed: true } }),
  policy: async () => ({ patch: { policyPassed: true } }),
  mandate: async () => ({ patch: { mandatePassed: true } }),
  verify: async () => ({ patch: { verification: { state: 'verified' } } }),
  proof: async ({ state }) => ({ patch: { receipt: { id: 'rcpt_default', hash: hashState(state) } } }),
};

describe('WP-2.6: Decision Trace & Observability Engine', () => {
  let client: SQLiteDatabaseClient;
  let tenantA: string;
  let tenantB: string;

  const inTenantA = <T>(fn: () => Promise<T>) =>
    TenantContextManager.withTenant(tenantA, 'org_a', fn, {
      userId: 'usr_ops_lead',
      roles: ['operations_lead', 'admin'],
    });

  const inTenantB = <T>(fn: () => Promise<T>) =>
    TenantContextManager.withTenant(tenantB, 'org_b', fn, {
      userId: 'usr_stranger',
      roles: ['operations_lead'],
    });

  beforeEach(async () => {
    client = new SQLiteDatabaseClient(':memory:');
    db.setClientForTesting(client);
    await new SchemaMigrator(client).applyMigrations();

    const tenantRepo = new TenantRepository(client);
    tenantA = (await tenantRepo.create({ name: 'Acme Logistics', slug: 'acme-logistics', plan_tier: 'enterprise', channel_plan: 'combined' })).id;
    tenantB = (await tenantRepo.create({ name: 'Beta Freight', slug: 'beta-freight', plan_tier: 'enterprise', channel_plan: 'combined' })).id;
  });

  afterEach(async () => {
    GraphExecutor.resetDefaultHandlers();
    await client.close();
  });

  it('1. Graph execution creates execution trace and records OpenTelemetry semantic spans', async () => {
    await inTenantA(async () => {
      const graphRepo = new GraphRunRepository(client);
      const traceRepo = new TraceRepository(client);
      const obsService = new ObservabilityService(traceRepo);

      const handlers: NodeHandlers = {
        ...defaultBaseHandlers,
        router: async () => ({ patch: { orderValidated: true } }),
        tool: async ({ node }) => ({
          patch: {
            paymentStatus: 'success',
            chargeId: 'ch_12345',
            tokensInput: 150,
            tokensOutput: 50,
            costUsd: 0.05,
            toolName: (node.config.tool as string) || 'payments.charge',
          },
        }),
        proof: async ({ state }) => ({
          patch: {
            receipt: {
              id: 'rcpt_order_999',
              hash: hashState(state),
            },
          },
        }),
      };

      const executor = new GraphExecutor(handlers, graphRepo, undefined, undefined, obsService);

      const runResult = await executor.start(sampleWorkflowGraph(), {
        orderId: 'ord_1001',
        amount: 250,
        customerId: 'cust_acme_1',
      });

      expect(runResult.status).toBe('completed');
      expect(runResult.outcome).toBe('verified');

      // 1. Verify trace record in repository
      const trace = await traceRepo.findTraceByCorrelationOrId(runResult.runId);
      expect(trace).toBeDefined();
      expect(trace?.id).toBe(runResult.runId);
      expect(trace?.root_agent_id).toBe('order_fulfillment_flow');
      expect(trace?.status).toBe('completed');

      // 2. Verify OpenTelemetry spans
      const spans = await traceRepo.listSpans(trace!.id);
      expect(spans.length).toBeGreaterThanOrEqual(5);

      const routerSpan = spans.find((s) => s.span_name.endsWith(':validate_order'));
      expect(routerSpan).toBeDefined();
      expect(routerSpan?.step_type).toBe('orchestration');
      expect(routerSpan?.status).toBe('completed');

      const toolSpan = spans.find((s) => s.span_name.endsWith(':process_payment'));
      expect(toolSpan).toBeDefined();
      expect(toolSpan?.step_type).toBe('tool_execution');
      expect(toolSpan?.tool_name).toBe('payments.charge');
      expect(toolSpan?.tokens_input).toBe(150);
      expect(toolSpan?.tokens_output).toBe(50);
      expect(toolSpan?.cost_usd).toBe(0.05);

      const toolAttrs = JSON.parse(toolSpan!.attributes_json);
      expect(toolAttrs[SemanticAttributes.WORKFLOW_RUN_ID]).toBe(runResult.runId);
      expect(toolAttrs[SemanticAttributes.WORKFLOW_NODE_ID]).toBe('process_payment');
      expect(toolAttrs[SemanticAttributes.WORKFLOW_NODE_KIND]).toBe('tool');
      expect(toolAttrs[SemanticAttributes.WORKFLOW_STEP]).toBe(4);

      const proofSpan = spans.find((s) => s.span_name.endsWith(':generate_receipt'));
      expect(proofSpan).toBeDefined();
      expect(proofSpan?.step_type).toBe('verification');
      const proofAttrs = JSON.parse(proofSpan!.attributes_json);
      expect(proofAttrs[SemanticAttributes.PROOF_RECEIPT_ID]).toBe('rcpt_order_999');
    });
  });

  it('2. ObservabilityService.getDecisionTrace synthesizes timeline, state deltas, and proof receipts', async () => {
    await inTenantA(async () => {
      const graphRepo = new GraphRunRepository(client);
      const traceRepo = new TraceRepository(client);
      const obsService = new ObservabilityService(traceRepo);

      const handlers: NodeHandlers = {
        ...defaultBaseHandlers,
        router: async () => ({ patch: { orderValidated: true, priority: 'standard' } }),
        tool: async () => ({
          patch: {
            paymentStatus: 'settled',
            txId: 'tx_abc',
            tokensInput: 100,
            tokensOutput: 40,
            costUsd: 0.02,
          },
        }),
        proof: async ({ state }) => ({
          patch: {
            receipt: {
              id: 'rcpt_proof_456',
              hash: hashState(state),
            },
          },
        }),
      };

      const executor = new GraphExecutor(handlers, graphRepo, undefined, undefined, obsService);
      const runResult = await executor.start(sampleWorkflowGraph(), {
        orderId: 'ord_2002',
      });

      const timeline = await obsService.getDecisionTrace(runResult.runId);

      expect(timeline.runId).toBe(runResult.runId);
      expect(timeline.graphId).toBe('order_fulfillment_flow');
      expect(timeline.status).toBe('completed');
      expect(timeline.outcome).toBe('verified');
      expect(timeline.nodes.length).toBeGreaterThanOrEqual(5);

      // Verify node timeline sequence
      const node0 = timeline.nodes[0];
      expect(node0.nodeId).toBe('validate_order');
      expect(node0.step).toBe(1);
      expect(node0.stateDelta).toMatchObject({ orderValidated: true, priority: 'standard' });

      const toolNode = timeline.nodes.find((n) => n.nodeId === 'process_payment');
      expect(toolNode).toBeDefined();
      expect(toolNode?.step).toBe(4);
      expect(toolNode?.stateDelta).toMatchObject({ paymentStatus: 'settled', txId: 'tx_abc' });

      // Verify proof receipts
      expect(timeline.proofReceipts.length).toBe(1);
      expect(timeline.proofReceipts[0].id).toBe('rcpt_proof_456');

      // Verify hierarchical waterfall spans
      expect(timeline.spans).toBeDefined();
      expect(Array.isArray(timeline.spans)).toBe(true);
    });
  });

  it('3. Guarantees strict PII redaction across span summaries and attributes', async () => {
    await inTenantA(async () => {
      const graphRepo = new GraphRunRepository(client);
      const traceRepo = new TraceRepository(client);
      const obsService = new ObservabilityService(traceRepo);

      const rawEmail = 'customer.vip@finance-corp.com';
      const rawPhone = '+1-415-555-8822';
      const rawAadhaar = '4567 8901 2345';
      const rawPan = 'BNZPK1234A';
      const rawCard = '4111 2222 3333 4444';
      const rawSsn = '123-45-6789';

      const handlers: NodeHandlers = {
        ...defaultBaseHandlers,
        router: async () => ({
          patch: {
            userEmail: rawEmail,
            contactPhone: rawPhone,
            nationalId: rawAadhaar,
            panCard: rawPan,
            ssn: rawSsn,
            card: rawCard,
            status: 'validated',
          },
        }),
        tool: async () => ({
          patch: {
            customerNote: `Processed billing for ${rawEmail} with card ${rawCard} and SSN ${rawSsn}`,
            recipientPhone: rawPhone,
          },
        }),
        proof: async ({ state }) => ({
          patch: {
            receipt: {
              id: 'rcpt_pii_test',
              hash: hashState(state),
            },
          },
        }),
      };

      const executor = new GraphExecutor(handlers, graphRepo, undefined, undefined, obsService);
      const runResult = await executor.start(sampleWorkflowGraph(), {
        initialEmail: rawEmail,
        initialPhone: rawPhone,
      });

      // 1. Inspect direct span records in DB
      const spans = await traceRepo.listSpans(runResult.runId);
      for (const span of spans) {
        // Assert raw PII strings do NOT appear in span summaries
        expect(span.input_summary || '').not.toContain(rawEmail);
        expect(span.input_summary || '').not.toContain(rawPhone);
        expect(span.input_summary || '').not.toContain(rawAadhaar);
        expect(span.input_summary || '').not.toContain(rawPan);
        expect(span.input_summary || '').not.toContain(rawCard);
        expect(span.input_summary || '').not.toContain(rawSsn);

        expect(span.output_summary || '').not.toContain(rawEmail);
        expect(span.output_summary || '').not.toContain(rawPhone);
        expect(span.output_summary || '').not.toContain(rawAadhaar);
        expect(span.output_summary || '').not.toContain(rawPan);
        expect(span.output_summary || '').not.toContain(rawCard);
        expect(span.output_summary || '').not.toContain(rawSsn);

        // Assert attributes_json does NOT contain raw PII strings
        expect(span.attributes_json).not.toContain(rawEmail);
        expect(span.attributes_json).not.toContain(rawPhone);
        expect(span.attributes_json).not.toContain(rawAadhaar);
        expect(span.attributes_json).not.toContain(rawPan);
        expect(span.attributes_json).not.toContain(rawCard);
        expect(span.attributes_json).not.toContain(rawSsn);
      }

      // 2. Inspect synthesized Decision Trace timeline
      const timeline = await obsService.getDecisionTrace(runResult.runId);
      const timelineJson = JSON.stringify(timeline);

      expect(timelineJson).not.toContain(rawEmail);
      expect(timelineJson).not.toContain(rawPhone);
      expect(timelineJson).not.toContain(rawAadhaar);
      expect(timelineJson).not.toContain(rawPan);
      expect(timelineJson).not.toContain(rawCard);
      expect(timelineJson).not.toContain(rawSsn);

      // Verify redaction tokens appear
      expect(timelineJson).toContain('[REDACTED_EMAIL]');
      expect(timelineJson).toContain('[REDACTED_PHONE]');
      expect(timelineJson).toContain('[REDACTED_AADHAAR]');
      expect(timelineJson).toContain('[REDACTED_PAN]');
      expect(timelineJson).toContain('[REDACTED_CREDIT_CARD]');
      expect(timelineJson).toContain('[REDACTED_SSN]');
    });
  });

  it('4. Read-back verification jobs record child spans linked to the workflow run trace', async () => {
    await inTenantA(async () => {
      const graphRepo = new GraphRunRepository(client);
      const traceRepo = new TraceRepository(client);
      const obsService = new ObservabilityService(traceRepo);

      const handlers: NodeHandlers = {
        ...defaultBaseHandlers,
        router: async () => ({ patch: { ready: true } }),
        tool: async () => ({ patch: { actionTaken: 'transfer_completed' } }),
        proof: async ({ state }) => ({ patch: { receipt: { id: 'rcpt_777', hash: hashState(state) } } }),
      };

      const executor = new GraphExecutor(handlers, graphRepo, undefined, undefined, obsService);
      const runResult = await executor.start(sampleWorkflowGraph(), { orderId: 'ord_readback' });

      // Setup tool registry with a verifiable tool
      const registry = new ToolRegistryService();
      registry.registerTool({
        definition: {
          slug: 'payments_charge',
          name: 'Payment Gateway',
          description: 'Charge credit card',
          category: 'payment',
          riskTier: 'HIGH',
          requiresApproval: false,
          isSystem: true,
          inputSchema: {},
          outputSchema: {},
        },
        inputValidator: z.object({ chargeId: z.string() }),
        handler: async () => ({ status: 'success' }),
        verify: async () => ({
          state: 'verified',
          observed: { gatewayStatus: 'cleared', settleTime: '2026-10-02T10:00:00Z' },
        }),
      });

      const verificationRepo = new VerificationJobRepository(client);
      const verificationService = new VerificationJobService(client, registry, undefined, verificationRepo, traceRepo);

      // Create and execute a verification job for this run
      const job = await verificationService.createJob({
        runId: runResult.runId,
        idempotencyKey: `${runResult.runId}:verify:1`,
        toolSlug: 'payments_charge',
        actionInput: { chargeId: 'ch_verified_123' },
        actionOutput: { status: 'success' },
      });

      const processedJob = await verificationService.processJob(job.id);
      expect(processedJob.status).toBe('verified');

      // Verify that a verification child span was added to the trace
      const spans = await traceRepo.listSpans(runResult.runId);
      const verificationSpan = spans.find((s) => s.span_name === 'verification:payments_charge');
      expect(verificationSpan).toBeDefined();
      expect(verificationSpan?.step_type).toBe('verification');
      expect(verificationSpan?.status).toBe('completed');

      const attrs = JSON.parse(verificationSpan!.attributes_json);
      expect(attrs[SemanticAttributes.VERIFICATION_JOB_ID]).toBe(job.id);
      expect(attrs[SemanticAttributes.VERIFICATION_STATE]).toBe('verified');
      expect(attrs['verification.passed']).toBe(true);
      expect(attrs['verification.system']).toBe('Payment Gateway');
    });
  });

  it('5. Correctly handles parked human gate and resumed trace execution', async () => {
    await inTenantA(async () => {
      const graphRepo = new GraphRunRepository(client);
      const traceRepo = new TraceRepository(client);
      const obsService = new ObservabilityService(traceRepo);

      const handlers: NodeHandlers = {
        ...defaultBaseHandlers,
        router: async () => ({ patch: { prepared: true } }),
        tool: async () => ({ patch: { wireExecuted: true, txRef: 'wire_999' } }),
      };

      const executor = new GraphExecutor(handlers, graphRepo, undefined, undefined, obsService);

      // Start run -> should park at human_gate
      const parkedResult = await executor.start(humanGateGraph(), {
        amount: 25000,
      });

      expect(parkedResult.status).toBe('parked');

      // Check spans recorded up to gate
      const spans1 = await traceRepo.listSpans(parkedResult.runId);
      const gateSpan = spans1.find((s) => s.span_name.endsWith(':approval_gate'));
      expect(gateSpan).toBeDefined();
      expect(gateSpan?.step_type).toBe('policy_check');
      expect(gateSpan?.output_summary).toContain('Parked');

      // Check timeline in parked state
      const timelineParked = await obsService.getDecisionTrace(parkedResult.runId);
      expect(timelineParked.status).toBe('parked');

      // Resume run with approval
      const resumedResult = await executor.resume(parkedResult.runId, {
        decision: 'approved',
        notes: 'Transfer approved by VP',
      });

      expect(resumedResult.status).toBe('completed');
      expect(resumedResult.outcome).toBe('verified');

      // Verify updated timeline includes post-resume tool execution
      const timelineCompleted = await obsService.getDecisionTrace(parkedResult.runId);
      expect(timelineCompleted.status).toBe('completed');
      expect(timelineCompleted.outcome).toBe('verified');

      const toolNode = timelineCompleted.nodes.find((n) => n.nodeId === 'execute_transfer');
      expect(toolNode).toBeDefined();
      expect(toolNode?.status).toBe('completed');
    });
  });

  it('6. Fastify REST API: GET /api/v1/workflows/runs/:runId/trace and GET /api/v1/observability/decision-traces/:id', async () => {
    // Spin up Fastify with routes
    const app: FastifyInstance = Fastify();
    await app.register(workflowRoutes);
    await app.register(observabilityRoutes);

    // Create a run in Tenant A
    let runId = '';
    await inTenantA(async () => {
      const graphRepo = new GraphRunRepository(client);
      const traceRepo = new TraceRepository(client);
      const obsService = new ObservabilityService(traceRepo);

      const handlers: NodeHandlers = {
        ...defaultBaseHandlers,
        router: async () => ({ patch: { ok: true } }),
        tool: async () => ({ patch: { success: true } }),
        proof: async ({ state }) => ({ patch: { receipt: { id: 'rcpt_api_test', hash: hashState(state) } } }),
      };

      const executor = new GraphExecutor(handlers, graphRepo, undefined, undefined, obsService);
      const res = await executor.start(sampleWorkflowGraph(), { orderId: 'api_ord_1' });
      runId = res.runId;
    });

    const tokenA = JwtService.sign({
      userId: 'usr_ops_lead',
      email: 'ops_lead@acme.com',
      tenantId: tenantA,
      organizationId: 'org_a',
      roles: ['operations_lead', 'admin'],
    });

    const tokenB = JwtService.sign({
      userId: 'usr_stranger',
      email: 'stranger@beta.com',
      tenantId: tenantB,
      organizationId: 'org_b',
      roles: ['admin'],
    });

    // 1. Valid request to /api/v1/workflows/runs/:runId/trace in Tenant A
    const resA1 = await app.inject({
      method: 'GET',
      url: `/api/v1/workflows/runs/${runId}/trace`,
      headers: { authorization: `Bearer ${tokenA}` },
    });

    expect(resA1.statusCode).toBe(200);
    const traceDataA = resA1.json();
    expect(traceDataA.runId).toBe(runId);
    expect(traceDataA.nodes.length).toBeGreaterThanOrEqual(5);
    expect(traceDataA.proofReceipts.length).toBe(1);

    // 2. Valid request to /api/v1/observability/decision-traces/:id in Tenant A
    const resA2 = await app.inject({
      method: 'GET',
      url: `/api/v1/observability/decision-traces/${runId}`,
      headers: { authorization: `Bearer ${tokenA}` },
    });

    expect(resA2.statusCode).toBe(200);
    const traceDataA2 = resA2.json();
    expect(traceDataA2.runId).toBe(runId);
    expect(traceDataA2.status).toBe('completed');

    // 3. Multi-tenant isolation: Tenant B trying to access Tenant A's run trace -> 404
    const resB = await app.inject({
      method: 'GET',
      url: `/api/v1/workflows/runs/${runId}/trace`,
      headers: { authorization: `Bearer ${tokenB}` },
    });

    expect(resB.statusCode).toBe(404);

    await app.close();
  });
});
