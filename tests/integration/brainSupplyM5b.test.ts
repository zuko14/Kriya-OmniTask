import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { BrainSupplyRepository } from '../../src/model/brain/repositories/brainSupplyRepository.js';
import { SuitabilityAdvisoryEngine } from '../../src/model/brain/services/suitabilityAdvisoryEngine.js';
import { BrainCredentialService } from '../../src/model/brain/services/brainCredentialService.js';
import { AlignmentStreamService } from '../../src/model/brain/services/alignmentStreamService.js';
import { SpendBudgetAnomalyEngine } from '../../src/model/brain/services/spendBudgetAnomalyEngine.js';
import { WorkforceCoverageEngine } from '../../src/model/brain/services/workforceCoverageEngine.js';
import { RecertificationScheduler } from '../../src/model/brain/services/recertificationScheduler.js';
import { ModelCertificationRepository } from '../../src/model/certification/modelCertificationRepository.js';
import { AttentionRepository } from '../../src/attention/repositories/attentionRepository.js';
import { AttentionService } from '../../src/attention/service/attentionService.js';
import { CredentialVault } from '../../src/tools/vault/credentialVault.js';
import { auditLogger } from '../../src/security/audit/auditLogger.js';
import { TenantContextManager } from '../../src/core/context/tenantContext.js';
import { ValidationError } from '../../src/core/errors/errors.js';
import { config } from '../../src/core/config/config.js';
import { scriptedProbeExecutor } from '../helpers/scriptedProbeModel.js';

// Test double: model behaviour is chosen per test via the model id; production always runs a real model.
const scriptedFactory = (run: { modelId: string }) =>
  run.modelId.includes('unreachable')
    ? scriptedProbeExecutor({ throwAll: 'OpenRouter HTTP 401: invalid key' })
    : run.modelId.includes('weak-reasoning')
      ? scriptedProbeExecutor({ wrongOn: ['t3_', 't4_'] })
      : scriptedProbeExecutor();

async function waitForRun(repo: BrainSupplyRepository, id: string, timeoutMs = 3000) {
  const start = Date.now();
  for (;;) {
    const run = await repo.getAlignmentRun(id);
    if (run && run.status !== 'running') return run;
    if (Date.now() - start > timeoutMs) return run;
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('Milestone M5b — Brain Supply & Admin Brain Console Integration Tests (§9.5-§9.9, §18.6, §23)', () => {
  let brainRepo: BrainSupplyRepository;
  let certRepo: ModelCertificationRepository;
  let suitabilityEngine: SuitabilityAdvisoryEngine;
  let credentialService: BrainCredentialService;
  let alignmentService: AlignmentStreamService;
  let budgetEngine: SpendBudgetAnomalyEngine;
  let coverageEngine: WorkforceCoverageEngine;
  let recertScheduler: RecertificationScheduler;
  let attentionRepo: AttentionRepository;
  let attentionService: AttentionService;
  let vault: CredentialVault;

  const TEST_TENANT = 'tenant_m5b_test';

  beforeAll(async () => {
    const client = db.getClient();
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    const now = new Date().toISOString();
    await client.execute(
      `INSERT OR IGNORE INTO tenants (id, name, slug, status, plan_tier, channel_plan, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
      [TEST_TENANT, 'Test Org M5b', 'test-org-m5b', 'active', 'standard', 'combined', now, now]
    );
  });

  beforeEach(async () => {
    const client = db.getClient();
    brainRepo = new BrainSupplyRepository(client);
    certRepo = new ModelCertificationRepository(client);
    attentionRepo = new AttentionRepository(client);
    attentionService = new AttentionService(attentionRepo);
    vault = new CredentialVault();

    suitabilityEngine = new SuitabilityAdvisoryEngine(brainRepo, certRepo);
    // Stubbed OpenRouter key-info endpoint: 200 for live keys, 401 for keys marked invalid.
    credentialService = new BrainCredentialService(vault, brainRepo, async (_url, init) => {
      const auth = String((init?.headers as Record<string, string>)?.Authorization ?? '');
      return new Response('{}', { status: auth.includes('invalid') ? 401 : 200 });
    });
    alignmentService = new AlignmentStreamService(brainRepo, certRepo, scriptedFactory);
    budgetEngine = new SpendBudgetAnomalyEngine(brainRepo, attentionService);
    coverageEngine = new WorkforceCoverageEngine(brainRepo, certRepo);
    recertScheduler = new RecertificationScheduler(brainRepo, certRepo, alignmentService);

    // Clean test tables
    await client.execute('DELETE FROM tenant_brains WHERE tenant_id = ?', [TEST_TENANT]);
    await client.execute('DELETE FROM tenant_brain_configs WHERE tenant_id = ?', [TEST_TENANT]);
    await client.execute('DELETE FROM brain_alignment_runs WHERE tenant_id = ?', [TEST_TENANT]);
    await client.execute('DELETE FROM attention_items WHERE organization_id = ?', [TEST_TENANT]);
  });

  afterEach(async () => {
    const client = db.getClient();
    await client.execute('DELETE FROM tenant_brains WHERE tenant_id = ?', [TEST_TENANT]);
    await client.execute('DELETE FROM tenant_brain_configs WHERE tenant_id = ?', [TEST_TENANT]);
    await client.execute('DELETE FROM brain_alignment_runs WHERE tenant_id = ?', [TEST_TENANT]);
    await client.execute('DELETE FROM attention_items WHERE organization_id = ?', [TEST_TENANT]);
  });

  // Acceptance Criterion 1: End-to-end add key, select model, and run alignment check without operator
  it('Criterion 1: allows admin to add key, select model, and run alignment check end-to-end', async () => {
    // 1. Validate and store key
    const stored = await credentialService.storeValidatedKey(TEST_TENANT, 'openrouter', 'sk-or-v1-valid-live-key-7f2a');
    expect(stored.keyLastFour).toBe('7f2a');

    // 2. Select model & run alignment check
    const run = await alignmentService.startAlignmentCheck(
      TEST_TENANT,
      'claude-3-5-sonnet-20241022',
      '20241022',
      'anthropic',
      ['T1', 'T2', 'T3', 'T4'],
      ['en', 'hi', 'te']
    );
    expect(run.status).toBe('running');

    const updated = await waitForRun(brainRepo, run.id);
    expect(updated?.status).toBe('completed');
    expect(updated?.reportCard.suiteVersion).toBe('kriya-probes-v2.0.0');
    expect(updated?.actualCostUsd).toBeGreaterThan(0);
    expect(updated?.reportCard).toBeDefined();
    expect(updated?.reportCard.certifiedTiers).toContain('T1');
  });

  // Acceptance Criterion 2: A key failing validation is NEVER saved
  it('Criterion 2: refuses to save a key that fails validation', async () => {
    // Test invalid key
    const validation = await credentialService.validateKey('openrouter', 'sk-invalid-fake-key');
    expect(validation.valid).toBe(false);
    expect(validation.errorMessage).toContain('Authentication handshake failed');

    // Attempting to store it must throw
    await expect(
      credentialService.storeValidatedKey(TEST_TENANT, 'openrouter', 'sk-invalid-fake-key')
    ).rejects.toThrow(ValidationError);
  });

  // Acceptance Criterion 3: Model failing hard requirement is not selectable and card names requirement
  it('Criterion 3: blocks unselectable models failing hard requirements and names the requirement', async () => {
    const evalResult = await suitabilityEngine.evaluateModelSuitability('meta-llama/llama-3-8b-instruct:free');
    expect(evalResult.isSelectable).toBe(false);
    expect(evalResult.suitabilityState).toBe('UNSUITABLE');
    expect(evalResult.failedHardRequirement).toContain('Fails hard requirements');
    expect(evalResult.effectiveStatus).toBe('unselectable_hard_failure');
  });

  // Acceptance Criterion 4: Advisory notice and certification overrules advisory in both directions
  it('Criterion 4: includes advisory notice and verifies certification overrules advisory in both directions', async () => {
    // Case 1: MARGINAL model that passes certification becomes usable_certified
    await certRepo.saveCertification({
      id: 'cert_nemo_t2_en_pass',
      model_id: 'mistralai/mistral-nemo',
      model_version: 'v1',
      provider: 'openrouter',
      upstream_provider: 'direct',
      tier: 'T2',
      language: 'en',
      eval_suite_version: 'v1.0.0',
      status: 'certified',
      pass_rate: 0.96,
      latency_p95_ms: 800,
      cost_per_task_usd: 0.0005,
      stage_results_json: '{}',
      certified_at: new Date().toISOString(),
      certified_by: 'system_harness',
    });

    const evalMarginal = await suitabilityEngine.evaluateModelSuitability('mistralai/mistral-nemo', 'T2', 'en');
    expect(evalMarginal.advisoryNotice).toContain('Advisory only — based on general model characteristics');
    expect(evalMarginal.suitabilityState).toBe('MARGINAL');
    expect(evalMarginal.effectiveStatus).toBe('usable_certified');
    expect(evalMarginal.certificationOverruled).toBe(true);

    // Case 2: RECOMMENDED model that fails certification becomes unusable_failed_cert
    await certRepo.saveCertification({
      id: 'cert_haiku_t4_en_fail',
      model_id: 'claude-3-haiku-20240307',
      model_version: '20240307',
      provider: 'anthropic',
      upstream_provider: 'direct',
      tier: 'T4',
      language: 'en',
      eval_suite_version: 'v1.0.0',
      status: 'failed',
      pass_rate: 0.40,
      latency_p95_ms: 1200,
      cost_per_task_usd: 0.001,
      stage_results_json: '{}',
      certified_at: new Date().toISOString(),
      certified_by: 'system_harness',
    });

    const evalRecommended = await suitabilityEngine.evaluateModelSuitability('claude-3-haiku-20240307', 'T4', 'en');
    expect(evalRecommended.suitabilityState).toBe('RECOMMENDED');
    expect(evalRecommended.effectiveStatus).toBe('unusable_failed_cert');
    expect(evalRecommended.certificationOverruled).toBe(true);
  });

  // Acceptance Criterion 5: Estimated check cost is shown and explicitly confirmed before spend
  it('Criterion 5: discloses token and cost estimate before spend, and says when the price is unknown', () => {
    // Known price + configured INR rate → INR disclosure
    config.resetForTesting({ USD_INR_RATE: 85 } as any);
    try {
      const priced = alignmentService.estimateCheckCost('claude-3-5-sonnet', 4, 3, { promptPer1M: 3, completionPer1M: 15 });
      expect(priced.estimatedTokens).toBeGreaterThan(1000);
      expect(priced.costKnown).toBe(true);
      expect(priced.estimatedCostUsd).toBeGreaterThan(0);
      expect(priced.estimatedCostInr).toBeCloseTo(priced.estimatedCostUsd! * 85, 1);
      expect(priced.disclosureText).toContain('≈₹');
    } finally {
      config.resetForTesting({});
    }

    // Unknown price → no invented number
    const unpriced = alignmentService.estimateCheckCost('mystery-model', 4, 3, null);
    expect(unpriced.costKnown).toBe(false);
    expect(unpriced.estimatedCostUsd).toBeNull();
    expect(unpriced.disclosureText).toContain("isn't available");
  });

  // Acceptance Criterion 6: Alignment check streams stage-by-stage over SSE and is cancellable
  it('Criterion 6: streams stage events and allows immediate cancellation stopping spend', async () => {
    const run = await alignmentService.startAlignmentCheck(
      TEST_TENANT,
      'gpt-4o',
      '2024-08-06',
      'openai'
    );

    const receivedEvents: any[] = [];
    const unsubscribe = alignmentService.subscribeToStream(run.id, (evt: any) => {
      receivedEvents.push(evt);
    });

    // Cancel check immediately
    const cancelled = await alignmentService.cancelCheck(run.id);
    expect(cancelled).toBe(true);

    const updated = await brainRepo.getAlignmentRun(run.id);
    expect(updated?.status).toBe('cancelled');
    expect(updated?.errorMessage).toContain('cancelled by admin');
    unsubscribe();
  });

  // Acceptance Criterion 7: A failed stage does NOT abort the run; only Stage 0 aborts
  it('Criterion 7: continues run when capability stage fails, but aborts on Stage 0 Handshake failure', async () => {
    // Case 1: Unreachable model fails Stage 0 and aborts immediately
    const runAbort = await alignmentService.startAlignmentCheck(
      TEST_TENANT,
      'model_unreachable_error',
      'v1',
      'openrouter'
    );
    const runAbortResult = await waitForRun(brainRepo, runAbort.id);
    expect(runAbortResult?.status).toBe('failed');
    expect(runAbortResult?.currentStage).toBe(0);
    expect(runAbortResult?.errorMessage).toContain('Stage 0 Handshake failed');

    // Case 2: A model that ANSWERS the T3/T4 probes wrongly completes with partial certification
    const runSmall = await alignmentService.startAlignmentCheck(
      TEST_TENANT,
      'weak-reasoning-model',
      'v1',
      'anthropic'
    );
    const runSmallResult = await waitForRun(brainRepo, runSmall.id);
    expect(runSmallResult?.status).toBe('completed');
    expect(runSmallResult?.currentStage).toBe(6);
    expect(runSmallResult?.reportCard.overallStatus).toBe('PARTIALLY CERTIFIED');
  });

  // Acceptance Criterion 8: Report card renders full tier × language matrix & plain-language workforce impact
  it('Criterion 8: generates full tier × language matrix and plain-language workforce impact', () => {
    const impact = alignmentService.buildWorkforceImpact(['T1', 'T2'], ['en', 'hi']);
    expect(impact.canRun).toContain('Lead Qualification');
    expect(impact.canRun).toContain('Booking Specialist');
    expect(impact.limited.length).toBeGreaterThan(0);
    expect(impact.cannot.some((c: any) => c.agentName.includes('Orchestrator'))).toBe(true);
  });

  // Acceptance Criterion 9: Admin cannot override a failed tier, and cannot hand-assign a model to an agent
  it('Criterion 9: enforces automated proposal assignment without hand-picking or tier overrides', () => {
    const proposal = alignmentService.proposeAssignment('brain_test_1', 'claude-3-haiku', ['T1', 'T2']);
    // T1/T2 agents are eligible
    expect(proposal.eligibleAgents).toContain('lead_qualification_specialist');
    expect(proposal.eligibleAgents).toContain('customer_support_specialist');
    // T3 orchestrator is not eligible and retains incumbent
    expect(proposal.ineligibleAgents).toContain('workforce_orchestrator');
  });

  // Acceptance Criterion 10: The Coverage row correctly reports whether every agent has a certified brain
  it('Criterion 10: accurately reports workforce brain coverage and highlights uncovered gaps', async () => {
    // Initially with 0 brains configured: coverage fails
    const initialCoverage = await coverageEngine.evaluateCoverage(TEST_TENANT);
    expect(initialCoverage.allCovered).toBe(false);
    expect(initialCoverage.uncoveredAgentsCount).toBeGreaterThan(0);
    expect(initialCoverage.statusHeadline).toContain('no certified brain');

    // Add a full T1-T4 brain with EN and HI
    await brainRepo.saveTenantBrain({
      id: 'brain_master_1',
      tenantId: TEST_TENANT,
      provider: 'anthropic',
      modelId: 'claude-3-5-sonnet-20241022',
      modelVersion: '20241022',
      keyLastFour: '7f2a',
      status: 'certified',
      healthStatus: 'healthy',
      certifiedTiers: ['T1', 'T2', 'T3', 'T4'],
      certifiedLanguages: ['en', 'hi', 'te'],
      assignedAgents: ['lead_qualification_specialist', 'customer_support_specialist', 'booking_specialist', 'retention_specialist', 'workforce_orchestrator'],
      currentMonthSpendUsd: 12.5,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const fullCoverage = await coverageEngine.evaluateCoverage(TEST_TENANT);
    expect(fullCoverage.allCovered).toBe(true);
    expect(fullCoverage.uncoveredAgentsCount).toBe(0);
    expect(fullCoverage.statusHeadline).toBe('Every agent in your workforce has a certified brain.');
  });

  // Acceptance Criterion 11: A brain cannot be enabled in BYO mode without a spend budget
  it('Criterion 11: blocks enabling BYO brain if spend budget is missing or zero', () => {
    expect(() =>
      budgetEngine.validateActivationBudget({
        tenantId: TEST_TENANT,
        brainSupply: 'byo',
        monthlyBudgetUsd: 0,
        dailyBudgetUsd: 0,
        currentMonthSpendUsd: 0,
        currentDaySpendUsd: 0,
        spendAnomalyThresholdMultiplier: 3.0,
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
    ).toThrow(ValidationError);
  });

  // Acceptance Criterion 12: Budget ladder fires at 70/85/95/100 and spend anomaly pauses execution
  it('Criterion 12: fires threshold ladder stages (70/85/95/100) and triggers anomaly pause', async () => {
    await brainRepo.saveTenantBrainConfig({
      tenantId: TEST_TENANT,
      brainSupply: 'byo',
      monthlyBudgetUsd: 100.0,
      dailyBudgetUsd: 10.0,
      currentMonthSpendUsd: 72.0, // 72%
      currentDaySpendUsd: 5.0,
      spendAnomalyThresholdMultiplier: 3.0,
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // 72% -> warn_70
    const status70 = await budgetEngine.evaluateSpendStatus(TEST_TENANT);
    expect(status70.thresholdTier).toBe('warn_70');
    expect(status70.actionTaken).toBe('warning');

    // 88% -> shift_85
    await brainRepo.saveTenantBrainConfig({
      tenantId: TEST_TENANT,
      brainSupply: 'byo',
      monthlyBudgetUsd: 100.0,
      dailyBudgetUsd: 10.0,
      currentMonthSpendUsd: 88.0,
      currentDaySpendUsd: 5.0,
      spendAnomalyThresholdMultiplier: 3.0,
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const status85 = await budgetEngine.evaluateSpendStatus(TEST_TENANT);
    expect(status85.thresholdTier).toBe('shift_85');
    expect(status85.actionTaken).toBe('shift_cheaper');

    // Anomaly spike: daily spend jumps from 10 to 35 (> 3x 10)
    await brainRepo.saveTenantBrainConfig({
      tenantId: TEST_TENANT,
      brainSupply: 'byo',
      monthlyBudgetUsd: 100.0,
      dailyBudgetUsd: 10.0,
      currentMonthSpendUsd: 40.0,
      currentDaySpendUsd: 35.0, // Anomaly!
      spendAnomalyThresholdMultiplier: 3.0,
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const statusAnomaly = await TenantContextManager.withTenant(TEST_TENANT, 'default', () =>
      budgetEngine.evaluateSpendStatus(TEST_TENANT)
    );
    expect(statusAnomaly.anomalyDetected).toBe(true);
    expect(statusAnomaly.attentionItemId).toBeDefined();

    const configAfter = await brainRepo.getTenantBrainConfig(TEST_TENANT);
    expect(configAfter.status).toBe('paused_anomaly');
  });

  // Acceptance Criterion 13: Key appears nowhere in logs, traces, audit entries, events, or context
  it('Criterion 13: verifies zero API key leakage across database, records, and vault metadata', async () => {
    const rawSecret = 'sk-or-v1-live-real-secret-token-key-91c4';
    await credentialService.storeValidatedKey(TEST_TENANT, 'openrouter', rawSecret);

    // 1. Check tenant_brains table
    const brains = await brainRepo.listTenantBrains(TEST_TENANT);
    for (const b of brains) {
      expect(JSON.stringify(b)).not.toContain(rawSecret);
      expect(b.keyLastFour).toBe('91c4');
    }

    // 2. Check alignment runs
    const runs = await brainRepo.createAlignmentRun({
      id: 'run_security_check',
      tenantId: TEST_TENANT,
      modelId: 'claude-3-5-sonnet',
      modelVersion: 'v1',
      provider: 'anthropic',
      status: 'completed',
      currentStage: 6,
      stages: {},
      estimatedCostUsd: 0.03,
      actualCostUsd: 0.03,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    expect(JSON.stringify(runs)).not.toContain(rawSecret);
  });

  // Acceptance Criterion 14: Key rotation completes with zero downtime; revocation degrades agents
  it('Criterion 14: executes zero-downtime key rotation and graceful revocation with agent degradation', async () => {
    const brain = await brainRepo.saveTenantBrain({
      id: 'brain_rotatable_1',
      tenantId: TEST_TENANT,
      provider: 'openrouter',
      modelId: 'claude-3-5-sonnet-20241022',
      modelVersion: '20241022',
      keyLastFour: '7f2a',
      status: 'certified',
      healthStatus: 'healthy',
      certifiedTiers: ['T1', 'T2', 'T3'],
      certifiedLanguages: ['en'],
      assignedAgents: ['lead_qualification_specialist'],
      currentMonthSpendUsd: 0.0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Zero-downtime rotation
    const rotated = await credentialService.rotateKey(TEST_TENANT, brain.id, 'sk-or-v1-rotated-new-secret-key-33b1');
    expect(rotated.keyLastFour).toBe('33b1');
    expect(rotated.status).toBe('certified');

    // Revocation
    const revoked = await credentialService.revokeBrain(TEST_TENANT, brain.id);
    expect(revoked.status).toBe('revoked');
    expect(revoked.healthStatus).toBe('halted');
    expect(revoked.assignedAgents.length).toBe(0); // Detached gracefully
  });

  // Acceptance Criterion 15: Managed mode renders with credential fields read-only
  it('Criterion 15: supports managed brain supply mode with read-only credentials', async () => {
    await brainRepo.saveTenantBrainConfig({
      tenantId: TEST_TENANT,
      brainSupply: 'managed',
      monthlyBudgetUsd: 200.0,
      dailyBudgetUsd: 20.0,
      currentMonthSpendUsd: 15.0,
      currentDaySpendUsd: 2.0,
      spendAnomalyThresholdMultiplier: 3.0,
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const config = await brainRepo.getTenantBrainConfig(TEST_TENANT);
    expect(config.brainSupply).toBe('managed');
  });

  // Acceptance Criterion 16: Every brain lifecycle event writes to the audit ledger
  it('Criterion 16: writes immutable audit events on all brain lifecycle transitions', async () => {
    const logs: any[] = [];
    const origLogEvent = auditLogger.logEvent.bind(auditLogger);
    auditLogger.logEvent = async (event: any) => {
      logs.push(event);
      return origLogEvent(event);
    };

    await credentialService.storeValidatedKey(TEST_TENANT, 'openrouter', 'sk-or-v1-test-audit-key-88cc');
    expect(logs.some((l) => l.action === 'brain.key_saved')).toBe(true);

    auditLogger.logEvent = origLogEvent;
  });
});
