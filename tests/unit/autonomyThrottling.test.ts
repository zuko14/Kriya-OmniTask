/**
 * Kriya Omnitask — Error-Budget Autonomy Throttling Tests (WP-6.3)
 * (CLAUDE.md §15, §37; Blueprint §14; docs/kriya WP-6.3, ADR-026)
 *
 * Comprehensive unit and integration verification for:
 * 1. Mathematical error budget, SLA targets, and burn rate calculation.
 * 2. S53 zero-fabrication honest unmeasured baselines.
 * 3. Automated step-down throttling on budget burnout (T2 -> T1 -> T0).
 * 4. Immediate tripwires on consecutive verification failures.
 * 5. Attention Center P1 escalation with deterministic role routing.
 * 6. Runtime Graph enforcement: T2 actions park at human_gate when throttled.
 * 7. Human-in-the-loop restoration governance with optional golden suite re-check.
 * 8. REST API endpoints under /api/v1/autonomy/*.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { SQLiteDatabaseClient, db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { buildServer } from '../../src/api/server.js';
import { JwtService } from '../../src/security/auth/jwt.js';
import { TenantContextManager } from '../../src/core/context/tenantContext.js';
import { TenantRepository } from '../../src/storage/repositories/tenantRepository.js';
import { AutonomyThrottlingService } from '../../src/throttling/service/autonomyThrottlingService.js';
import { AutonomyThrottlingRepository } from '../../src/throttling/repositories/autonomyThrottlingRepository.js';
import { OutcomeKpiRepository } from '../../src/outcomes/repositories/outcomeKpiRepository.js';
import { AttentionService } from '../../src/attention/service/attentionService.js';
import { TIER_SLA_CONFIG } from '../../src/throttling/types/autonomyThrottlingTypes.js';
import { DEFAULT_PAYMENTS_CHARTER, createPaymentsReceiver } from '../../src/agents/phase0/paymentsAgent.js';
import { ToolRegistryService } from '../../src/tools/registry/toolRegistry.js';
import { MandateService } from '../../src/trust/mandate/mandateService.js';
import { ProofService } from '../../src/trust/proof/proofService.js';
import { charterToLoopSpec } from '../../src/agents/charter/agentCharter.js';
import { ModelGateway } from '../../src/model/gateway/modelGateway.js';

function scriptedGateway(replies: object[]) {
  let i = 0;
  return new ModelGateway({
    adapterFor: (): any => ({
      async execute() {
        const reply = replies[Math.min(i++, replies.length - 1)];
        return {
          content: JSON.stringify(reply),
          promptTokens: 25,
          completionTokens: 15,
          costUsd: 0.0001,
        };
      },
    }),
  });
}

describe('Error-Budget Autonomy Throttling & Governance (WP-6.3)', () => {
  let client: SQLiteDatabaseClient;
  let server: FastifyInstance;
  let throttlingService: AutonomyThrottlingService;
  let throttlingRepo: AutonomyThrottlingRepository;
  let outcomeRepo: OutcomeKpiRepository;
  let attentionService: AttentionService;
  let toolRegistry: ToolRegistryService;
  let proofSeq = 1;

  async function seedProofReceipt(
    tenant: string,
    agentSlug: string,
    actionType: string,
    riskTier: string,
    state: 'verified' | 'mismatch' | 'pending' | 'failed'
  ) {
    await client.execute(
      `INSERT OR IGNORE INTO proof_signing_keys (key_id, algorithm, public_key_pem, status, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      ['test-key-autonomy', 'ed25519', 'pem-dummy', 'active', new Date().toISOString()]
    );
    const id = `proof_${Date.now()}_${proofSeq}`;
    await client.execute(
      `INSERT INTO proof_receipts (id, tenant_id, sequence, run_id, node_id, action_type, risk_tier, body_json, prev_hash, hash, key_id, signature, issued_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        tenant,
        proofSeq++,
        `run_${id}`,
        'node_action',
        actionType,
        riskTier,
        JSON.stringify({ agentSlug, verification: { state } }),
        '0'.repeat(64),
        `hash_${id}`,
        'test-key-autonomy',
        'sig_dummy',
        new Date().toISOString(),
      ]
    );
  }

  const tenantId = 'tenant_autonomy_test';
  const otherTenantId = 'tenant_other_test';

  beforeEach(async () => {
    proofSeq = 1;
    client = new SQLiteDatabaseClient(':memory:');
    db.setClientForTesting(client);

    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    server = await buildServer();

    const tenantRepo = new TenantRepository(client);
    await tenantRepo.create({
      id: tenantId,
      name: 'Autonomy Test Tenant',
      slug: 'autonomy-test',
    });
    await tenantRepo.create({
      id: otherTenantId,
      name: 'Other Tenant',
      slug: 'other-tenant',
    });

    throttlingRepo = new AutonomyThrottlingRepository(client);
    outcomeRepo = new OutcomeKpiRepository(client);
    attentionService = new AttentionService(client);
    throttlingService = new AutonomyThrottlingService(client, throttlingRepo, outcomeRepo, attentionService);
    toolRegistry = new ToolRegistryService();
  });

  afterEach(async () => {
    if (server) {
      await server.close();
    }
  });

  describe('1. Mathematical Error Budget & SLA Baseline', () => {
    it('defines accurate SLA targets and error budgets per risk tier', () => {
      expect(TIER_SLA_CONFIG.T0.targetSlaRate).toBe(1.0);
      expect(TIER_SLA_CONFIG.T0.allowedErrorBudget).toBe(0.0);

      expect(TIER_SLA_CONFIG.T1.targetSlaRate).toBe(0.95);
      expect(TIER_SLA_CONFIG.T1.allowedErrorBudget).toBe(0.05);

      expect(TIER_SLA_CONFIG.T2.targetSlaRate).toBe(0.99);
      expect(TIER_SLA_CONFIG.T2.allowedErrorBudget).toBe(0.01);

      expect(TIER_SLA_CONFIG.T3.targetSlaRate).toBe(0.999);
      expect(TIER_SLA_CONFIG.T3.allowedErrorBudget).toBe(0.001);
    });

    it('returns honest unmeasured status and unthrottled tier when zero actions exist (S53 adherence)', async () => {
      const result = await throttlingService.evaluateAgent(tenantId, 'payments', DEFAULT_PAYMENTS_CHARTER);

      expect(result.metrics.unmeasured).toBe(true);
      expect(result.metrics.sampleCount).toBe(0);
      expect(result.metrics.verifiedActionRate).toBeNull();
      expect(result.isThrottled).toBe(false);
      expect(result.effectiveTier).toBe('T2');
      expect(result.action).toBe('unchanged');

      const effectiveTier = await throttlingService.getEffectiveTierCap(tenantId, 'payments', 'T2');
      expect(effectiveTier).toBe('T2');
    });
  });

  describe('2. Automated Step-Down Throttling on Budget Burnout', () => {
    it('automatically steps down autonomy from T2 to T1 when error budget is exhausted', async () => {
      // Seed 19 verified proofs and 1 mismatch proof (sample = 20, failure = 1, error rate = 5% vs 1% budget -> 500% burned)
      for (let i = 0; i < 19; i++) {
        await seedProofReceipt(tenantId, 'payments', 'payment_refund', 'T2', 'verified');
      }
      await seedProofReceipt(tenantId, 'payments', 'payment_refund', 'T2', 'mismatch');

      const result = await throttlingService.evaluateAgent(tenantId, 'payments', DEFAULT_PAYMENTS_CHARTER);

      expect(result.stateChanged).toBe(true);
      expect(result.action).toBe('throttled');
      expect(result.isThrottled).toBe(true);
      expect(result.configuredTier).toBe('T2');
      expect(result.effectiveTier).toBe('T1');
      expect(result.metrics.sampleCount).toBe(20);
      expect(result.metrics.failureCount).toBe(1);
      expect(result.metrics.burnedBudgetPercent).toBe(500.0);
      expect(result.attentionItemId).toBeDefined();

      // Check effective tier cap
      const effectiveCap = await throttlingService.getEffectiveTierCap(tenantId, 'payments', 'T2');
      expect(effectiveCap).toBe('T1');

      // Verify audit event was logged
      const { events } = await throttlingRepo.listEvents(tenantId, { agentSlug: 'payments' });
      expect(events.length).toBe(1);
      expect(events[0].event_type).toBe('throttled');
      expect(events[0].from_tier).toBe('T2');
      expect(events[0].to_tier).toBe('T1');
      expect(events[0].burned_budget_percent).toBe(500.0);
    });

    it('steps down further from T1 to T0 if failures persist while throttled at T1', async () => {
      // Pre-seed budget at T1 (throttled)
      await throttlingRepo.upsertBudget({
        id: 'budget_t1',
        tenant_id: tenantId,
        agent_slug: 'scheduling',
        configured_tier_cap: 'T1',
        effective_tier_cap: 'T1',
        is_throttled: true,
        target_sla_rate: 0.95,
        allowed_error_budget: 0.05,
        current_error_rate: 0.1,
        burned_budget_percent: 200.0,
        sample_count: 10,
        failure_count: 1,
        consecutive_failures: 0,
        throttled_at: new Date().toISOString(),
        throttled_reason: 'Previous burnout',
        restored_at: null,
        restored_by: null,
        last_evaluated_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      // Insert high failure rate (e.g. 2 failures out of 5 actions = 40% error rate vs 5% budget -> 800% burned)
      for (let i = 0; i < 3; i++) {
        await seedProofReceipt(tenantId, 'scheduling', 'scheduling_hold', 'T1', 'verified');
      }
      for (let i = 0; i < 2; i++) {
        await seedProofReceipt(tenantId, 'scheduling', 'scheduling_hold', 'T1', 'mismatch');
      }

      const result = await throttlingService.evaluateAgent(tenantId, 'scheduling', {
        slug: 'scheduling',
        version: '1.0.0',
        owns: 'scheduling',
        goal: 'manage appointments',
        tools: [],
        autonomyTierCap: 'T1',
        owner: 'clinic_manager',
      });

      expect(result.action).toBe('throttled');
      expect(result.effectiveTier).toBe('T0');
    });
  });

  describe('3. Consecutive Verification Failure Tripwire', () => {
    it('immediately trips throttle when consecutive failures reach threshold regardless of sample count', async () => {
      // Record 2 consecutive failures directly
      await throttlingService.recordDirectExecutionFailure(
        tenantId,
        'payments',
        'Verification read-back mismatch: payment link amount mismatched ledger',
        DEFAULT_PAYMENTS_CHARTER
      );

      const tripped = await throttlingService.recordDirectExecutionFailure(
        tenantId,
        'payments',
        'Verification read-back mismatch: payment hold expired prematurely',
        DEFAULT_PAYMENTS_CHARTER
      );

      expect(tripped.isThrottled).toBe(true);
      expect(tripped.effectiveTier).toBe('T1');
      expect(tripped.metrics.consecutiveFailures).toBe(2);
      expect(tripped.reason).toContain('Immediate tripwire: 2 consecutive verification failures');
    });
  });

  describe('4. Warning Threshold Event', () => {
    it('logs an audited budget_warning when burn rate reaches 75% without stepping down', async () => {
      // Seed budget with burn rate around 80% (allowed 5%, error rate 4%: 4/5 * 100 = 80%)
      await throttlingRepo.upsertBudget({
        id: 'budget_warn',
        tenant_id: tenantId,
        agent_slug: 'document',
        configured_tier_cap: 'T1',
        effective_tier_cap: 'T1',
        is_throttled: false,
        target_sla_rate: 0.95,
        allowed_error_budget: 0.05,
        current_error_rate: 0.04,
        burned_budget_percent: 80.0,
        sample_count: 50,
        failure_count: 2,
        consecutive_failures: 0,
        throttled_at: null,
        throttled_reason: null,
        restored_at: null,
        restored_by: null,
        last_evaluated_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      // Insert 48 ok proofs, 2 fail proofs
      for (let i = 0; i < 48; i++) {
        await seedProofReceipt(tenantId, 'document', 'document_extract', 'T1', 'verified');
      }
      for (let i = 0; i < 2; i++) {
        await seedProofReceipt(tenantId, 'document', 'document_extract', 'T1', 'mismatch');
      }

      const res = await throttlingService.evaluateAgent(tenantId, 'document', {
        slug: 'document',
        version: '1.0.0',
        owns: 'document extraction',
        goal: 'extract records',
        tools: [],
        autonomyTierCap: 'T1',
        owner: 'records_lead',
      });

      expect(res.action).toBe('warning');
      expect(res.isThrottled).toBe(false);
      expect(res.effectiveTier).toBe('T1');

      const { events } = await throttlingRepo.listEvents(tenantId, { agentSlug: 'document' });
      expect(events.some((e) => e.event_type === 'budget_warning')).toBe(true);
    });
  });

  describe('5. Attention Center Escalation & Role Routing', () => {
    it('escalates to Attention Center with P1_HIGH and assigns to the charter owner role', async () => {
      // Seed failure causing burnout
      for (let i = 0; i < 3; i++) {
        await seedProofReceipt(tenantId, 'payments', 'payment_refund', 'T2', 'mismatch');
      }

      const result = await throttlingService.evaluateAgent(tenantId, 'payments', DEFAULT_PAYMENTS_CHARTER);
      expect(result.attentionItemId).toBeDefined();

      const item = await client.queryOne<any>('SELECT * FROM attention_items WHERE id = ?', [result.attentionItemId!]);
      expect(item).toBeDefined();
      expect(item?.priority).toBe('P1_HIGH');
      expect(item?.reason_category).toBe('policy_violation');
      expect(item?.assigned_role).toBe('billing_manager');
      expect(item?.title).toContain("Autonomy Throttled: Agent 'payments' stepped down to T1");

      const context = JSON.parse(item?.context_data_json || '{}');
      expect(context.agentSlug).toBe('payments');
      expect(context.previousTier).toBe('T2');
      expect(context.effectiveTier).toBe('T1');
      expect(context.burnedBudgetPercent).toBeGreaterThan(100);
    });
  });

  describe('6. Runtime Graph & Loop Spec Gate Enforcement', () => {
    it('sets requireApproval: true for T2 tools when charter is compiled with effectiveTierCap: T1', () => {
      const normalSpec = charterToLoopSpec(DEFAULT_PAYMENTS_CHARTER, toolRegistry);
      const refundToolNormal = normalSpec.tools.find((t) => t.slug === 'payment_refund');
      expect(refundToolNormal?.tier).toBe('T2');
      expect(refundToolNormal?.requireApproval).toBeUndefined(); // T2 within T2 cap -> no approval

      // Now compile with effectiveTierCap: T1 (throttled)
      const throttledSpec = charterToLoopSpec(DEFAULT_PAYMENTS_CHARTER, toolRegistry, 'T1');
      const refundToolThrottled = throttledSpec.tools.find((t) => t.slug === 'payment_refund');
      expect(refundToolThrottled?.tier).toBe('T2');
      expect(refundToolThrottled?.requireApproval).toBe(true); // T2 above T1 cap -> require approval!
    });

    it('parks payment transaction at human_gate when paymentsAgent is throttled', async () => {
      // Throttle the payments agent in the database
      await throttlingRepo.upsertBudget({
        id: 'budget_throttled_pmt',
        tenant_id: tenantId,
        agent_slug: 'payments',
        configured_tier_cap: 'T2',
        effective_tier_cap: 'T1',
        is_throttled: true,
        target_sla_rate: 0.99,
        allowed_error_budget: 0.01,
        current_error_rate: 0.05,
        burned_budget_percent: 500.0,
        sample_count: 20,
        failure_count: 1,
        consecutive_failures: 0,
        throttled_at: new Date().toISOString(),
        throttled_reason: 'Error budget burned',
        restored_at: null,
        restored_by: null,
        last_evaluated_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const gateway = scriptedGateway([
        {
          action: 'tool',
          tool: 'payment_refund',
          args: { amount: 500, reason: 'cancel' },
          reason: 'Refund customer',
        },
      ]);

      const receiver = createPaymentsReceiver({
        registry: toolRegistry,
        client,
        attention: attentionService,
        throttlingService,
        gateway,
      });

      const res = await TenantContextManager.withTenant(
        tenantId,
        'default',
        async () =>
          receiver(
            {
              to: 'payments',
              intent: 'payment',
              entities: { amount: 500, service: 'consultation' },
              language: 'en',
              reason: 'Customer requested refund',
            },
            {
              key: 'corr_throttled_test_1',
              customerId: 'cust_throttled_1',
              request: 'Please refund my ₹500 fee',
            }
          ),
        { userId: 'user_operator', roles: ['admin'] }
      );

      // Verify the run was parked at human_gate instead of completing autonomously!
      expect(res.outcome).toBe('parked');

      // Verify run record in graph_runs
      const run = await client.queryOne<any>('SELECT * FROM graph_runs WHERE id = ?', [res.ref]);
      expect(run.status).toBe('parked');
      expect(run.next_node_id).toBe('payment_refund__approval');
      expect(run.park_reason).toContain("Approve 'payment_refund' (T2)");
    });
  });

  describe('7. Human Review & Restoration Protocol', () => {
    it('refuses restoration if justification reason is missing or trivial (< 5 chars)', async () => {
      await throttlingRepo.upsertBudget({
        id: 'budget_restore_test',
        tenant_id: tenantId,
        agent_slug: 'payments',
        configured_tier_cap: 'T2',
        effective_tier_cap: 'T1',
        is_throttled: true,
        target_sla_rate: 0.99,
        allowed_error_budget: 0.01,
        current_error_rate: 0.05,
        burned_budget_percent: 500.0,
        sample_count: 20,
        failure_count: 1,
        consecutive_failures: 0,
        throttled_at: new Date().toISOString(),
        throttled_reason: 'Error budget burned',
        restored_at: null,
        restored_by: null,
        last_evaluated_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      await expect(
        throttlingService.restoreAutonomy(tenantId, {
          agentSlug: 'payments',
          restoredBy: 'manager_1',
          reason: 'ok', // too short (< 5 chars)
        })
      ).rejects.toThrow();
    });

    it('refuses restoration if agent is not currently throttled', async () => {
      await throttlingRepo.upsertBudget({
        id: 'budget_not_throttled',
        tenant_id: tenantId,
        agent_slug: 'scheduling',
        configured_tier_cap: 'T1',
        effective_tier_cap: 'T1',
        is_throttled: false,
        target_sla_rate: 0.95,
        allowed_error_budget: 0.05,
        current_error_rate: 0.0,
        burned_budget_percent: 0.0,
        sample_count: 10,
        failure_count: 0,
        consecutive_failures: 0,
        throttled_at: null,
        throttled_reason: null,
        restored_at: null,
        restored_by: null,
        last_evaluated_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      await expect(
        throttlingService.restoreAutonomy(tenantId, {
          agentSlug: 'scheduling',
          restoredBy: 'manager_1',
          reason: 'Attempting to restore unthrottled agent',
        })
      ).rejects.toThrow(/not currently throttled/);
    });

    it('restores autonomy back to configured tier cap with human actor and audited event', async () => {
      await throttlingRepo.upsertBudget({
        id: 'budget_restore_success',
        tenant_id: tenantId,
        agent_slug: 'payments',
        configured_tier_cap: 'T2',
        effective_tier_cap: 'T1',
        is_throttled: true,
        target_sla_rate: 0.99,
        allowed_error_budget: 0.01,
        current_error_rate: 0.05,
        burned_budget_percent: 500.0,
        sample_count: 20,
        failure_count: 1,
        consecutive_failures: 2,
        throttled_at: new Date().toISOString(),
        throttled_reason: 'Burnout',
        restored_at: null,
        restored_by: null,
        last_evaluated_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const restored = await throttlingService.restoreAutonomy(tenantId, {
        agentSlug: 'payments',
        restoredBy: 'billing_supervisor_42',
        reason: 'Investigated gateway webhook delay, upstream sync verified clean',
      });

      expect(restored.is_throttled).toBe(false);
      expect(restored.effective_tier_cap).toBe('T2');
      expect(restored.consecutive_failures).toBe(0);
      expect(restored.restored_by).toBe('billing_supervisor_42');
      expect(restored.restored_at).toBeDefined();

      const { events } = await throttlingRepo.listEvents(tenantId, { agentSlug: 'payments' });
      const restoreEvent = events.find((e) => e.event_type === 'restored');
      expect(restoreEvent).toBeDefined();
      expect(restoreEvent?.from_tier).toBe('T1');
      expect(restoreEvent?.to_tier).toBe('T2');
      expect(restoreEvent?.actor).toBe('billing_supervisor_42');
    });

    it('verifies agent golden eval suite when verifyFirst: true before lifting throttle', async () => {
      await throttlingRepo.upsertBudget({
        id: 'budget_verify_first',
        tenant_id: tenantId,
        agent_slug: 'attention',
        configured_tier_cap: 'T0',
        effective_tier_cap: 'T0',
        is_throttled: true,
        target_sla_rate: 1.0,
        allowed_error_budget: 0.0,
        current_error_rate: 0.1,
        burned_budget_percent: 200.0,
        sample_count: 10,
        failure_count: 1,
        consecutive_failures: 0,
        throttled_at: new Date().toISOString(),
        throttled_reason: 'Burnout',
        restored_at: null,
        restored_by: null,
        last_evaluated_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      // Restoration with verifyFirst: true runs the attention golden suite (5/5 clean)
      const restored = await throttlingService.restoreAutonomy(tenantId, {
        agentSlug: 'attention',
        restoredBy: 'sre_lead',
        reason: 'Executed full attention golden test suite, all 5 cases passed with zero breaches',
        verifyFirst: true,
      });

      expect(restored.is_throttled).toBe(false);
      expect(restored.restored_by).toBe('sre_lead');
    });
  });

  describe('8. REST API Endpoints Integration', () => {
    it('GET /api/v1/autonomy/status returns agent error budgets scoped to the tenant', async () => {
      await throttlingRepo.upsertBudget({
        id: 'b_api_1',
        tenant_id: tenantId,
        agent_slug: 'payments',
        configured_tier_cap: 'T2',
        effective_tier_cap: 'T1',
        is_throttled: true,
        target_sla_rate: 0.99,
        allowed_error_budget: 0.01,
        current_error_rate: 0.05,
        burned_budget_percent: 500.0,
        sample_count: 20,
        failure_count: 1,
        consecutive_failures: 0,
        throttled_at: new Date().toISOString(),
        throttled_reason: 'Burnout',
        restored_at: null,
        restored_by: null,
        last_evaluated_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const token = JwtService.signToken({
        userId: 'op_1',
        tenantId,
        email: 'operator@kriya.ai',
        roles: ['admin'],
      });

      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/autonomy/status',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.data.tenantId).toBe(tenantId);
      expect(body.data.total).toBe(1);
      expect(body.data.throttledCount).toBe(1);
      expect(body.data.budgets[0].agent_slug).toBe('payments');
    });

    it('GET /api/v1/autonomy/status/:agentSlug returns 404 for untracked agent', async () => {
      const token = JwtService.signToken({
        userId: 'op_1',
        tenantId,
        email: 'operator@kriya.ai',
        roles: ['admin'],
      });

      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/autonomy/status/unknown_agent',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(res.statusCode).toBe(404);
    });

    it('POST /api/v1/autonomy/evaluate triggers evaluation and returns fleet result', async () => {
      const token = JwtService.signToken({
        userId: 'op_1',
        tenantId,
        email: 'operator@kriya.ai',
        roles: ['admin'],
      });

      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/autonomy/evaluate',
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          agentSlug: 'intake',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.data.agentSlug).toBe('intake');
    });

    it('POST /api/v1/autonomy/restore restores throttled agent via authenticated API', async () => {
      await throttlingRepo.upsertBudget({
        id: 'b_api_restore',
        tenant_id: tenantId,
        agent_slug: 'payments',
        configured_tier_cap: 'T2',
        effective_tier_cap: 'T1',
        is_throttled: true,
        target_sla_rate: 0.99,
        allowed_error_budget: 0.01,
        current_error_rate: 0.05,
        burned_budget_percent: 500.0,
        sample_count: 20,
        failure_count: 1,
        consecutive_failures: 0,
        throttled_at: new Date().toISOString(),
        throttled_reason: 'Burnout',
        restored_at: null,
        restored_by: null,
        last_evaluated_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const token = JwtService.signToken({
        userId: 'op_1',
        tenantId,
        email: 'operator@kriya.ai',
        roles: ['admin'],
      });

      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/autonomy/restore',
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          agentSlug: 'payments',
          reason: 'Investigated gateway webhook delay, upstream sync verified clean',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.data.budget.is_throttled).toBe(false);
      expect(body.data.budget.effective_tier_cap).toBe('T2');
    });

    it('GET /api/v1/autonomy/events returns paginated audit events', async () => {
      await throttlingRepo.recordEvent({
        id: 'evt_1',
        tenant_id: tenantId,
        agent_slug: 'payments',
        event_type: 'throttled',
        from_tier: 'T2',
        to_tier: 'T1',
        burned_budget_percent: 500.0,
        reason: 'Error budget burned',
        actor: 'system:error_budget_engine',
        evidence_json: '{}',
        created_at: new Date().toISOString(),
      });

      const token = JwtService.signToken({
        userId: 'op_1',
        tenantId,
        email: 'operator@kriya.ai',
        roles: ['admin'],
      });

      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/autonomy/events?agentSlug=payments',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.data.total).toBe(1);
      expect(body.data.events[0].event_type).toBe('throttled');
    });
  });
});
