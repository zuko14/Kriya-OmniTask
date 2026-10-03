/**
 * Kriya AI — Human Gate Interrupt/Resume <-> Attention Center Integration Tests (WP-2.5)
 *
 * Verifies:
 * 1. Park at human gate creates an Attention item with structured context (runId, step, reason, risk).
 * 2. Deduplication / Idempotent park (escalateOnce with correlationId).
 * 3. Operator resolves Attention item -> triggers automatic graph run resume.
 * 4. Operator approves via Workflow API / executor -> auto-resolves linked Attention item.
 * 5. Rejection branch routing to terminal outcome (escalated).
 * 6. Timeout policy evaluation (escalate, auto-reject, auto-approve).
 * 7. Multi-tenant isolation for both Graph Runs and Attention Items.
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
import { AttentionService } from '../../src/attention/service/attentionService.js';
import { AttentionRepository } from '../../src/attention/repositories/attentionRepository.js';
import { workflowRoutes } from '../../src/api/routes/workflowRoutes.js';
import { attentionRoutes } from '../../src/api/routes/attentionRoutes.js';
import { JwtService } from '../../src/security/auth/jwt.js';

const approvalGraph = (): GraphDefinition => ({
  id: 'high_value_refund_gate',
  version: '1.0.0',
  entry: 'understand',
  maxSteps: 40,
  nodes: [
    { id: 'understand', kind: 'llm', config: { outputSchema: 'RefundIntent' } },
    { id: 'policy', kind: 'policy', config: {} },
    { id: 'mandate', kind: 'mandate', config: {} },
    {
      id: 'human_gate_approval',
      kind: 'human_gate',
      config: {
        reason: 'Refund exceeds autonomous mandate limit ($500)',
        requiredRole: 'finance_manager',
        timeoutMs: 3600000, // 1 hour
        timeoutAction: 'reject',
      },
    },
    { id: 'execute_refund', kind: 'tool', actionTier: 'T2', config: { tool: 'payments.refund' } },
    { id: 'readback', kind: 'verify', config: {}, maxVisits: 3 },
    { id: 'settled', kind: 'router', config: {}, maxVisits: 3 },
    { id: 'receipt', kind: 'proof', config: {} },
    { id: 'done', kind: 'end', outcome: 'verified', config: {} },
    { id: 'mismatch', kind: 'end', outcome: 'verification_failed', config: {} },
    { id: 'rejection_notice', kind: 'end', outcome: 'escalated', config: {} },
  ],
  edges: [
    { from: 'understand', to: 'policy' },
    { from: 'policy', to: 'mandate' },
    { from: 'mandate', to: 'human_gate_approval' },
    {
      from: 'human_gate_approval',
      to: 'execute_refund',
      when: [{ path: 'approval.decision', op: 'eq', value: 'approved' }],
    },
    { from: 'human_gate_approval', to: 'rejection_notice' },
    { from: 'execute_refund', to: 'readback' },
    { from: 'readback', to: 'settled' },
    { from: 'settled', to: 'receipt', when: [{ path: 'verification.state', op: 'eq', value: 'verified' }] },
    { from: 'settled', to: 'mismatch' },
    { from: 'receipt', to: 'done' },
  ],
});

interface ActionCounters {
  refundsExecuted: number;
}

const createMockHandlers = (counters: ActionCounters): NodeHandlers => ({
  llm: async () => ({ patch: { intent: 'refund' } }),
  policy: async () => ({ patch: { policy: { decision: 'allow' } } }),
  mandate: async () => ({ patch: { mandate: { decision: 'over_limit' } } }),
  tool: async () => {
    counters.refundsExecuted++;
    return { patch: { refundStatus: 'processed', txId: 'tx_999' } };
  },
  verify: async () => ({ patch: { verification: { state: 'verified' } } }),
  proof: async ({ state }) => ({ patch: { receipt: { id: 'rcpt_1', hash: hashState(state) } } }),
});

describe('WP-2.5: Human Gate (Interrupt/Resume) <-> Attention Center', () => {
  let client: SQLiteDatabaseClient;
  let tenantA: string;
  let tenantB: string;
  let counters: ActionCounters;

  const inTenantA = <T>(fn: () => Promise<T>) =>
    TenantContextManager.withTenant(tenantA, 'org_a', fn, {
      userId: 'usr_ops_lead',
      roles: ['operations_lead', 'finance_manager', 'admin'],
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
    tenantA = (await tenantRepo.create({ name: 'Acme Health', slug: 'acme-health', plan_tier: 'enterprise', channel_plan: 'combined' })).id;
    tenantB = (await tenantRepo.create({ name: 'Beta Care', slug: 'beta-care', plan_tier: 'enterprise', channel_plan: 'combined' })).id;
    counters = { refundsExecuted: 0 };
    GraphExecutor.setDefaultHandlers(createMockHandlers(counters));
  });

  afterEach(async () => {
    GraphExecutor.resetDefaultHandlers();
    await client.close();
  });

  it('1. Parks at human gate and creates an Attention item with full execution context', async () => {
    await inTenantA(async () => {
      const graphRepo = new GraphRunRepository(client);
      const attentionService = new AttentionService(client);
      const executor = new GraphExecutor(createMockHandlers(counters), graphRepo, undefined, attentionService);

      const runOutcome = await executor.start(approvalGraph(), {
        request: 'Refund request for VIP patient',
        financialValueUsd: 1250,
        customerId: 'cust_vip_42',
      });

      expect(runOutcome.status).toBe('parked');
      expect(runOutcome.parkReason).toBe('Refund exceeds autonomous mandate limit ($500)');
      expect(counters.refundsExecuted).toBe(0);

      // Verify graph run in database
      const run = await graphRepo.getRun(runOutcome.runId);
      expect(run).toBeDefined();
      expect(run?.status).toBe('parked');
      const parsedState = JSON.parse(run!.state_json);
      expect(parsedState.attentionItemId).toBeDefined();
      expect(parsedState.approvalRequestedAt).toBeDefined();

      // Verify Attention Item in database
      const attentionRepo = new AttentionRepository(client);
      const item = await attentionRepo.findById(parsedState.attentionItemId);
      expect(item).toBeDefined();
      expect(item?.priority).toBe('P1_HIGH');
      expect(item?.reason_category).toBe('workflow_suspended');
      expect(item?.status).toBe('pending');
      expect(item?.correlation_id).toBe(`${runOutcome.runId}:human_gate_approval`);

      const ctxData = JSON.parse(item!.context_data_json);
      expect(ctxData.runId).toBe(runOutcome.runId);
      expect(ctxData.nodeId).toBe('human_gate_approval');
      expect(ctxData.graphId).toBe('high_value_refund_gate');
      expect(ctxData.financialValueUsd).toBe(1250);
      expect(ctxData.customerId).toBe('cust_vip_42');
      expect(ctxData.requiredRole).toBe('finance_manager');
    });
  });

  it('2. Is idempotent on node re-entry or retry without creating duplicate attention items', async () => {
    await inTenantA(async () => {
      const graphRepo = new GraphRunRepository(client);
      const attentionService = new AttentionService(client);
      const attentionRepo = new AttentionRepository(client);
      const executor = new GraphExecutor(createMockHandlers(counters), graphRepo, undefined, attentionService);

      const runOutcome = await executor.start(approvalGraph(), { financialValueUsd: 750 });
      const run = (await graphRepo.getRun(runOutcome.runId))!;
      const state1 = JSON.parse(run.state_json);
      const itemId1 = state1.attentionItemId;

      // Simulate a re-execution of the human gate for the same run
      const outcome2 = await executor.executeHumanGate({
        node: approvalGraph().nodes.find((n) => n.id === 'human_gate_approval')!,
        state: state1,
        runId: runOutcome.runId,
        graph: approvalGraph(),
        visit: 1,
        idempotencyKey: `human_gate_approval:idem`,
      });

      expect(outcome2.park?.attentionItemId).toBe(itemId1);

      const allItems = await attentionRepo.listItems({ limit: 10 });
      expect(allItems.filter((it) => it.correlation_id === `${runOutcome.runId}:human_gate_approval`).length).toBe(1);
    });
  });

  it('3. Resuming via executor marks attention item resolved and advances DAG to completion', async () => {
    await inTenantA(async () => {
      const graphRepo = new GraphRunRepository(client);
      const attentionService = new AttentionService(client);
      const attentionRepo = new AttentionRepository(client);
      const executor = new GraphExecutor(createMockHandlers(counters), graphRepo, undefined, attentionService);

      const parked = await executor.start(approvalGraph(), { financialValueUsd: 800 });
      expect(parked.status).toBe('parked');

      const parsedState = JSON.parse((await graphRepo.getRun(parked.runId))!.state_json);
      const attentionItemId = parsedState.attentionItemId;

      // Resume with approval
      const resumed = await executor.resume(parked.runId, {
        decision: 'approved',
        notes: 'Approved by clinical director',
        humanApproverId: 'lead_director_1',
      });

      expect(resumed.status).toBe('completed');
      expect(resumed.outcome).toBe('verified');
      expect(counters.refundsExecuted).toBe(1);
      expect(resumed.state.refundStatus).toBe('processed');

      // Verify linked Attention item status was updated to resolved
      const item = await attentionRepo.findById(attentionItemId);
      expect(item?.status).toBe('resolved');
      expect(item?.resolution_action).toBe('approved');
      expect(item?.resolution_notes).toContain('Approved by clinical director');
    });
  });

  it('4. Rejection decision routes to escalated rejection terminal node and resolves attention item', async () => {
    await inTenantA(async () => {
      const graphRepo = new GraphRunRepository(client);
      const attentionService = new AttentionService(client);
      const attentionRepo = new AttentionRepository(client);
      const executor = new GraphExecutor(createMockHandlers(counters), graphRepo, undefined, attentionService);

      const parked = await executor.start(approvalGraph(), { financialValueUsd: 1500 });
      const parsedState = JSON.parse((await graphRepo.getRun(parked.runId))!.state_json);

      // Resume with rejection
      const resumed = await executor.resume(parked.runId, {
        decision: 'rejected',
        notes: 'Documentation incomplete',
        humanApproverId: 'auditor_9',
      });

      expect(resumed.status).toBe('completed');
      expect(resumed.outcome).toBe('escalated');
      expect(counters.refundsExecuted).toBe(0); // tool never ran

      const item = await attentionRepo.findById(parsedState.attentionItemId);
      expect(item?.status).toBe('resolved');
      expect(item?.resolution_action).toBe('rejected');
      expect(item?.resolution_notes).toContain('Documentation incomplete');
    });
  });

  it('5. Timeout policy auto-rejects when timeoutMs has expired', async () => {
    await inTenantA(async () => {
      const graphRepo = new GraphRunRepository(client);
      const attentionService = new AttentionService(client);
      const attentionRepo = new AttentionRepository(client);
      const executor = new GraphExecutor(createMockHandlers(counters), graphRepo, undefined, attentionService);

      const parked = await executor.start(approvalGraph(), { financialValueUsd: 1000 });
      const run = (await graphRepo.getRun(parked.runId))!;
      const state = JSON.parse(run.state_json);

      // Case A: Checked before timeout has passed (e.g. 10 minutes later)
      const now1 = new Date(Date.parse(state.approvalRequestedAt) + 10 * 60 * 1000);
      const resultNotExpired = await executor.evaluateParkedRunTimeout(parked.runId, now1);
      expect(resultNotExpired.timedOut).toBe(false);
      expect((await graphRepo.getRun(parked.runId))!.status).toBe('parked');

      // Case B: Checked after 2 hours (timeoutMs is 1 hour, timeoutAction is 'reject')
      const now2 = new Date(Date.parse(state.approvalRequestedAt) + 2 * 3600 * 1000);
      const resultExpired = await executor.evaluateParkedRunTimeout(parked.runId, now2);
      expect(resultExpired.timedOut).toBe(true);
      expect(resultExpired.action).toBe('reject');
      expect(resultExpired.runResult?.status).toBe('completed');
      expect(resultExpired.runResult?.outcome).toBe('escalated');
      expect(counters.refundsExecuted).toBe(0);

      // Attention item should now be resolved as expired/timed-out
      const item = await attentionRepo.findById(state.attentionItemId);
      expect(item?.status).toBe('resolved');
      expect(item?.resolution_action).toBe('rejected');
      expect(item?.resolution_notes).toContain('timeout');
    });
  });

  it('6. Multi-tenant isolation: Tenant B cannot view or resume runs of Tenant A', async () => {
    let runIdTenantA = '';
    await inTenantA(async () => {
      const graphRepo = new GraphRunRepository(client);
      const executor = new GraphExecutor(createMockHandlers(counters), graphRepo, undefined, new AttentionService(client));
      const parked = await executor.start(approvalGraph(), { financialValueUsd: 900 });
      runIdTenantA = parked.runId;
    });

    await inTenantB(async () => {
      const graphRepo = new GraphRunRepository(client);
      const executor = new GraphExecutor(createMockHandlers(counters), graphRepo, undefined, new AttentionService(client));

      const run = await graphRepo.getRun(runIdTenantA);
      expect(run).toBeNull();

      await expect(
        executor.resume(runIdTenantA, { decision: 'approved' })
      ).rejects.toThrow(/not found for this tenant/);

      expect(counters.refundsExecuted).toBe(0);
    });
  });

  describe('REST Endpoints Integration (Workflows & Attention)', () => {
    let app: FastifyInstance;
    let authHeaderA: Record<string, string>;

    beforeEach(async () => {
      app = Fastify();
      await app.register(workflowRoutes);
      await app.register(attentionRoutes);
      await app.ready();

      const tokenA = JwtService.sign({
        userId: 'admin_usr_a',
        tenantId: tenantA,
        organizationId: 'org_a',
        email: 'admin@acme.com',
        roles: ['admin', 'operations_lead', 'finance_manager'],
      });
      authHeaderA = { authorization: `Bearer ${tokenA}` };
    });

    afterEach(async () => {
      await app.close();
    });

    it('7. Workflow API: lists runs, inspects details, and approves parked run', async () => {
      let parkedRunId = '';
      await inTenantA(async () => {
        const graphRepo = new GraphRunRepository(client);
        const executor = new GraphExecutor(createMockHandlers(counters), graphRepo, undefined, new AttentionService(client));
        const res = await executor.start(approvalGraph(), { financialValueUsd: 1200 });
        parkedRunId = res.runId;
      });

      // GET /api/v1/workflows/runs?status=parked
      const listRes = await app.inject({
        method: 'GET',
        url: '/api/v1/workflows/runs?status=parked',
        headers: authHeaderA,
      });
      expect(listRes.statusCode).toBe(200);
      const listData = listRes.json();
      expect(listData.runs.some((r: any) => r.id === parkedRunId)).toBe(true);

      // GET /api/v1/workflows/runs/:runId
      const detailRes = await app.inject({
        method: 'GET',
        url: `/api/v1/workflows/runs/${parkedRunId}`,
        headers: authHeaderA,
      });
      expect(detailRes.statusCode).toBe(200);
      const detailData = detailRes.json();
      expect(detailData.run.id).toBe(parkedRunId);
      expect(detailData.run.status).toBe('parked');
      expect(detailData.state.financialValueUsd).toBe(1200);
      expect(detailData.checkpoints.length).toBeGreaterThan(0);

      // POST /api/v1/workflows/runs/:runId/approve
      const approveRes = await app.inject({
        method: 'POST',
        url: `/api/v1/workflows/runs/${parkedRunId}/approve`,
        headers: authHeaderA,
        payload: { notes: 'Approved via Workflow API' },
      });
      expect(approveRes.statusCode).toBe(200);
      const approveData = approveRes.json();
      expect(approveData.status).toBe('completed');
      expect(approveData.outcome).toBe('verified');
      expect(counters.refundsExecuted).toBe(1);
    });

    it('8. Attention Center API: resolving item auto-resumes linked workflow run', async () => {
      let parkedRunId = '';
      let attentionItemId = '';

      await inTenantA(async () => {
        const graphRepo = new GraphRunRepository(client);
        const executor = new GraphExecutor(createMockHandlers(counters), graphRepo, undefined, new AttentionService(client));
        const res = await executor.start(approvalGraph(), { financialValueUsd: 2200 });
        parkedRunId = res.runId;
        const run = (await graphRepo.getRun(parkedRunId))!;
        attentionItemId = JSON.parse(run.state_json).attentionItemId;
      });

      expect(attentionItemId).toBeDefined();

      // POST /api/v1/attention/items/:id/resolve with action 'approved'
      const resolveRes = await app.inject({
        method: 'POST',
        url: `/api/v1/attention/items/${attentionItemId}/resolve`,
        headers: authHeaderA,
        payload: {
          action: 'approved',
          notes: 'Resolved and approved from Attention Center console',
        },
      });

      expect(resolveRes.statusCode).toBe(200);
      const resolveData = resolveRes.json();
      expect(resolveData.status).toBe('resolved');
      expect(resolveData.runOutcome).toBeDefined();
      expect(resolveData.runOutcome.status).toBe('completed');
      expect(resolveData.runOutcome.outcome).toBe('verified');
      expect(counters.refundsExecuted).toBe(1);

      // Check run status in DB
      await inTenantA(async () => {
        const graphRepo = new GraphRunRepository(client);
        const run = (await graphRepo.getRun(parkedRunId))!;
        expect(run.status).toBe('completed');
        expect(run.outcome).toBe('verified');
      });
    });
  });
});
