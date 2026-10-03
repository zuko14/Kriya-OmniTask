/**
 * Kriya Omnitask — Cost cascade tests (docs/kriya WP-2.4, 02 §5.1)
 * L0 hits make zero model calls; L1 cache is per tenant and per knowledge version;
 * an L2 schema failure escalates to L3; L3 uncertainty escalates to a human, never a bigger guess.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { db, SQLiteDatabaseClient } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { TenantContextManager } from '../../src/core/context/tenantContext.js';
import { TenantRepository } from '../../src/storage/repositories/tenantRepository.js';
import { createRuntimeHandlers, RuleFn } from '../../src/runtime/graph/handlers.js';
import { GraphExecutor } from '../../src/runtime/graph/executor.js';
import { GraphRunRepository } from '../../src/runtime/graph/graphRunRepository.js';
import { GraphDefinition } from '../../src/runtime/graph/types.js';
import { validateGraph } from '../../src/runtime/graph/validator.js';
import { ModelGateway } from '../../src/model/gateway/modelGateway.js';
import { LLMProviderAdapter } from '../../src/orchestration/routing/modelRouter.js';

const IntentSchema = z.object({ intent: z.enum(['book', 'cancel', 'faq']), confidence: z.number().min(0).max(1) });
const rules: Record<string, RuleFn> = {
  kw_intent: (state) => (/^cancel\b/i.test(String(state.request)) ? { match: { intent: 'cancel', confidence: 1 } } : {}),
};

const graph = (): GraphDefinition => ({
  id: 'cascade_test',
  version: '1.0.0',
  entry: 'classify',
  maxSteps: 10,
  nodes: [
    { id: 'classify', kind: 'cascade', config: { outputSchema: 'intent', rule: 'kw_intent', cache: true, minConfidence: 0.7, systemPrompt: 'Classify the intent.', userPrompt: '{{request}}', writeTo: 'intent' } },
    { id: 'human', kind: 'human_gate', config: { reason: 'Intent unclear' } },
    { id: 'done', kind: 'end', outcome: 'informed', config: {} },
  ],
  edges: [
    { from: 'classify', to: 'done', when: [{ path: 'intent', op: 'exists' }] },
    { from: 'classify', to: 'human' },
    { from: 'human', to: 'done' },
  ],
});

/** A gateway whose adapter replies from a script, recording the capability tier of every call. */
function scripted(replies: string[]) {
  const tiers: string[] = [];
  let i = 0;
  const gateway = new ModelGateway({
    adapterFor: (): LLMProviderAdapter => ({
      async execute() {
        return { content: replies[Math.min(i++, replies.length - 1)], promptTokens: 10, completionTokens: 5, costUsd: 0.0001 };
      },
    }),
  });
  const complete = gateway.complete.bind(gateway);
  gateway.complete = ((req: Parameters<typeof complete>[0]) => {
    tiers.push(req.tier);
    return complete(req);
  }) as typeof gateway.complete;
  return { gateway, tiers };
}

describe('Cost cascade (WP-2.4)', () => {
  let client: SQLiteDatabaseClient;
  let tenantA: string;
  let tenantB: string;
  const inT = <T>(tenantId: string, fn: () => Promise<T>) => TenantContextManager.withTenant(tenantId, 'default', fn, { userId: 'u', roles: ['owner'] });

  beforeEach(async () => {
    client = new SQLiteDatabaseClient(':memory:');
    db.setClientForTesting(client);
    await new SchemaMigrator(client).applyMigrations();
    const tenants = new TenantRepository(client);
    tenantA = (await tenants.create({ name: 'A', slug: 'cas-a', plan_tier: 'enterprise', channel_plan: 'combined' })).id;
    tenantB = (await tenants.create({ name: 'B', slug: 'cas-b', plan_tier: 'enterprise', channel_plan: 'combined' })).id;
  });

  afterEach(async () => {
    await client.close();
  });

  const run = (gateway: ModelGateway, state: Record<string, unknown>, g = graph()) => {
    const { handlers, compensator } = createRuntimeHandlers({ agentSlug: 'intake', gateway, schemas: { intent: IntentSchema }, rules });
    return new GraphExecutor(handlers, new GraphRunRepository(client), compensator).start(g, state);
  };

  it('L0: a rule hit resolves with zero model calls', async () => {
    await inT(tenantA, async () => {
      const { gateway, tiers } = scripted(['{}']);
      const res = await run(gateway, { request: 'cancel my appointment' });
      expect(res.outcome).toBe('informed');
      expect(res.state.intent).toEqual({ intent: 'cancel', confidence: 1 });
      expect((res.state.cascade as any).classify.level).toBe('L0');
      expect(tiers).toEqual([]);
      expect(res.state.costUsd ?? 0).toBe(0);
    });
  });

  it('L2 schema failure (after its one repair) escalates to L3, which resolves', async () => {
    await inT(tenantA, async () => {
      const { gateway, tiers } = scripted(['not json', 'still not json', '{"intent":"book","confidence":0.9}']);
      const res = await run(gateway, { request: 'I want to see a doctor tomorrow' });
      expect(res.state.intent).toEqual({ intent: 'book', confidence: 0.9 });
      const c = (res.state.cascade as any).classify;
      expect(c.level).toBe('L3');
      expect(c.trail.map((t: any) => t.level)).toEqual(['L0', 'L1', 'L2']);
      expect(tiers).toEqual(['T1', 'T3']);
    });
  });

  it('L3 uncertainty escalates to a human; a missing confidence counts as uncertain, never a default', async () => {
    await inT(tenantA, async () => {
      const low = scripted(['{"intent":"faq","confidence":0.4}']);
      const parked = await run(low.gateway, { request: 'hmm maybe something' });
      expect(parked.status).toBe('parked');
      expect(parked.state.intent).toBeUndefined();
      expect((parked.state.cascade as any).classify.level).toBe('human');
      expect(low.tiers).toEqual(['T1', 'T3']); // never a third, bigger guess

      const noConf = scripted(['{"intent":"faq"}']);
      const parked2 = await run(noConf.gateway, { request: 'something else' });
      expect(parked2.status).toBe('parked');
    });
  });

  it('L1: a repeat is served from the tenant cache; a new knowledge version or another tenant misses', async () => {
    const first = scripted(['{"intent":"faq","confidence":0.95}']);
    await inT(tenantA, () => run(first.gateway, { request: 'What are your  hours?', knowledgeVersion: 'k1' }));
    expect(first.tiers).toEqual(['T1']);

    const again = scripted(['{"intent":"book","confidence":0.95}']);
    const hit = await inT(tenantA, () => run(again.gateway, { request: 'what are your hours?', knowledgeVersion: 'k1' }));
    expect((hit.state.cascade as any).classify.level).toBe('L1');
    expect(hit.state.intent).toEqual({ intent: 'faq', confidence: 0.95 });
    expect(again.tiers).toEqual([]);
    expect((await client.queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM cascade_cache'))!.n).toBe(1); // persisted, not in-process

    const newKnowledge = await inT(tenantA, () => run(again.gateway, { request: 'what are your hours?', knowledgeVersion: 'k2' }));
    expect((newKnowledge.state.cascade as any).classify.level).toBe('L2');

    const other = scripted(['{"intent":"faq","confidence":0.95}']);
    const otherTenant = await inT(tenantB, () => run(other.gateway, { request: 'what are your hours?', knowledgeVersion: 'k1' }));
    expect((otherTenant.state.cascade as any).classify.level).toBe('L2');
  });

  it('uncertain answers are never cached', async () => {
    await inT(tenantA, async () => {
      await run(scripted(['{"intent":"faq","confidence":0.3}']).gateway, { request: 'opening hours' });
      const next = scripted(['{"intent":"faq","confidence":0.9}']);
      const res = await run(next.gateway, { request: 'opening hours' });
      expect((res.state.cascade as any).classify.level).toBe('L2');
    });
  });

  it('the validator refuses a cascade with no route for the unresolved case', () => {
    const g = graph();
    g.nodes = g.nodes.filter((n) => n.id !== 'human');
    g.edges = g.edges.filter((e) => e.from !== 'human' && e.to !== 'human');
    expect(validateGraph(g).violations.map((v) => v.rule)).toContain('cascade_unresolved');
  });
});

const liveKey = process.env.KRIYA_LIVE_TEST_OPENROUTER_KEY;
describe.skipIf(!liveKey)('Live: the cascade classifies a code-mixed message with a real model', () => {
  it('L0 misses → L2 (cheap model) resolves with a schema-valid intent; the repeat is an L1 hit', async () => {
    const { OpenRouterAdapter } = await import('../../src/model/gateway/openRouterAdapter.js');
    const { BrainSupplyRepository } = await import('../../src/model/brain/repositories/brainSupplyRepository.js');
    const { ModelCertificationRepository } = await import('../../src/model/certification/modelCertificationRepository.js');
    const model = process.env.KRIYA_LIVE_TEST_MODEL || 'deepseek/deepseek-v4-flash';
    const client = new SQLiteDatabaseClient(':memory:');
    db.setClientForTesting(client);
    await new SchemaMigrator(client).applyMigrations();
    const tenantId = (await new TenantRepository(client).create({ name: 'Live', slug: 'live-cascade', plan_tier: 'enterprise', channel_plan: 'combined' })).id;
    const now = new Date();
    const certRepo = new ModelCertificationRepository(client);
    const brainRepo = new BrainSupplyRepository(client);
    for (const tier of ['T1', 'T3'] as const) {
      await certRepo.saveCertification({ id: `c_${tier}`, model_id: model, model_version: 'live', provider: 'openrouter', upstream_provider: 'openrouter', tier, language: 'en', eval_suite_version: 'kriya-probes-v2.0.0', status: 'certified', pass_rate: 1, latency_p95_ms: 5000, cost_per_task_usd: 0.0001, stage_results_json: '{}', certified_at: now.toISOString(), expires_at: new Date(now.getTime() + 86400000).toISOString(), certified_by: 'kriya_probe_harness' });
    }
    await brainRepo.saveTenantBrain({ id: 'b_live', tenantId, provider: 'openrouter', modelId: model, modelVersion: 'live', keyLastFour: liveKey!.slice(-4), status: 'certified', healthStatus: 'healthy', certifiedTiers: ['T1', 'T3'], certifiedLanguages: ['en'], assignedAgents: [], currentMonthSpendUsd: 0, createdAt: now.toISOString(), updatedAt: now.toISOString() });
    try {
      await TenantContextManager.withTenant(tenantId, 'default', async () => {
        const gateway = new ModelGateway({ brainRepo, certRepo, adapterFor: () => new OpenRouterAdapter({ apiKey: liveKey! }) });
        const g = graph();
        g.nodes[0].config.systemPrompt =
          'Classify the customer message for a clinic. Reply with ONE JSON object {"intent": "book" | "cancel" | "faq", "confidence": number 0-1}. ' +
          'book = wants an appointment; cancel = wants to cancel one; faq = a question. Messages may mix Telugu/Hindi with English.';
        const { handlers, compensator } = createRuntimeHandlers({ agentSlug: 'intake', gateway, schemas: { intent: IntentSchema }, rules });
        const exec = new GraphExecutor(handlers, new GraphRunRepository(client), compensator);
        const t0 = Date.now();
        const first = await exec.start(g, { request: 'Repu doctor appointment kavali, morning 10 ki book cheyyandi', knowledgeVersion: 'k1' });
        const ms = Date.now() - t0;
        const second = await exec.start(g, { request: 'repu doctor appointment kavali, morning 10 ki book cheyyandi', knowledgeVersion: 'k1' });
        console.log('[live cascade]', JSON.stringify({ outcome: first.outcome, intent: first.state.intent, cascade: first.state.cascade, costUsd: first.state.costUsd, latencyMs: ms, repeatLevel: (second.state.cascade as any)?.classify?.level, repeatCost: second.state.costUsd ?? 0 }));
        expect(first.outcome).toBe('informed');
        expect((first.state.intent as any).intent).toBe('book');
        expect(['L2', 'L3']).toContain((first.state.cascade as any).classify.level);
        expect((second.state.cascade as any).classify.level).toBe('L1');
      });
    } finally {
      await client.close();
    }
  }, 120_000);
});
