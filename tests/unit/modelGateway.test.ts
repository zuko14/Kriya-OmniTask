/**
 * Kriya Omnitask — Model Gateway tests (docs/kriya WP-1.1, WP-1.3)
 * Selection must only ever use certified, unexpired, policy-allowed models; structured output gets
 * exactly one repair; and a live test runs a real agent end-to-end through orchestrator → gateway → OpenRouter.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { config } from '../../src/core/config/config.js';
import { db, SQLiteDatabaseClient } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { TenantContextManager } from '../../src/core/context/tenantContext.js';
import { TenantRepository } from '../../src/storage/repositories/tenantRepository.js';
import { BrainSupplyRepository } from '../../src/model/brain/repositories/brainSupplyRepository.js';
import { ModelCertificationRepository } from '../../src/model/certification/modelCertificationRepository.js';
import { CredentialVault } from '../../src/tools/vault/credentialVault.js';
import {
  ModelGateway,
  ModelCandidate,
  GatewayEscalationError,
  GatewayRefusedError,
  StructuredOutputError,
} from '../../src/model/gateway/modelGateway.js';
import { LLMProviderAdapter } from '../../src/orchestration/routing/modelRouter.js';
import { OpenRouterAdapter } from '../../src/model/gateway/openRouterAdapter.js';
import { HierarchicalOrchestrator } from '../../src/orchestration/orchestrator/hierarchicalOrchestrator.js';
import { AgentRegistryService } from '../../src/agents/registry/agentRegistry.js';
import { CapabilityTier } from '../../src/model/certification/certificationTypes.js';

const setMode = (APP_MODE?: string) => config.resetForTesting({ APP_MODE } as any);

describe('Model Gateway', () => {
  let client: SQLiteDatabaseClient;
  let tenantId: string;
  let brainRepo: BrainSupplyRepository;
  let certRepo: ModelCertificationRepository;
  let vault: CredentialVault;

  const certify = async (modelId: string, tier: CapabilityTier, language: string, opts: { expired?: boolean; status?: 'certified' | 'failed' } = {}) => {
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
      status: opts.status ?? 'certified',
      pass_rate: 1,
      latency_p95_ms: 1000,
      cost_per_task_usd: 0.0001,
      stage_results_json: '{}',
      certified_at: new Date(now).toISOString(),
      expires_at: new Date(now + (opts.expired ? -1 : 1) * 24 * 3600 * 1000).toISOString(),
      certified_by: 'kriya_probe_harness',
    });
  };

  const addBrain = async (id: string, modelId: string, extra: { assignedAgents?: string[]; key?: string } = {}) => {
    let slug: string | undefined;
    if (extra.key) {
      slug = `brain_key_${id}`;
      await TenantContextManager.withTenant(tenantId, 'default', () =>
        vault.storeSecret({ serviceSlug: slug!, name: 'Brain key', secretData: { apiKey: extra.key } })
      );
    }
    const now = new Date().toISOString();
    await brainRepo.saveTenantBrain({
      id, tenantId, provider: 'openrouter', modelId, modelVersion: 'v1',
      credentialVaultServiceSlug: slug, keyLastFour: '0000', status: 'certified', healthStatus: 'healthy',
      certifiedTiers: ['T2'], certifiedLanguages: ['en'], assignedAgents: extra.assignedAgents ?? [],
      currentMonthSpendUsd: 0, createdAt: now, updatedAt: now,
    });
  };

  /** Records which candidate/key each call used and replies from a script. */
  const scripted = (replies: string[] | ((c: ModelCandidate) => string)) => {
    const calls: Array<{ model: string; apiKey?: string; user: string }> = [];
    let i = 0;
    const adapterFor = (candidate: ModelCandidate, apiKey?: string): LLMProviderAdapter => ({
      async execute(model, _system, user) {
        calls.push({ model, apiKey, user });
        const content = typeof replies === 'function' ? replies(candidate) : replies[Math.min(i++, replies.length - 1)];
        if (content === 'THROW') throw new Error('provider down');
        return { content, promptTokens: 10, completionTokens: 5, costUsd: 0.00001 };
      },
    });
    return { calls, adapterFor };
  };

  const req = (over: Record<string, unknown> = {}) => ({
    tenantId, taskId: 't1', tier: 'T2' as CapabilityTier, language: 'en', agentSlug: 'support',
    systemPrompt: 'sys', userPrompt: 'Is the clinic open on Sunday?', ...over,
  });

  beforeEach(async () => {
    setMode('staging');
    client = new SQLiteDatabaseClient(':memory:');
    db.setClientForTesting(client);
    await new SchemaMigrator(client).applyMigrations();
    tenantId = (await new TenantRepository(client).create({ name: 'Gateway Clinic', slug: 'gw-clinic', plan_tier: 'enterprise', channel_plan: 'combined' })).id;
    brainRepo = new BrainSupplyRepository(client);
    certRepo = new ModelCertificationRepository(client);
    vault = new CredentialVault();
  });

  afterEach(async () => {
    setMode(undefined);
    await client.close();
  });

  it("uses the owner's certified brain, assigned-agent first, with its BYO key from the vault", async () => {
    await certify('acme/brain-a', 'T2', 'en');
    await certify('acme/brain-b', 'T2', 'en');
    await addBrain('b1', 'acme/brain-a', { key: 'sk-or-tenant-a' });
    await addBrain('b2', 'acme/brain-b', { key: 'sk-or-tenant-b', assignedAgents: ['support'] });
    const { calls, adapterFor } = scripted(['plain answer']);
    const gw = new ModelGateway({ brainRepo, certRepo, vault, adapterFor });

    const res = await TenantContextManager.withTenant(tenantId, 'default', () => gw.complete(req()));
    expect(res.modelUsed).toBe('acme/brain-b');
    expect(res.selection.source).toBe('tenant_brain');
    expect(calls[0].apiKey).toBe('sk-or-tenant-b');
  });

  it('ignores brains whose certification cell is missing, failed or expired, and escalates (BYO tenant)', async () => {
    await certify('acme/hi-only', 'T2', 'hi');
    await certify('acme/failed', 'T2', 'en', { status: 'failed' });
    await certify('acme/expired', 'T2', 'en', { expired: true });
    await addBrain('b1', 'acme/hi-only');
    await addBrain('b2', 'acme/failed');
    await addBrain('b3', 'acme/expired');
    const { calls, adapterFor } = scripted(['x']);
    const gw = new ModelGateway({ brainRepo, certRepo, vault, adapterFor });

    await expect(gw.complete(req())).rejects.toBeInstanceOf(GatewayEscalationError);
    expect(calls.length).toBe(0);
  });

  it('refuses before any call when the tenant brain supply is paused', async () => {
    const cfg = await brainRepo.getTenantBrainConfig(tenantId);
    await brainRepo.saveTenantBrainConfig({ ...cfg, status: 'budget_exhausted' });
    const { calls, adapterFor } = scripted(['x']);
    const gw = new ModelGateway({ brainRepo, certRepo, vault, adapterFor });

    await expect(gw.complete(req())).rejects.toBeInstanceOf(GatewayRefusedError);
    expect(calls.length).toBe(0);
  });

  it('managed supply uses platform-certified models; a reduced-autonomy route is flagged as a draft', async () => {
    const cfg = await brainRepo.getTenantBrainConfig(tenantId);
    await brainRepo.saveTenantBrainConfig({ ...cfg, brainSupply: 'managed' });
    await certify('platform/fast', 'T2', 'en');
    const { adapterFor } = scripted(['ok']);
    const gw = new ModelGateway({ brainRepo, certRepo, vault, adapterFor });

    const direct = await gw.complete(req());
    expect(direct.modelUsed).toBe('platform/fast');
    expect(direct.selection.requiresApproval).toBe(false);

    // T4 requested in Tamil, only English models certified → ladder reduces autonomy → draft for approval.
    await certify('platform/basic', 'T1', 'en');
    const draft = await gw.selectModel(req({ tier: 'T4', language: 'ta' }));
    expect(draft.requiresApproval).toBe(true);
    expect(draft.degradation?.actionTaken).toBe('reduce_autonomy');
  });

  it('falls back to the next certified candidate when one fails', async () => {
    await certify('acme/a', 'T2', 'en');
    await certify('acme/b', 'T2', 'en');
    await addBrain('b1', 'acme/a', { assignedAgents: ['support'] });
    await addBrain('b2', 'acme/b');
    const { adapterFor } = scripted((c) => (c.modelId === 'acme/a' ? 'THROW' : 'from b'));
    const gw = new ModelGateway({ brainRepo, certRepo, vault, adapterFor });

    const res = await gw.complete(req());
    expect(res.modelUsed).toBe('acme/b');
    expect(res.content).toBe('from b');
  });

  describe('structured output (WP-1.3)', () => {
    const schema = z.object({ answer: z.string(), confidence: z.number().min(0).max(1) });
    beforeEach(async () => {
      await certify('acme/a', 'T2', 'en');
      await addBrain('b1', 'acme/a');
    });

    it('accepts a valid reply without a repair call', async () => {
      const { calls, adapterFor } = scripted(['{"answer":"Closed on Sundays","confidence":0.9}']);
      const res = await new ModelGateway({ brainRepo, certRepo, vault, adapterFor }).complete(req({ schema }));
      expect(res.parsed).toEqual({ answer: 'Closed on Sundays', confidence: 0.9 });
      expect(res.repairAttempted).toBe(false);
      expect(calls.length).toBe(1);
    });

    it('repairs once, telling the model what was wrong', async () => {
      const { calls, adapterFor } = scripted(['{"answer":"Closed","confidence":"high"}', '{"answer":"Closed","confidence":0.8}']);
      const res = await new ModelGateway({ brainRepo, certRepo, vault, adapterFor }).complete(req({ schema }));
      expect(res.repairAttempted).toBe(true);
      expect(res.parsed).toEqual({ answer: 'Closed', confidence: 0.8 });
      expect(calls[1].user).toContain('confidence');
      expect(res.costUsd).toBeCloseTo(0.00002, 8);
    });

    it('fails after exactly one repair and does not try other models', async () => {
      await certify('acme/b', 'T2', 'en');
      await addBrain('b2', 'acme/b');
      const { calls, adapterFor } = scripted(['Sure! We are closed.']);
      const err = await new ModelGateway({ brainRepo, certRepo, vault, adapterFor }).complete(req({ schema })).catch((e) => e);
      expect(err).toBeInstanceOf(StructuredOutputError);
      expect(calls.length).toBe(2);
    });
  });

  it('sandbox mode labels uncertified execution', async () => {
    setMode('test');
    const { adapterFor } = scripted(['ok']);
    const res = await new ModelGateway({ brainRepo, certRepo, vault, adapterFor }).complete(req({ sandboxModelHint: 'gemini-2.5-flash' }));
    expect(res.selection.source).toBe('sandbox_uncertified');
    expect(res.modelUsed).toBe('gemini-2.5-flash');
  });
});

const liveKey = process.env.KRIYA_LIVE_TEST_OPENROUTER_KEY;
describe.skipIf(!liveKey)('Live: a real agent end-to-end (orchestrator → gateway → OpenRouter)', () => {
  it('runs the support agent on a certified brain and returns a validated structured result', async () => {
    const model = process.env.KRIYA_LIVE_TEST_MODEL || 'deepseek/deepseek-v4-flash';
    const client = new SQLiteDatabaseClient(':memory:');
    db.setClientForTesting(client);
    await new SchemaMigrator(client).applyMigrations();
    const tenantId = (await new TenantRepository(client).create({ name: 'Live Clinic', slug: 'live-clinic', plan_tier: 'enterprise', channel_plan: 'combined' })).id;
    const brainRepo = new BrainSupplyRepository(client);
    const certRepo = new ModelCertificationRepository(client);
    const now = new Date();
    await certRepo.saveCertification({
      id: `cert_live_T2_en`, model_id: model, model_version: 'live', provider: 'openrouter', upstream_provider: 'openrouter',
      tier: 'T2', language: 'en', eval_suite_version: 'kriya-probes-v2.0.0', status: 'certified', pass_rate: 1,
      latency_p95_ms: 5000, cost_per_task_usd: 0.0001, stage_results_json: '{}', certified_at: now.toISOString(),
      expires_at: new Date(now.getTime() + 86400000).toISOString(), certified_by: 'kriya_probe_harness',
    });
    await brainRepo.saveTenantBrain({
      id: 'live_brain', tenantId, provider: 'openrouter', modelId: model, modelVersion: 'live', keyLastFour: liveKey!.slice(-4),
      status: 'certified', healthStatus: 'healthy', certifiedTiers: ['T2'], certifiedLanguages: ['en'], assignedAgents: [],
      currentMonthSpendUsd: 0, createdAt: now.toISOString(), updatedAt: now.toISOString(),
    });

    try {
      await TenantContextManager.withTenant(tenantId, 'default', async () => {
        await new AgentRegistryService().bootstrapSystemTemplates();
        const gateway = new ModelGateway({ brainRepo, certRepo, adapterFor: () => new OpenRouterAdapter({ apiKey: liveKey! }) });
        const orchestrator = new HierarchicalOrchestrator(undefined, undefined, undefined, gateway);
        const result = await orchestrator.dispatch({
          objective: 'A patient asks: are you open on Sunday?',
          entryAgentSlug: 'customer_support_specialist',
          contextData: { clinicHours: 'Monday to Saturday 9:00-18:00. Closed on Sundays.' },
        });

        const out = result.primaryOutcome;
        const used = (out.details as any).model;
        console.log('[live agent]', JSON.stringify({ status: result.status, outcome: out.status, confidence: out.confidence, action: out.recommendedAction.slice(0, 160), model: used, costUsd: result.totalCostUsd }));
        expect(used?.source).toBe('tenant_brain');
        expect(out.policyFlags).not.toContain('UNPARSEABLE_MODEL_OUTPUT');
        expect(out.policyFlags).not.toContain('SANDBOX_UNCERTIFIED_MODEL');
        expect(result.totalCostUsd).toBeGreaterThan(0);
      });
    } finally {
      await client.close();
    }
  }, 120_000);
});
