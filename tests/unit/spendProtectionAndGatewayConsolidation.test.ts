/**
 * Kriya Omnitask — Spend Protection & Model Gateway Consolidation Tests
 * (docs/kriya WP-1.1b, WP-1.4; S31; Blueprint §18; ADR-005)
 *
 * Verifies:
 * 1. S31: Tenant isolation assertions in ModelGateway and CredentialVault.
 * 2. WP-1.4: Pre-call budget refusal before any adapter/network request is made.
 * 3. WP-1.4: Projected budget exceedance refusal.
 * 4. WP-1.4: 95% spend threshold ladder restriction to critical tasks only.
 * 5. WP-1.4: Post-call budget settlement and CostRepository attribution persistence.
 * 6. WP-1.4: Spend velocity anomaly detection pausing execution and raising human attention.
 * 7. WP-1.1b: ModelResilienceService consolidated execution via ModelGateway with audit logging.
 * 8. Versioned pricing table zero-fabrication guarantees.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteDatabaseClient, db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { TenantRepository } from '../../src/storage/repositories/tenantRepository.js';
import { TenantContextManager } from '../../src/core/context/tenantContext.js';
import { TenantIsolationError } from '../../src/core/errors/errors.js';
import { BrainSupplyRepository } from '../../src/model/brain/repositories/brainSupplyRepository.js';
import { ModelCertificationRepository } from '../../src/model/certification/modelCertificationRepository.js';
import { CredentialVault } from '../../src/tools/vault/credentialVault.js';
import { SpendBudgetAnomalyEngine } from '../../src/model/brain/services/spendBudgetAnomalyEngine.js';
import { CostRepository } from '../../src/cost/repositories/costRepository.js';
import { AttentionService } from '../../src/attention/service/attentionService.js';
import {
  ModelGateway,
  GatewayRefusedError,
  GatewayEscalationError,
  ModelCandidate,
} from '../../src/model/gateway/modelGateway.js';
import { ModelResilienceService } from '../../src/model/resilience/service/modelResilienceService.js';
import { calculateTokenCost, estimateMaxCost, getModelPrice } from '../../src/model/gateway/pricing.js';
import { CapabilityTier } from '../../src/model/certification/certificationTypes.js';
import { LLMProviderAdapter } from '../../src/orchestration/routing/modelRouter.js';
import { config } from '../../src/core/config/config.js';

describe('WP-1.1b & WP-1.4: Spend Protection & Model Gateway Consolidation', () => {
  let client: SQLiteDatabaseClient;
  let tenantId: string;
  let brainRepo: BrainSupplyRepository;
  let certRepo: ModelCertificationRepository;
  let vault: CredentialVault;
  let spendAnomalyEngine: SpendBudgetAnomalyEngine;
  let costRepo: CostRepository;
  let attentionService: AttentionService;

  const certify = async (modelId: string, tier: CapabilityTier, language = 'en') => {
    const now = Date.now();
    await certRepo.saveCertification({
      id: `cert_${modelId}_${tier}_${language}`,
      model_id: modelId,
      model_version: 'v1',
      provider: 'openrouter',
      upstream_provider: 'openrouter',
      tier,
      language,
      eval_suite_version: 'kriya-probes-v2.0.0',
      status: 'certified',
      pass_rate: 1,
      latency_p95_ms: 500,
      cost_per_task_usd: 0.0001,
      stage_results_json: '{}',
      certified_at: new Date(now).toISOString(),
      expires_at: new Date(now + 365 * 24 * 3600 * 1000).toISOString(),
      certified_by: 'kriya_probe_harness',
    });
  };

  const addBrain = async (id: string, modelId: string, extra: { key?: string; assignedAgents?: string[] } = {}) => {
    let slug: string | undefined;
    if (extra.key) {
      slug = `vault_key_${id}`;
      await TenantContextManager.withTenant(tenantId, 'default', () =>
        vault.storeSecret({ serviceSlug: slug!, name: 'BYO Key', secretData: { apiKey: extra.key } })
      );
    }
    const now = new Date().toISOString();
    await brainRepo.saveTenantBrain({
      id,
      tenantId,
      provider: 'openrouter',
      modelId,
      modelVersion: 'v1',
      credentialVaultServiceSlug: slug,
      keyLastFour: '9999',
      status: 'certified',
      healthStatus: 'healthy',
      certifiedTiers: ['T1', 'T2'],
      certifiedLanguages: ['en'],
      assignedAgents: extra.assignedAgents ?? [],
      currentMonthSpendUsd: 0,
      createdAt: now,
      updatedAt: now,
    });
  };

  const createSpyAdapter = (content = 'Autonomous execution response', reportedCost = 0.0002) => {
    const executedCalls: Array<{ model: string; user: string; apiKey?: string }> = [];
    const adapterFor = (candidate: ModelCandidate, apiKey?: string): LLMProviderAdapter => ({
      async execute(model, _system, user) {
        executedCalls.push({ model, user, apiKey });
        return {
          content,
          promptTokens: 100,
          completionTokens: 50,
          costUsd: reportedCost,
        };
      },
    });
    return { executedCalls, adapterFor };
  };

  beforeEach(async () => {
    config.resetForTesting({ APP_MODE: 'staging' } as any);
    client = new SQLiteDatabaseClient(':memory:');
    db.setClientForTesting(client);
    await new SchemaMigrator(client).applyMigrations();

    const tenant = await new TenantRepository(client).create({
      name: 'Spend Protection Corp',
      slug: 'spend-corp',
      plan_tier: 'enterprise',
      channel_plan: 'combined',
    });
    tenantId = tenant.id;

    brainRepo = new BrainSupplyRepository(client);
    certRepo = new ModelCertificationRepository(client);
    vault = new CredentialVault();
    attentionService = new AttentionService();
    spendAnomalyEngine = new SpendBudgetAnomalyEngine(brainRepo, attentionService);
    costRepo = new CostRepository(client);
  });

  afterEach(async () => {
    config.resetForTesting(undefined as any);
    await client.close();
  });

  describe('S31: Tenant Context Isolation Assertions', () => {
    it('throws TenantIsolationError when active TenantContext does not match request tenantId', async () => {
      await certify('deepseek/deepseek-chat', 'T2');
      await addBrain('brain-1', 'deepseek/deepseek-chat');
      const { executedCalls, adapterFor } = createSpyAdapter();

      const gateway = new ModelGateway({ brainRepo, certRepo, vault, spendAnomalyEngine, costRepo, adapterFor });

      // Run inside tenant_other, but request tenantId is our tenantId
      await expect(
        TenantContextManager.withTenant('tenant_other_boundary', 'default', () =>
          gateway.complete({
            tenantId,
            taskId: 'task_s31_mismatch',
            tier: 'T2',
            systemPrompt: 'System',
            userPrompt: 'User',
          })
        )
      ).rejects.toThrow(TenantIsolationError);

      expect(executedCalls.length).toBe(0);
    });

    it('throws TenantIsolationError when accessing vault secret without active matching tenant context', async () => {
      await certify('deepseek/deepseek-chat', 'T2');
      await addBrain('brain-with-key', 'deepseek/deepseek-chat', { key: 'sk-or-real-secret' });
      const { executedCalls, adapterFor } = createSpyAdapter();

      const gateway = new ModelGateway({ brainRepo, certRepo, vault, spendAnomalyEngine, costRepo, adapterFor });

      // Call without TenantContextManager.run (or with mismatched tenant)
      await expect(
        gateway.complete({
          tenantId,
          taskId: 'task_vault_no_ctx',
          tier: 'T2',
          systemPrompt: 'System',
          userPrompt: 'User',
        })
      ).rejects.toThrow(TenantIsolationError);

      expect(executedCalls.length).toBe(0);
    });

    it('succeeds and securely passes decrypted vault apiKey when tenant context matches', async () => {
      await certify('deepseek/deepseek-chat', 'T2');
      await addBrain('brain-valid-key', 'deepseek/deepseek-chat', { key: 'sk-or-secret-12345' });
      const { executedCalls, adapterFor } = createSpyAdapter();

      const gateway = new ModelGateway({ brainRepo, certRepo, vault, spendAnomalyEngine, costRepo, adapterFor });

      const res = await TenantContextManager.withTenant(tenantId, 'default', () =>
        gateway.complete({
          tenantId,
          taskId: 'task_vault_authorized',
          tier: 'T2',
          systemPrompt: 'System',
          userPrompt: 'User',
        })
      );

      expect(res.modelUsed).toBe('deepseek/deepseek-chat');
      expect(executedCalls.length).toBe(1);
      expect(executedCalls[0].apiKey).toBe('sk-or-secret-12345');
    });
  });

  describe('WP-1.4: Pre-call Budget Refusal & Ladder Thresholds', () => {
    it('refuses before making any HTTP request when monthly spend budget is 100% exhausted', async () => {
      await certify('deepseek/deepseek-chat', 'T2');
      await addBrain('b1', 'deepseek/deepseek-chat');
      const { executedCalls, adapterFor } = createSpyAdapter();

      const gateway = new ModelGateway({ brainRepo, certRepo, vault, spendAnomalyEngine, costRepo, adapterFor });

      // Configure tenant budget to $50 and current spend to $50.00 (100% utilized)
      const cfg = await brainRepo.getTenantBrainConfig(tenantId);
      await brainRepo.saveTenantBrainConfig({
        ...cfg,
        monthlyBudgetUsd: 50.0,
        currentMonthSpendUsd: 50.0,
      });

      await expect(
        TenantContextManager.withTenant(tenantId, 'default', () =>
          gateway.complete({
            tenantId,
            taskId: 'task_refused_100',
            tier: 'T2',
            systemPrompt: 'System',
            userPrompt: 'What is the schedule?',
          })
        )
      ).rejects.toThrow(GatewayRefusedError);

      // CRITICAL ACCEPTANCE: Zero network/adapter requests made!
      expect(executedCalls.length).toBe(0);
    });

    it('refuses before request when projected call cost would exceed monthly budget cap', async () => {
      await certify('gpt-4o', 'T2');
      await addBrain('b1', 'gpt-4o');
      const { executedCalls, adapterFor } = createSpyAdapter();

      const gateway = new ModelGateway({ brainRepo, certRepo, vault, spendAnomalyEngine, costRepo, adapterFor });

      // Budget is $50.00, current spend is $49.999. Upper-bound estimate for gpt-4o will exceed $50.00
      const cfg = await brainRepo.getTenantBrainConfig(tenantId);
      await brainRepo.saveTenantBrainConfig({
        ...cfg,
        monthlyBudgetUsd: 50.0,
        currentMonthSpendUsd: 49.999,
      });

      await expect(
        TenantContextManager.withTenant(tenantId, 'default', () =>
          gateway.complete({
            tenantId,
            taskId: 'task_projected_exceed',
            tier: 'T2',
            systemPrompt: 'System',
            userPrompt: 'Perform heavy analysis',
            maxTokens: 2000,
          })
        )
      ).rejects.toThrow(GatewayRefusedError);

      expect(executedCalls.length).toBe(0);
    });

    it('refuses non-critical tasks at 95% spend threshold, but allows critical tasks', async () => {
      await certify('deepseek/deepseek-chat', 'T2');
      await addBrain('b1', 'deepseek/deepseek-chat');
      const { executedCalls, adapterFor } = createSpyAdapter();

      const gateway = new ModelGateway({ brainRepo, certRepo, vault, spendAnomalyEngine, costRepo, adapterFor });

      // Budget $50.00, spend $47.50 (95.0% - ladder tier restrict_95)
      const cfg = await brainRepo.getTenantBrainConfig(tenantId);
      await brainRepo.saveTenantBrainConfig({
        ...cfg,
        monthlyBudgetUsd: 50.0,
        currentMonthSpendUsd: 47.50,
      });

      // 1. Non-critical task is refused
      await expect(
        TenantContextManager.withTenant(tenantId, 'default', () =>
          gateway.complete({
            tenantId,
            taskId: 'task_normal',
            tier: 'T2',
            systemPrompt: 'System',
            userPrompt: 'Non-critical marketing query',
            isCritical: false,
          })
        )
      ).rejects.toThrow(GatewayRefusedError);
      expect(executedCalls.length).toBe(0);

      // 2. Critical task is permitted
      const res = await TenantContextManager.withTenant(tenantId, 'default', () =>
        gateway.complete({
          tenantId,
          taskId: 'task_critical_emergency',
          tier: 'T2',
          systemPrompt: 'System',
          userPrompt: 'P0 emergency surgery dispatch',
          isCritical: true,
        })
      );

      expect(res.content).toBeDefined();
      expect(executedCalls.length).toBe(1);
    });
  });

  describe('WP-1.4: Post-call Settlement & Cost Repository Ingestion', () => {
    it('settles cost increment in brain config and persists attribution record in CostRepository', async () => {
      await certify('deepseek/deepseek-chat', 'T2');
      await addBrain('b1', 'deepseek/deepseek-chat');
      const callCost = 0.0015;
      const { executedCalls, adapterFor } = createSpyAdapter('Done', callCost);

      const gateway = new ModelGateway({ brainRepo, certRepo, vault, spendAnomalyEngine, costRepo, adapterFor });

      const cfgBefore = await brainRepo.getTenantBrainConfig(tenantId);
      expect(cfgBefore.currentMonthSpendUsd).toBe(0);

      await TenantContextManager.withTenant(tenantId, 'org_acme', () =>
        gateway.complete({
          tenantId,
          taskId: 'task_settle_cost_1',
          tier: 'T2',
          agentSlug: 'scheduler',
          systemPrompt: 'System',
          userPrompt: 'Book slot',
        })
      );

      expect(executedCalls.length).toBe(1);

      // Verify brain config updated
      const cfgAfter = await brainRepo.getTenantBrainConfig(tenantId);
      expect(cfgAfter.currentMonthSpendUsd).toBeCloseTo(callCost, 5);
      expect(cfgAfter.currentDaySpendUsd).toBeCloseTo(callCost, 5);

      // Verify cost attribution record in CostRepository
      const records = await costRepo.listCostRecords(tenantId);
      expect(records.length).toBe(1);
      expect(records[0].taskId).toBe('task_settle_cost_1');
      expect(records[0].agentId).toBe('scheduler');
      expect(records[0].costCategory).toBe('token_llm');
      expect(records[0].totalCostUsd).toBeCloseTo(callCost, 5);
      expect(records[0].resourceQuantity).toBe(150); // 100 prompt + 50 completion
    });

    it('detects velocity anomaly when daily spend exceeds 3x multiplier, pausing execution and escalating to human', async () => {
      await certify('deepseek/deepseek-chat', 'T2');
      await addBrain('b1', 'deepseek/deepseek-chat');

      // Daily budget $10, multiplier 3x -> anomaly threshold $30
      const cfg = await brainRepo.getTenantBrainConfig(tenantId);
      await brainRepo.saveTenantBrainConfig({
        ...cfg,
        monthlyBudgetUsd: 200.0,
        dailyBudgetUsd: 10.0,
        currentDaySpendUsd: 29.5, // Almost at 30
      });

      // Call costs $2.0, pushing day spend to $31.5 > $30
      const { adapterFor } = createSpyAdapter('Done', 2.0);
      const gateway = new ModelGateway({ brainRepo, certRepo, vault, spendAnomalyEngine, costRepo, adapterFor });

      await TenantContextManager.withTenant(tenantId, 'default', () =>
        gateway.complete({
          tenantId,
          taskId: 'task_anomaly_spike',
          tier: 'T2',
          systemPrompt: 'System',
          userPrompt: 'Spike prompt',
        })
      );

      // Config must now be paused_anomaly
      const cfgAfter = await brainRepo.getTenantBrainConfig(tenantId);
      expect(cfgAfter.status).toBe('paused_anomaly');

      // Subsequent call must be refused immediately
      await expect(
        TenantContextManager.withTenant(tenantId, 'default', () =>
          gateway.complete({
            tenantId,
            taskId: 'task_blocked_by_anomaly',
            tier: 'T2',
            systemPrompt: 'System',
            userPrompt: 'Next prompt',
          })
        )
      ).rejects.toThrow(GatewayRefusedError);
    });
  });

  describe('WP-1.1b: Consolidated ModelResilienceService', () => {
    it('executes through ModelGateway, logs routing decisions, and honors capability tier mapping', async () => {
      await certify('deepseek/deepseek-chat', 'T1');
      await certify('deepseek/deepseek-chat', 'T2');
      await addBrain('b-resil', 'deepseek/deepseek-chat');
      const { adapterFor } = createSpyAdapter('Classified result', 0.0003);

      const gateway = new ModelGateway({ brainRepo, certRepo, vault, spendAnomalyEngine, costRepo, adapterFor });
      const resilienceService = new ModelResilienceService(undefined, gateway);

      const res = await TenantContextManager.withTenant(tenantId, 'default', () =>
        resilienceService.executeWithResilience({
          taskId: 'task_resilience_consolidated',
          taskType: 'fast_classification',
          prompt: 'Is this urgent?',
          dataClassification: 'internal',
        })
      );

      expect(res.taskId).toBe('task_resilience_consolidated');
      expect(res.modelIdentifier).toBe('deepseek/deepseek-chat');
      expect(res.provider).toBe('deepseek');
      expect(res.outputContent).toBe('Classified result');
      expect(res.totalCostUsd).toBeCloseTo(0.0003, 5);

      // Verify routing decision was persisted in audit log
      const decisions = await TenantContextManager.withTenant(tenantId, 'default', () =>
        resilienceService.listRoutingDecisions()
      );
      expect(decisions.length).toBeGreaterThanOrEqual(1);
      const matched = decisions.find((d) => d.taskId === 'task_resilience_consolidated');
      expect(matched).toBeDefined();
      expect(matched?.selectedModelId).toBe('deepseek/deepseek-chat');
      expect(matched?.decisionRationale).toContain('Consolidated ModelGateway routing');
    });

    it('supports mock failure drills in sandbox mode through gateway candidate failover', async () => {
      config.resetForTesting({ APP_MODE: 'sandbox' } as any);
      await certify('model-primary', 'T2');
      await certify('model-backup', 'T2');
      await addBrain('b-prim', 'model-primary');
      await addBrain('b-back', 'model-backup');

      const resilienceService = new ModelResilienceService();

      // In sandbox mode with mockFailures targeting model-primary, it must failover to model-backup
      const res = await TenantContextManager.withTenant(tenantId, 'default', () =>
        resilienceService.executeWithResilience(
          {
            taskId: 'task_drill_failover',
            taskType: 'standard_reasoning',
            prompt: 'Test failover',
            dataClassification: 'internal',
          },
          { mockFailures: ['model-primary'] }
        )
      );

      expect(res.taskId).toBe('task_drill_failover');
      expect(res.outputContent).toBeDefined();
    });
  });

  describe('Versioned Pricing Table & Zero-Fabrication', () => {
    it('calculates deterministic costs for known models in the versioned pricing table', () => {
      const known = getModelPrice('gemini-2.5-flash');
      expect(known).toBeDefined();
      expect(known?.promptPer1M).toBe(0.15);
      expect(known?.completionPer1M).toBe(0.60);

      // 1M prompt + 1M completion = $0.75
      const cost = calculateTokenCost('gemini-2.5-flash', 1_000_000, 1_000_000);
      expect(cost.costUsd).toBe(0.75);
      expect(cost.costSource).toBe('price_table');
    });

    it('returns null and costSource unknown for unknown models per Zero-Fabrication rule', () => {
      const unknown = calculateTokenCost('unknown-vendor/untracked-model-9000', 500, 200);
      expect(unknown.costUsd).toBeNull();
      expect(unknown.costSource).toBe('unknown');
    });

    it('provides conservative upper bound estimate for pre-call budget reservation', () => {
      const estKnown = estimateMaxCost('deepseek/deepseek-chat', 1000, 1000);
      expect(estKnown).toBeGreaterThan(0);

      const estUnknown = estimateMaxCost('some-future-model', 1000, 1000);
      expect(estUnknown).toBe(0.005); // Safe baseline check
    });
  });
});
