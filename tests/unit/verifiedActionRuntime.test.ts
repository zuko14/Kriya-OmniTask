/**
 * Kriya Omnitask — Verified Action runtime tests (docs/kriya WP-2.2b, WP-2.3, M3: WP-3.1…3.6, S29, S32)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { db, SQLiteDatabaseClient } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { TenantContextManager } from '../../src/core/context/tenantContext.js';
import { TenantRepository } from '../../src/storage/repositories/tenantRepository.js';
import { CryptoAuditLedger } from '../../src/security/hardening/ledger/cryptoAuditLedger.js';
import { IdempotencyManager } from '../../src/reliability/idempotency/idempotencyManager.js';
import { MandateService } from '../../src/trust/mandate/mandateService.js';
import { ProofService, verifyReceiptOffline } from '../../src/trust/proof/proofService.js';
import { ToolRegistryService } from '../../src/tools/registry/toolRegistry.js';
import { GraphExecutor } from '../../src/runtime/graph/executor.js';
import { GraphRunRepository } from '../../src/runtime/graph/graphRunRepository.js';
import { createRuntimeHandlers } from '../../src/runtime/graph/handlers.js';
import { compileDagToGraph, DagCompileError } from '../../src/runtime/graph/dagCompiler.js';
import { buildAgentLoop, AgentLoopSpec } from '../../src/runtime/graph/agentLoop.js';
import { toActionTier } from '../../src/trust/riskTiers.js';
import { ModelGateway, ModelCandidate } from '../../src/model/gateway/modelGateway.js';
import { LLMProviderAdapter } from '../../src/orchestration/routing/modelRouter.js';
import { OpenRouterAdapter } from '../../src/model/gateway/openRouterAdapter.js';
import { BrainSupplyRepository } from '../../src/model/brain/repositories/brainSupplyRepository.js';
import { ModelCertificationRepository } from '../../src/model/certification/modelCertificationRepository.js';
import { DAGDefinition } from '../../src/workflows/types/workflowTypes.js';

// ---- An in-memory "system of record" the test tools act on and read back from ----
const bookings = new Map<string, { slot: string; customer: string }>();
const charges = new Map<string, number>();
let chargeShouldFail = false;
const registry = new ToolRegistryService();

registry.registerTool({
  definition: { slug: 'test_check_slots', name: 'Check slots', description: 'List free slots for a date', category: 'calendar', riskTier: 'LOW', requiresApproval: false, inputSchema: {}, outputSchema: {}, isSystem: false },
  inputValidator: z.object({ date: z.string() }),
  handler: async (input) => ({ date: input.date, free: ['10:00', '14:00'].filter((t) => ![...bookings.values()].some((b) => b.slot === `${input.date} ${t}`)) }),
  verify: async () => ({ state: 'verified' }),
});
registry.registerTool({
  definition: { slug: 'test_book_slot', name: 'Book slot', description: 'Book a slot', category: 'calendar', riskTier: 'MEDIUM', requiresApproval: false, inputSchema: {}, outputSchema: {}, isSystem: false },
  inputValidator: z.object({ slot: z.string(), customer: z.string() }),
  handler: async (input, ctx) => {
    const bookingId = `bk_${ctx.idempotencyKey}`; // the provider dedupes on the idempotency key
    bookings.set(bookingId, { slot: String(input.slot), customer: String(input.customer) });
    return { bookingId, status: 'confirmed' };
  },
  verify: async (input, output) => {
    const b = bookings.get(String(output.bookingId));
    return b && b.slot === input.slot ? { state: 'verified', observed: b } : { state: 'mismatch' };
  },
  compensate: async (_i, output) => {
    bookings.delete(String(output.bookingId));
  },
});
registry.registerTool({
  definition: { slug: 'test_charge', name: 'Charge', description: 'Charge a deposit', category: 'payment', riskTier: 'HIGH', requiresApproval: false, inputSchema: {}, outputSchema: {}, isSystem: false },
  inputValidator: z.object({ amount: z.number(), customer: z.string() }),
  handler: async (input, ctx) => {
    if (chargeShouldFail) throw new Error('payment provider declined');
    const chargeId = `ch_${ctx.idempotencyKey}`;
    charges.set(chargeId, Number(input.amount));
    return { chargeId };
  },
  verify: async (_i, output) => (charges.has(String(output.chargeId)) ? { state: 'verified' } : { state: 'mismatch' }),
});
registry.registerTool({
  definition: { slug: 'test_note', name: 'Note', description: 'Write a note (no read-back)', category: 'crm', riskTier: 'MEDIUM', requiresApproval: false, inputSchema: {}, outputSchema: {}, isSystem: false },
  inputValidator: z.object({ text: z.string() }),
  handler: async () => ({ noteId: 'n1' }),
});

const tierOf = (slug: string) => {
  const t = registry.getTool(slug);
  return t ? toActionTier(t.definition.riskTier) : undefined;
};
const compile = (dag: DAGDefinition, id = 'wf') => compileDagToGraph(dag, { graphId: id, toolTier: tierOf, toolHasVerify: (s) => !!registry.getTool(s)?.verify });

describe('S32: canonical hashing covers nested fields', () => {
  it('ledger and idempotency hashes change when only a nested value changes', () => {
    const a = { action: 'refund', detail: { amount: 100, account: 'A' } };
    const b = { action: 'refund', detail: { amount: 99999, account: 'B' } };
    expect(CryptoAuditLedger.computePayloadHash(a)).not.toBe(CryptoAuditLedger.computePayloadHash(b));
    expect(IdempotencyManager.computePayloadHash(a)).not.toBe(IdempotencyManager.computePayloadHash(b));
    expect(CryptoAuditLedger.computePayloadHash({ x: 1, y: { b: 2, a: 1 } })).toBe(CryptoAuditLedger.computePayloadHash({ y: { a: 1, b: 2 }, x: 1 }));
  });
});

describe('Verified Action runtime', () => {
  let client: SQLiteDatabaseClient;
  let tenantA: string;
  let tenantB: string;
  const inA = <T>(fn: () => Promise<T>) => TenantContextManager.withTenant(tenantA, 'default', fn, { userId: 'owner_1', roles: ['owner'] });
  const inB = <T>(fn: () => Promise<T>) => TenantContextManager.withTenant(tenantB, 'default', fn, { userId: 'owner_2', roles: ['owner'] });

  beforeEach(async () => {
    client = new SQLiteDatabaseClient(':memory:');
    db.setClientForTesting(client);
    await new SchemaMigrator(client).applyMigrations();
    const tenants = new TenantRepository(client);
    tenantA = (await tenants.create({ name: 'Clinic A', slug: 'clinic-a', plan_tier: 'enterprise', channel_plan: 'combined' })).id;
    tenantB = (await tenants.create({ name: 'Clinic B', slug: 'clinic-b', plan_tier: 'enterprise', channel_plan: 'combined' })).id;
    bookings.clear();
    charges.clear();
    chargeShouldFail = false;
  });

  afterEach(async () => {
    await client.close();
  });

  describe('Kriya Mandate (WP-3.1)', () => {
    it('allows within limits, consumes them atomically, and refuses beyond them', async () => {
      await inA(async () => {
        const svc = new MandateService(client);
        await svc.create({ principalId: 'owner_1', agentSlug: 'billing', actionTypes: ['refund'], perActionLimit: 500, dailyLimit: 800, maxCountPerDay: 5, resourceScope: { branch: 'hyd' } }, 'owner_1');
        const req = { agentSlug: 'billing', actionType: 'refund', currency: 'INR', scope: { branch: 'hyd' } };

        expect((await svc.authorize({ ...req, amount: 400 })).decision).toBe('allow');
        expect((await svc.authorize({ ...req, amount: 600 })).decision).toBe('over_limit'); // per action
        const third = await svc.authorize({ ...req, amount: 450 }); // 400 + 450 > 800 daily
        expect(third.decision).toBe('over_limit');
        expect((third as { reason: string }).reason).toMatch(/daily limit/);
        expect((await svc.authorize({ ...req, amount: 400 })).decision).toBe('allow'); // exactly 800

        expect((await svc.authorize({ ...req, amount: 10, scope: { branch: 'blr' } })).decision).toBe('denied');
        expect((await svc.authorize({ ...req, amount: 10, agentSlug: 'marketing' })).decision).toBe('denied');
        expect((await svc.authorize({ ...req, amount: 10, actionType: 'discount' })).decision).toBe('denied');
        expect((await svc.authorize({ ...req, amount: 10, currency: 'USD' })).decision).toBe('denied');
        await expect(svc.authorize({ ...req, amount: -5 })).rejects.toThrow(/Invalid action amount/);
      });
    });

    it('expired and revoked mandates authorise nothing; usage resets the next day', async () => {
      await inA(async () => {
        const svc = new MandateService(client);
        const m = await svc.create({ principalId: 'owner_1', agentSlug: '*', actionTypes: ['refund'], dailyLimit: 100, validFrom: '2026-01-01T00:00:00.000Z', validUntil: '2030-01-01T00:00:00.000Z' }, 'owner_1');
        const req = { agentSlug: 'any', actionType: 'refund', amount: 100 };
        expect((await svc.authorize(req, new Date('2026-10-01T10:00:00Z'))).decision).toBe('allow');
        expect((await svc.authorize(req, new Date('2026-10-01T11:00:00Z'))).decision).toBe('over_limit');
        expect((await svc.authorize(req, new Date('2026-10-02T09:00:00Z'))).decision).toBe('allow');
        expect((await svc.authorize(req, new Date('2031-01-01T00:00:00Z'))).decision).toBe('denied');
        await svc.revoke(m.id, 'owner_1');
        expect((await svc.authorize(req, new Date('2026-10-05T00:00:00Z'))).decision).toBe('denied');
      });
      await inB(async () => expect((await new MandateService(client).authorize({ agentSlug: 'any', actionType: 'refund', amount: 1 })).decision).toBe('denied'));
    });
  });

  describe('Kriya Proof (WP-3.3)', () => {
    const issue = (svc: ProofService, n: number) =>
      svc.issue({ actionType: 'test_book_slot', riskTier: 'T1', actor: { agentSlug: 'booking' }, input: { n }, output: { ok: true }, target: { system: 'calendar', externalRef: `bk_${n}` }, verification: { method: 'readback', state: 'verified' } });

    it('chains, signs and verifies receipts; detects tampering', async () => {
      await inA(async () => {
        const svc = new ProofService(client);
        const r1 = await issue(svc, 1);
        const r2 = await issue(svc, 2);
        const r3 = await issue(svc, 3);
        expect(r2.body.prevHash).toBe(r1.hash);
        expect(r1.body.inputHash).toHaveLength(64);
        expect(JSON.stringify(r1.body)).not.toContain('"n":1'); // raw input not stored, only its hash
        expect(await svc.verifyChain()).toEqual({ valid: true, checked: 3 });

        const bundle = await svc.exportBundle();
        expect(verifyReceiptOffline(bundle.receipts[2], bundle.publicKeys[r3.keyId]).valid).toBe(true);
        const forged = { ...r3, body: { ...r3.body, target: { system: 'calendar', externalRef: 'bk_FORGED' } } };
        expect(verifyReceiptOffline(forged, bundle.publicKeys[r3.keyId]).valid).toBe(false);

        await client.execute("UPDATE proof_receipts SET body_json = replace(body_json, 'bk_2', 'bk_X') WHERE id = ?", [r2.body.receiptId]);
        expect((await svc.verify(r2.body.receiptId)).valid).toBe(false);
        expect((await svc.verifyChain()).brokenAt).toBe(2);
      });
    });

    it('a deleted receipt breaks the chain, and receipts are tenant-isolated', async () => {
      const ids = await inA(async () => {
        const svc = new ProofService(client);
        return [await issue(svc, 1), await issue(svc, 2), await issue(svc, 3)].map((r) => r.body.receiptId);
      });
      await client.execute('DELETE FROM proof_receipts WHERE id = ?', [ids[1]]);
      await inA(async () => expect((await new ProofService(client).verifyChain()).reason).toMatch(/sequence gap/));
      await inB(async () => expect(await new ProofService(client).get(ids[0])).toBeNull());
    });
  });

  describe('Compiled workflows on the graph runtime (WP-2.2b, S29)', () => {
    const exec = (agentSlug = 'ops') => {
      const { handlers, compensator } = createRuntimeHandlers({ agentSlug, toolRegistry: registry, mandateService: new MandateService(client), proofService: new ProofService(client) });
      return new GraphExecutor(handlers, new GraphRunRepository(client), compensator);
    };

    it('inserts a policy check before every tool and ends verified with a real read-back and receipt', async () => {
      await inA(async () => {
        const graph = compile({ steps: [{ id: 'book', name: 'Book', type: 'tool_execution', dependsOn: [], config: { toolName: 'test_book_slot', params: { slot: '${context.slot}', customer: '${context.customer}' } } }] });
        expect(graph.nodes.find((n) => n.id === 'book__policy')?.kind).toBe('policy');
        expect(graph.edges.find((e) => e.to === 'book__tool')?.from).toBe('book__policy');

        const res = await exec().start(graph, { context: { slot: '2026-10-09 10:00', customer: 'Ravi' } });
        expect(res.outcome).toBe('verified');
        const steps = res.state.steps as Record<string, any>;
        expect(steps.book.output.status).toBe('confirmed');
        expect(steps.book.receipt.id).toMatch(/^rcpt_/);
        expect([...bookings.values()]).toEqual([{ slot: '2026-10-09 10:00', customer: 'Ravi' }]);
        expect((await new ProofService(client).verifyChain()).valid).toBe(true);
      });
    });

    it('a tool without verify() is reported "submitted", never "verified"', async () => {
      await inA(async () => {
        const graph = compile({ steps: [{ id: 'n', name: 'Note', type: 'tool_execution', dependsOn: [], config: { toolName: 'test_note', params: { text: 'hi' } } }] });
        expect((await exec().start(graph, {})).outcome).toBe('submitted');
      });
    });

    it('a HIGH-risk step runs under its mandate, parks for a human over it, and continues on approval', async () => {
      await inA(async () => {
        await new MandateService(client).create({ principalId: 'owner_1', agentSlug: 'ops', actionTypes: ['test_charge'], perActionLimit: 500 }, 'owner_1');
        const dag = (amount: number): DAGDefinition => ({ steps: [{ id: 'pay', name: 'Charge deposit', type: 'tool_execution', dependsOn: [], config: { toolName: 'test_charge', params: { amount, customer: 'Ravi' } } }] });

        expect((await exec().start(compile(dag(300), 'small'), {})).outcome).toBe('verified');

        const parked = await exec().start(compile(dag(5000), 'large'), {});
        expect(parked.status).toBe('parked');
        expect(charges.size).toBe(1);
        const approved = await exec().resume(parked.runId, { approval: { decision: 'approved', by: 'owner_1' } });
        expect(approved.outcome).toBe('verified');
        expect(charges.size).toBe(2);
      });
    });

    it('reverses completed steps when a later step fails (saga) and records the reversal', async () => {
      await inA(async () => {
        await new MandateService(client).create({ principalId: 'owner_1', agentSlug: 'ops', actionTypes: ['test_charge'], perActionLimit: 500 }, 'owner_1');
        chargeShouldFail = true;
        const graph = compile({
          steps: [
            { id: 'book', name: 'Book', type: 'tool_execution', dependsOn: [], config: { toolName: 'test_book_slot', params: { slot: 'S1', customer: 'Ravi' } } },
            { id: 'pay', name: 'Charge', type: 'tool_execution', dependsOn: ['book'], config: { toolName: 'test_charge', params: { amount: 200, customer: 'Ravi' } } },
          ],
        });
        const res = await exec().start(graph, {});
        expect(res.outcome).toBe('compensated');
        expect(bookings.size).toBe(0);
        const receipts = (await new ProofService(client).exportBundle()).receipts.map((r) => r.body.actionType);
        expect(receipts).toEqual(['test_book_slot', 'test_book_slot.compensate']);
      });
    });

    it('refuses to compile a conditional branch instead of compiling it wrongly', () => {
      expect(() =>
        compile({ steps: [{ id: 'c', name: 'Branch', type: 'conditional_branch', dependsOn: [], config: { condition: { field: 'x', operator: 'eq', value: 1 } } }] })
      ).toThrow(DagCompileError);
    });
  });

  describe('Bounded agent loop (WP-2.3)', () => {
    const loopSpec: AgentLoopSpec = { id: 'booking_loop', goal: 'You are the clinic booking agent.', tools: [
      { slug: 'test_check_slots', tier: 'T0', description: 'args {date}: list free slots' },
      { slug: 'test_book_slot', tier: 'T1', description: 'args {slot, customer}: book a slot' },
    ] };
    const scriptedGateway = (plans: object[]) => {
      let i = 0;
      return new ModelGateway({
        adapterFor: (_c: ModelCandidate): LLMProviderAdapter => ({
          async execute() {
            return { content: JSON.stringify(plans[Math.min(i++, plans.length - 1)]), promptTokens: 50, completionTokens: 20, costUsd: 0.00001 };
          },
        }),
      });
    };
    const run = (plans: object[], spec = loopSpec) => {
      const loop = buildAgentLoop(spec);
      const { handlers, compensator } = createRuntimeHandlers({ agentSlug: 'booking', gateway: scriptedGateway(plans), schemas: loop.schemas, rules: loop.rules, toolRegistry: registry, proofService: new ProofService(client), mandateService: new MandateService(client) });
      return new GraphExecutor(handlers, new GraphRunRepository(client), compensator).start(loop.graph, { request: 'Book Ravi on 2026-10-09 at 10:00' });
    };

    it('plans → checks → books → verifies → receipts → finishes "verified"', async () => {
      await inA(async () => {
        const res = await run([
          { action: 'tool', tool: 'test_check_slots', args: { date: '2026-10-09' }, reason: 'see availability' },
          { action: 'tool', tool: 'test_book_slot', args: { slot: '2026-10-09 10:00', customer: 'Ravi' }, reason: '10:00 is free' },
          { action: 'finish', answer: 'Booked Ravi for 9 Oct 10:00.', reason: 'done' },
        ]);
        expect(res.outcome).toBe('verified');
        expect((res.state.loop as any).actionsTaken).toBe(2);
        expect((await new ProofService(client).exportBundle()).receipts).toHaveLength(2);
        expect(bookings.size).toBe(1);
      });
    });

    it('a pure answer with no actions finishes "informed"', async () => {
      await inA(async () => {
        const res = await run([{ action: 'finish', answer: 'We open at 9.', reason: 'question only' }]);
        expect(res.outcome).toBe('informed');
      });
    });

    it('stops on a repeated identical action (no progress)', async () => {
      await inA(async () => {
        const same = { action: 'tool', tool: 'test_check_slots', args: { date: '2026-10-09' }, reason: 'look' };
        const res = await run([same, same, same]);
        expect(res.outcome).toBe('escalated');
      });
    });

    it('stops when over the cost budget, and caps iterations', async () => {
      await inA(async () => {
        const res = await run([{ action: 'tool', tool: 'test_check_slots', args: { date: 'x' }, reason: 'r' }], { ...loopSpec, maxCostUsd: 0 });
        expect(res.outcome).toBe('escalated');

        const varied = Array.from({ length: 20 }, (_, k) => ({ action: 'tool', tool: 'test_check_slots', args: { date: `d${k}` }, reason: 'r' }));
        const capped = await run(varied, { ...loopSpec, maxIterations: 3 });
        expect(capped.outcome).toBe('escalated');
        expect(capped.error).toMatch(/maxVisits/);
      });
    });

    it("a plan naming a tool outside the agent's list fails (schema), never executes", async () => {
      await inA(async () => {
        const res = await run([{ action: 'tool', tool: 'delete_everything', args: {}, reason: 'x' }]);
        expect(res.status).toBe('failed');
        expect(bookings.size).toBe(0);
      });
    });
  });
});

const liveKey = process.env.KRIYA_LIVE_TEST_OPENROUTER_KEY;
describe.skipIf(!liveKey)('Live: a real model drives the bounded agent loop', () => {
  it('books the appointment through check → book → verify → receipt', async () => {
    const model = process.env.KRIYA_LIVE_TEST_MODEL || 'deepseek/deepseek-v4-flash';
    const client = new SQLiteDatabaseClient(':memory:');
    db.setClientForTesting(client);
    await new SchemaMigrator(client).applyMigrations();
    const tenantId = (await new TenantRepository(client).create({ name: 'Live Clinic', slug: 'live-loop', plan_tier: 'enterprise', channel_plan: 'combined' })).id;
    bookings.clear();
    const now = new Date();
    const certRepo = new ModelCertificationRepository(client);
    const brainRepo = new BrainSupplyRepository(client);
    await certRepo.saveCertification({ id: 'c_live', model_id: model, model_version: 'live', provider: 'openrouter', upstream_provider: 'openrouter', tier: 'T2', language: 'en', eval_suite_version: 'kriya-probes-v2.0.0', status: 'certified', pass_rate: 1, latency_p95_ms: 5000, cost_per_task_usd: 0.0001, stage_results_json: '{}', certified_at: now.toISOString(), expires_at: new Date(now.getTime() + 86400000).toISOString(), certified_by: 'kriya_probe_harness' });
    await brainRepo.saveTenantBrain({ id: 'b_live', tenantId, provider: 'openrouter', modelId: model, modelVersion: 'live', keyLastFour: liveKey!.slice(-4), status: 'certified', healthStatus: 'healthy', certifiedTiers: ['T2'], certifiedLanguages: ['en'], assignedAgents: [], currentMonthSpendUsd: 0, createdAt: now.toISOString(), updatedAt: now.toISOString() });

    try {
      await TenantContextManager.withTenant(tenantId, 'default', async () => {
        const loop = buildAgentLoop({ id: 'live_booking', goal: 'You are the booking agent for a clinic. Check availability before booking. Book exactly what the patient asked for if it is free.', maxIterations: 6, maxCostUsd: 0.05, tools: [
          { slug: 'test_check_slots', tier: 'T0', description: 'args {"date":"YYYY-MM-DD"}: list free times that day' },
          { slug: 'test_book_slot', tier: 'T1', description: 'args {"slot":"YYYY-MM-DD HH:MM","customer":string}: book the slot' },
        ] });
        const gateway = new ModelGateway({ brainRepo, certRepo, adapterFor: () => new OpenRouterAdapter({ apiKey: liveKey! }) });
        const { handlers, compensator } = createRuntimeHandlers({ agentSlug: 'booking', gateway, schemas: loop.schemas, rules: loop.rules, toolRegistry: registry, proofService: new ProofService(client), mandateService: new MandateService(client) });
        const res = await new GraphExecutor(handlers, new GraphRunRepository(client), compensator).start(loop.graph, { request: 'Please book Ravi Kumar on 2026-10-09 at 10:00.' });

        const history = ((res.state.loop as any)?.history ?? []).map((h: any) => `${h.tool}(${JSON.stringify(h.args)})→${h.verification}`);
        console.log('[live agent loop]', JSON.stringify({ status: res.status, outcome: res.outcome, steps: res.steps, history, answer: (res.state.plan as any)?.answer, costUsd: res.state.costUsd, bookings: [...bookings.values()], error: res.error }));
        expect(res.outcome).toBe('verified');
        expect([...bookings.values()].some((b) => b.slot === '2026-10-09 10:00')).toBe(true);
        expect((await new ProofService(client).verifyChain()).valid).toBe(true);
      });
    } finally {
      await client.close();
    }
  }, 180_000);
});
