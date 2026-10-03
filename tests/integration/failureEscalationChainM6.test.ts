import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { FailureEscalationChain } from '../../src/orchestration/escalation/failureEscalationChain.js';
import { SupervisorRemediationService } from '../../src/orchestration/escalation/services/supervisorRemediationService.js';
import { OrchestratorReassessmentEngine } from '../../src/orchestration/escalation/services/orchestratorReassessmentEngine.js';
import { EscalationRepository } from '../../src/orchestration/escalation/repositories/escalationRepository.js';
import { AttentionService } from '../../src/attention/service/attentionService.js';
import { AttentionRepository } from '../../src/attention/repositories/attentionRepository.js';
import { ModelCertificationRepository } from '../../src/model/certification/modelCertificationRepository.js';
import { TenantContextManager } from '../../src/core/context/tenantContext.js';
import {
  StructuredFailureRecord,
  CreateStructuredFailureInput,
  DEFAULT_BUDGET_CEILINGS,
} from '../../src/orchestration/escalation/types/escalationTypes.js';

describe('Milestone M6 — Failure Escalation Chain Integration Tests (§5, §15, §18.5, §23)', () => {
  let escalationChain: FailureEscalationChain;
  let supervisorService: SupervisorRemediationService;
  let orchestratorEngine: OrchestratorReassessmentEngine;
  let escalationRepo: EscalationRepository;
  let attentionService: AttentionService;
  let attentionRepo: AttentionRepository;
  let certRepo: ModelCertificationRepository;

  const TEST_TENANT = 'tenant_m6_test';

  beforeAll(async () => {
    const client = db.getClient();
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    const now = new Date().toISOString();
    await client.execute(
      `INSERT OR IGNORE INTO tenants (id, name, slug, status, plan_tier, channel_plan, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
      [TEST_TENANT, 'Test Org M6', 'test-org-m6', 'active', 'enterprise', 'combined', now, now]
    );

    certRepo = new ModelCertificationRepository(client);
    await certRepo.saveCertification({
      id: 'cert_t2_en_test',
      model_id: 'claude_3_haiku_test',
      model_version: '20240307',
      provider: 'anthropic',
      upstream_provider: 'direct',
      tier: 'T2',
      language: 'en',
      eval_suite_version: 'v1.0.0',
      status: 'certified',
      pass_rate: 0.95,
      latency_p95_ms: 600,
      cost_per_task_usd: 0.0008,
      stage_results_json: '{}',
      certified_at: now,
      expires_at: null,
      certified_by: 'system_harness',
    });

    await certRepo.saveCertification({
      id: 'cert_t3_en_test',
      model_id: 'claude_3_5_sonnet_test',
      model_version: '20241022',
      provider: 'anthropic',
      upstream_provider: 'direct',
      tier: 'T3',
      language: 'en',
      eval_suite_version: 'v1.0.0',
      status: 'certified',
      pass_rate: 0.98,
      latency_p95_ms: 1200,
      cost_per_task_usd: 0.003,
      stage_results_json: '{}',
      certified_at: now,
      expires_at: null,
      certified_by: 'system_harness',
    });
  });

  beforeEach(async () => {
    const client = db.getClient();
    escalationRepo = new EscalationRepository(client);
    attentionRepo = new AttentionRepository(client);
    attentionService = new AttentionService(attentionRepo);
    certRepo = new ModelCertificationRepository(client);
    supervisorService = new SupervisorRemediationService(certRepo);
    orchestratorEngine = new OrchestratorReassessmentEngine(attentionService);
    escalationChain = new FailureEscalationChain(
      escalationRepo,
      supervisorService,
      orchestratorEngine
    );

    // Clean up test data
    await client.execute('DELETE FROM escalation_traces WHERE tenant_id = ?', [TEST_TENANT]);
    await client.execute('DELETE FROM failure_records WHERE tenant_id = ?', [TEST_TENANT]);
    await client.execute('DELETE FROM attention_items WHERE organization_id = ?', [TEST_TENANT]);
  });

  afterEach(async () => {
    const client = db.getClient();
    await client.execute('DELETE FROM escalation_traces WHERE tenant_id = ?', [TEST_TENANT]);
    await client.execute('DELETE FROM failure_records WHERE tenant_id = ?', [TEST_TENANT]);
    await client.execute('DELETE FROM attention_items WHERE organization_id = ?', [TEST_TENANT]);
  });

  // Acceptance Criterion 1: Each failure class routes to its correct remediation
  describe('Criterion 1: Failure Class Routing Matrix (§5)', () => {
    it('routes transient failure to retry_with_backoff', async () => {
      const failure: CreateStructuredFailureInput = {
        tenantId: TEST_TENANT,
        taskId: 'task_transient_1',
        correlationId: 'corr_transient_1',
        agentId: 'specialist_alpha',
        agentSlug: 'specialist_alpha',
        stage: 'execution',
        escalationLevel: 'specialist',
        failureClass: 'transient',
        riskTier: 'LOW',
        isIdempotent: true,
        errorMessage: 'Connection reset by peer on webhook',
        inputsHash: 'hash_1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const result = await escalationChain.handleFailure(failure);
      expect(result.remediation.actionTaken).toBe('retry_with_backoff');
      expect(result.finalLevel).toBe('specialist');
      expect(result.resolved).toBe(true);
      expect(result.remediation.remediationNotes).toContain('backoff');
    });

    it('routes bad_input failure to re_request_re_extract', async () => {
      const failure: CreateStructuredFailureInput = {
        tenantId: TEST_TENANT,
        taskId: 'task_bad_input_1',
        correlationId: 'corr_bad_input_1',
        agentId: 'specialist_alpha',
        agentSlug: 'specialist_alpha',
        stage: 'execution',
        escalationLevel: 'specialist',
        failureClass: 'bad_input',
        riskTier: 'LOW',
        isIdempotent: true,
        errorMessage: 'Missing required field: order_id',
        inputsHash: 'hash_2',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const result = await escalationChain.handleFailure(failure);
      expect(result.remediation.actionTaken).toBe('re_request_re_extract');
      expect(result.finalLevel).toBe('specialist');
      expect(result.resolved).toBe(true);
    });

    it('routes tool_failure to fallback_tool_alternate_agent', async () => {
      const failure: CreateStructuredFailureInput = {
        tenantId: TEST_TENANT,
        taskId: 'task_tool_fail_1',
        correlationId: 'corr_tool_fail_1',
        agentId: 'specialist_alpha',
        agentSlug: 'specialist_alpha',
        stage: 'execution',
        escalationLevel: 'specialist',
        failureClass: 'tool_failure',
        riskTier: 'MEDIUM',
        isIdempotent: true,
        errorMessage: 'Stripe API returned 503 Service Unavailable',
        inputsHash: 'hash_3',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const result = await escalationChain.handleFailure(failure);
      expect(result.remediation.actionTaken).toBe('fallback_tool_alternate_agent');
      expect(result.finalLevel).toBe('supervisor');
      expect(result.resolved).toBe(true);
    });

    it('routes model_failure to fallback_certified_model', async () => {
      const failure: CreateStructuredFailureInput = {
        tenantId: TEST_TENANT,
        taskId: 'task_model_fail_1',
        correlationId: 'corr_model_fail_1',
        agentId: 'specialist_alpha',
        agentSlug: 'specialist_alpha',
        stage: 'execution',
        escalationLevel: 'specialist',
        failureClass: 'model_failure',
        riskTier: 'LOW',
        isIdempotent: true,
        errorMessage: 'Model returned malformed JSON schema',
        inputsHash: 'hash_4',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const result = await escalationChain.handleFailure(failure);
      expect(result.remediation.actionTaken).toBe('fallback_certified_model');
      expect(result.finalLevel).toBe('supervisor');
      expect(result.resolved).toBe(true);
    });

    it('routes scope_mismatch to redispatch_specialist', async () => {
      const failure: CreateStructuredFailureInput = {
        tenantId: TEST_TENANT,
        taskId: 'task_scope_1',
        correlationId: 'corr_scope_1',
        agentId: 'specialist_support',
        agentSlug: 'specialist_support',
        stage: 'execution',
        escalationLevel: 'specialist',
        failureClass: 'scope_mismatch',
        riskTier: 'LOW',
        isIdempotent: true,
        errorMessage: 'Customer requested legal contract review, beyond tier support scope',
        inputsHash: 'hash_5',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const result = await escalationChain.handleFailure(failure);
      expect(result.remediation.actionTaken).toBe('redispatch_specialist');
      expect(result.finalLevel).toBe('supervisor');
      expect(result.resolved).toBe(true);
    });
  });

  // Acceptance Criterion 2: Enforced attempt/time/cost ceilings
  describe('Criterion 2: Enforced Ceilings (Attempts, Duration, Cost) (§5)', () => {
    it('escalates to Supervisor when Specialist max attempts ceiling is exceeded', async () => {
      const failure: CreateStructuredFailureInput = {
        tenantId: TEST_TENANT,
        taskId: 'task_ceiling_attempts_1',
        correlationId: 'corr_ceiling_1',
        agentId: 'specialist_alpha',
        agentSlug: 'specialist_alpha',
        stage: 'execution',
        escalationLevel: 'specialist',
        failureClass: 'transient',
        riskTier: 'LOW',
        isIdempotent: true,
        attemptsCount: DEFAULT_BUDGET_CEILINGS.specialist.maxAttempts + 1, // 4 > 3
        errorMessage: 'Connection timeout after 3 retries',
        inputsHash: 'hash_ceil_1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const result = await escalationChain.handleFailure(failure);
      expect(result.finalLevel).toBe('supervisor');
      expect(result.remediation.actionTaken).toBe('fallback_tool_alternate_agent');
    });

    it('escalates to Orchestrator/Attention when Supervisor cost ceiling is exceeded', async () => {
      const failure: CreateStructuredFailureInput = {
        tenantId: TEST_TENANT,
        taskId: 'task_ceiling_cost_1',
        correlationId: 'corr_ceiling_cost_1',
        agentId: 'supervisor_alpha',
        agentSlug: 'supervisor_alpha',
        stage: 'execution',
        escalationLevel: 'supervisor',
        failureClass: 'tool_failure',
        riskTier: 'MEDIUM',
        isIdempotent: true,
        errorMessage: 'Repeated tool failures accumulated high token cost',
        metadata: {
          costUsd: DEFAULT_BUDGET_CEILINGS.supervisor.maxCostUsd + 0.10, // $0.60 > $0.50
        },
        inputsHash: 'hash_ceil_2',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const result = await escalationChain.handleFailure(failure);
      expect(result.finalLevel).toBe('attention');
      expect(result.remediation.actionTaken).toBe('immediate_escalate');
      expect(result.remediation.attentionItemId).toBeDefined();
    });

    it('escalates when duration ceiling is exceeded', async () => {
      const failure: CreateStructuredFailureInput = {
        tenantId: TEST_TENANT,
        taskId: 'task_ceiling_duration_1',
        correlationId: 'corr_ceiling_dur_1',
        agentId: 'supervisor_alpha',
        agentSlug: 'supervisor_alpha',
        stage: 'execution',
        escalationLevel: 'supervisor',
        failureClass: 'transient',
        riskTier: 'LOW',
        isIdempotent: true,
        errorMessage: 'Execution duration exceeded supervisor limit',
        metadata: {
          durationMs: DEFAULT_BUDGET_CEILINGS.supervisor.maxDurationMs + 5000,
        },
        inputsHash: 'hash_ceil_3',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const result = await escalationChain.handleFailure(failure);
      expect(result.finalLevel).toBe('attention');
      expect(result.remediation.actionTaken).toBe('immediate_escalate');
    });
  });

  // Acceptance Criterion 3: CRITICAL failure escalates without any retry
  describe('Criterion 3: CRITICAL Failure Escalation Without Retry (§5, §18.5)', () => {
    it('immediately escalates riskTier CRITICAL failure with 0 retries', async () => {
      const failure: CreateStructuredFailureInput = {
        tenantId: TEST_TENANT,
        taskId: 'task_critical_1',
        correlationId: 'corr_critical_1',
        agentId: 'payment_specialist',
        agentSlug: 'payment_specialist',
        stage: 'execution',
        escalationLevel: 'specialist',
        failureClass: 'transient', // even if transient, CRITICAL risk tier forces immediate escalate
        riskTier: 'CRITICAL',
        isIdempotent: true,
        errorMessage: 'Bank wire authorization timed out for $500,000 transaction',
        inputsHash: 'hash_crit_1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const result = await escalationChain.handleFailure(failure);
      expect(result.remediation.actionTaken).toBe('immediate_escalate');
      expect(result.finalLevel).toBe('attention');
      expect(result.resolved).toBe(false);
      expect(result.remediation.attentionItemId).toBeDefined();

      // Verify created Attention Item in human queue using tenant context
      const item = await TenantContextManager.withTenant(TEST_TENANT, 'default', () =>
        attentionRepo.findById(result.remediation.attentionItemId!)
      );
      expect(item).toBeDefined();
      expect(item?.priority).toBe('P0_CRITICAL');
    });

    it('immediately escalates critical_action failure class with 0 retries', async () => {
      const failure: CreateStructuredFailureInput = {
        tenantId: TEST_TENANT,
        taskId: 'task_critical_action_1',
        correlationId: 'corr_crit_act_1',
        agentId: 'billing_specialist',
        agentSlug: 'billing_specialist',
        stage: 'execution',
        escalationLevel: 'specialist',
        failureClass: 'critical_action',
        riskTier: 'HIGH',
        isIdempotent: true,
        errorMessage: 'Refund transaction reversal gateway failed',
        inputsHash: 'hash_crit_2',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const result = await escalationChain.handleFailure(failure);
      expect(result.remediation.actionTaken).toBe('immediate_escalate');
      expect(result.finalLevel).toBe('attention');
      expect(result.remediation.attentionItemId).toBeDefined();
    });
  });

  // Acceptance Criterion 4: Capability gap routes up or escalates — never retries same tier
  describe('Criterion 4: Capability Gap Handling (§5)', () => {
    it('routes capability gap up to higher certified tier (T3/T4) and never retries same tier', async () => {
      const failure: CreateStructuredFailureInput = {
        tenantId: TEST_TENANT,
        taskId: 'task_cap_gap_1',
        correlationId: 'corr_cap_gap_1',
        agentId: 't2_specialist',
        agentSlug: 't2_specialist',
        stage: 'execution',
        escalationLevel: 'specialist',
        failureClass: 'capability_gap',
        riskTier: 'MEDIUM',
        isIdempotent: true,
        errorMessage: 'Complex architectural mathematical optimization exceeds T2 model parameters',
        metadata: {
          language: 'en',
          currentModelTier: 'T2',
        },
        inputsHash: 'hash_cap_1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const result = await escalationChain.handleFailure(failure);
      expect(result.remediation.actionTaken).toBe('route_up');
      expect(result.remediation.remediatedOutput?.routedUp).toBe(true);
      expect(result.remediation.remediatedOutput?.tier).toBe('T3');
    });

    it('escalates to Attention if already at highest tier (T4) or no higher model available', async () => {
      const failure: CreateStructuredFailureInput = {
        tenantId: TEST_TENANT,
        taskId: 'task_cap_gap_t4',
        correlationId: 'corr_cap_gap_t4',
        agentId: 't4_specialist',
        agentSlug: 't4_specialist',
        stage: 'execution',
        escalationLevel: 'specialist',
        failureClass: 'capability_gap',
        riskTier: 'HIGH',
        isIdempotent: true,
        errorMessage: 'Exceeded reasoning capabilities in uncertified language',
        metadata: {
          language: 'es', // No T3/T4 certified in Spanish in this test
          currentModelTier: 'T4',
        },
        inputsHash: 'hash_cap_2',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const result = await escalationChain.handleFailure(failure);
      expect(result.remediation.actionTaken).toBe('immediate_escalate');
      expect(result.finalLevel).toBe('attention');
      expect(result.remediation.attentionItemId).toBeDefined();
    });
  });

  // Acceptance Criterion 5: Policy block reports and stops — never routes around
  describe('Criterion 5: Policy Block Strict Refusal & Stop (§5, §15)', () => {
    it('stops execution immediately on policy block and logs refusal without routing around', async () => {
      const failure: CreateStructuredFailureInput = {
        tenantId: TEST_TENANT,
        taskId: 'task_policy_1',
        correlationId: 'corr_policy_1',
        agentId: 'data_specialist',
        agentSlug: 'data_specialist',
        stage: 'execution',
        escalationLevel: 'specialist',
        failureClass: 'policy_block',
        riskTier: 'HIGH',
        isIdempotent: true,
        errorMessage: 'PII Exfiltration Policy Violation: SSN disclosure prohibited',
        inputsHash: 'hash_pol_1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const result = await escalationChain.handleFailure(failure);
      expect(result.remediation.actionTaken).toBe('policy_stop');
      expect(result.finalLevel).toBe('specialist');
      expect(result.resolved).toBe(false);
      expect(result.remediation.remediationNotes).toContain('Execution stopped by security/governance policy');

      // Verify the trace recorded it as stopped
      const trace = await escalationRepo.getTraceByTaskId('task_policy_1', TEST_TENANT);
      expect(trace?.status).toBe('stopped_by_policy');
      expect(trace?.steps[trace.steps.length - 1].outcome).toBe('stopped');
    });
  });

  // Acceptance Criterion 6: Non-idempotent actions are never auto-retried
  describe('Criterion 6: Non-Idempotent Safety Rule (§5, §18.5)', () => {
    it('refuses auto-retry for non-idempotent actions and escalates directly to Attention', async () => {
      const failure: CreateStructuredFailureInput = {
        tenantId: TEST_TENANT,
        taskId: 'task_non_idempotent_1',
        correlationId: 'corr_non_idempotent_1',
        agentId: 'payment_webhook_specialist',
        agentSlug: 'payment_webhook_specialist',
        stage: 'execution',
        escalationLevel: 'specialist',
        failureClass: 'transient', // Even transient failure MUST NOT be auto-retried if non-idempotent
        riskTier: 'MEDIUM',
        isIdempotent: false, // NON-IDEMPOTENT
        errorMessage: 'Network timeout during POST /charges/finalize',
        inputsHash: 'hash_non_idem_1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const result = await escalationChain.handleFailure(failure);
      expect(result.remediation.actionTaken).toBe('immediate_escalate');
      expect(result.finalLevel).toBe('attention');
      expect(result.remediation.remediationNotes).toContain('Non-idempotent action failed');
      expect(result.remediation.attentionItemId).toBeDefined();

      const item = await TenantContextManager.withTenant(TEST_TENANT, 'default', () =>
        attentionRepo.findById(result.remediation.attentionItemId!)
      );
      expect(item).toBeDefined();
    });
  });

  // Acceptance Criterion 7: Full chain renders as one single trace
  describe('Criterion 7: Unified Escalation Trace (§5, §18.5)', () => {
    it('maintains a single unified trace record across multi-stage escalation', async () => {
      const taskId = 'task_multi_stage_trace_1';
      const correlationId = 'corr_multi_1';
      const now = new Date().toISOString();

      // Step 1: Specialist transient failure (Attempt 1)
      await escalationChain.handleFailure({
        tenantId: TEST_TENANT,
        taskId,
        correlationId,
        agentId: 'specialist_beta',
        agentSlug: 'specialist_beta',
        stage: 'execution',
        escalationLevel: 'specialist',
        failureClass: 'transient',
        riskTier: 'LOW',
        isIdempotent: true,
        errorMessage: 'Attempt 1 timeout',
        attemptsCount: 1,
        inputsHash: 'hash_trace_1',
        createdAt: now,
        updatedAt: now,
      });

      // Step 2: Specialist transient failure exceeding attempt ceiling (Attempt 4) -> Supervisor
      await escalationChain.handleFailure({
        tenantId: TEST_TENANT,
        taskId,
        correlationId,
        agentId: 'specialist_beta',
        agentSlug: 'specialist_beta',
        stage: 'execution',
        escalationLevel: 'specialist',
        failureClass: 'transient',
        riskTier: 'LOW',
        isIdempotent: true,
        errorMessage: 'Attempt 4 timeout exceeded specialist ceiling',
        attemptsCount: 4,
        inputsHash: 'hash_trace_2',
        createdAt: now,
        updatedAt: now,
      });

      // Step 3: Final critical failure -> Attention
      await escalationChain.handleFailure({
        id: `fail_${Date.now()}_3`,
        tenantId: TEST_TENANT,
        taskId,
        correlationId,
        agentId: 'orchestrator_main',
        agentSlug: 'orchestrator_main',
        stage: 'execution',
        escalationLevel: 'orchestrator',
        failureClass: 'critical_action',
        riskTier: 'CRITICAL',
        isIdempotent: true,
        confidence: 0.2,
        attemptsCount: 1,
        errorMessage: 'Final pipeline critical failure',
        inputsHash: 'hash_trace_3',
        metadata: {},
        createdAt: now,
        updatedAt: now,
      });

      // Retrieve full unified trace
      const trace = await escalationRepo.getTraceByTaskId(taskId, TEST_TENANT);
      expect(trace).toBeDefined();
      expect(trace?.taskId).toBe(taskId);
      expect(trace?.steps.length).toBeGreaterThanOrEqual(4);

      // Verify sequence of steps
      const steps = trace!.steps;
      expect(steps[0].stepNumber).toBe(1);
      expect(steps[0].level).toBe('specialist');
      expect(steps[steps.length - 1].level).toBe('attention');

      // Verify single trace identity
      expect(trace?.status).toBe('escalated_to_attention');
      expect(trace?.attentionItemId).toBeDefined();
    });
  });
});
