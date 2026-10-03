/**
 * Kriya Omnitask — Durable graph executor tests (docs/kriya WP-2.2)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db, SQLiteDatabaseClient } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { TenantContextManager } from '../../src/core/context/tenantContext.js';
import { TenantRepository } from '../../src/storage/repositories/tenantRepository.js';
import { GraphExecutor, NodeHandlers, RunInterrupted, hashState } from '../../src/runtime/graph/executor.js';
import { GraphRunRepository } from '../../src/runtime/graph/graphRunRepository.js';
import { GraphDefinition } from '../../src/runtime/graph/types.js';

/** Blueprint §14 refund flow (same shape the validator tests use). */
const refundGraph = (): GraphDefinition => ({
  id: 'refund_under_mandate',
  version: '1.0.0',
  entry: 'understand',
  maxSteps: 40,
  nodes: [
    { id: 'understand', kind: 'llm', config: { outputSchema: 'RefundIntent' } },
    { id: 'route_intent', kind: 'router', config: {} },
    { id: 'policy', kind: 'policy', config: {} },
    { id: 'mandate', kind: 'mandate', config: {} },
    { id: 'approval', kind: 'human_gate', config: { reason: 'Refund above mandate limit' } },
    { id: 'refund', kind: 'tool', actionTier: 'T2', config: { tool: 'payments.refund' } },
    { id: 'readback', kind: 'verify', config: {}, maxVisits: 3 },
    { id: 'settled', kind: 'router', config: {}, maxVisits: 3 },
    { id: 'wait', kind: 'rule', config: {}, maxVisits: 3 },
    { id: 'receipt', kind: 'proof', config: {} },
    { id: 'done', kind: 'end', outcome: 'verified', config: {} },
    { id: 'mismatch', kind: 'end', outcome: 'verification_failed', config: {} },
    { id: 'blocked', kind: 'end', outcome: 'blocked', config: {} },
    { id: 'rejected', kind: 'end', outcome: 'escalated', config: {} },
    { id: 'answer', kind: 'end', outcome: 'informed', config: {} },
  ],
  edges: [
    { from: 'understand', to: 'route_intent' },
    { from: 'route_intent', to: 'policy', when: [{ path: 'intent', op: 'eq', value: 'refund' }] },
    { from: 'route_intent', to: 'answer' },
    { from: 'policy', to: 'mandate', when: [{ path: 'policy.decision', op: 'eq', value: 'allow' }] },
    { from: 'policy', to: 'blocked' },
    { from: 'mandate', to: 'refund', when: [{ path: 'mandate.decision', op: 'eq', value: 'allow' }] },
    { from: 'mandate', to: 'approval' },
    { from: 'approval', to: 'refund', when: [{ path: 'approval.decision', op: 'eq', value: 'approved' }] },
    { from: 'approval', to: 'rejected' },
    { from: 'refund', to: 'readback' },
    { from: 'readback', to: 'settled' },
    { from: 'settled', to: 'receipt', when: [{ path: 'verification.state', op: 'eq', value: 'verified' }] },
    { from: 'settled', to: 'wait', when: [{ path: 'verification.state', op: 'eq', value: 'pending' }] },
    { from: 'settled', to: 'mismatch' },
    { from: 'wait', to: 'readback' },
    { from: 'receipt', to: 'done' },
  ],
});

interface Counters {
  refund: number;
  refundKeys: string[];
  verify: number;
}

/** Handlers simulating the real systems; `amount` above 500 needs approval. */
const handlers = (c: Counters, over: NodeHandlers = {}): NodeHandlers => ({
  llm: async ({ state }) => ({ patch: { intent: state.request === 'refund please' ? 'refund' : 'question' } }),
  policy: async () => ({ patch: { policy: { decision: 'allow' } } }),
  mandate: async ({ state }) => ({ patch: { mandate: { decision: Number(state.amount) <= 500 ? 'allow' : 'over_limit' } } }),
  tool: async ({ idempotencyKey }) => {
    c.refund++;
    c.refundKeys.push(idempotencyKey);
    return { patch: { refund: { id: 'rfnd_123', status: 'submitted' } } };
  },
  verify: async () => {
    c.verify++;
    return { patch: { verification: { state: 'verified', observed: 'processed' } } };
  },
  rule: async () => ({}),
  proof: async ({ state }) => ({ patch: { receipt: { id: 'rcpt_1', hash: hashState(state.refund) } } }),
  ...over,
});

describe('Graph executor', () => {
  let client: SQLiteDatabaseClient;
  let tenantA: string;
  let tenantB: string;
  let c: Counters;
  const inTenant = <T>(t: string, fn: () => Promise<T>) => TenantContextManager.withTenant(t, 'default', fn);

  beforeEach(async () => {
    client = new SQLiteDatabaseClient(':memory:');
    db.setClientForTesting(client);
    await new SchemaMigrator(client).applyMigrations();
    const tenants = new TenantRepository(client);
    tenantA = (await tenants.create({ name: 'Clinic A', slug: 'clinic-a', plan_tier: 'enterprise', channel_plan: 'combined' })).id;
    tenantB = (await tenants.create({ name: 'Clinic B', slug: 'clinic-b', plan_tier: 'enterprise', channel_plan: 'combined' })).id;
    c = { refund: 0, refundKeys: [], verify: 0 };
  });

  afterEach(async () => {
    await client.close();
  });

  it('runs the full Verified Action flow, checkpointing every node', async () => {
    await inTenant(tenantA, async () => {
      const exec = new GraphExecutor(handlers(c), new GraphRunRepository(client));
      const res = await exec.start(refundGraph(), { request: 'refund please', amount: 400 });

      expect(res.status).toBe('completed');
      expect(res.outcome).toBe('verified');
      expect(res.state.receipt).toBeDefined();
      expect(c.refund).toBe(1);

      const cps = await new GraphRunRepository(client).listCheckpoints(res.runId);
      expect(cps.map((cp) => cp.node_id)).toEqual(['understand', 'route_intent', 'policy', 'mandate', 'refund', 'readback', 'settled', 'receipt', 'done']);
      expect(cps.every((cp) => cp.state_hash.length === 64)).toBe(true);
    });
  });

  it('a T0 question ends as informed without touching any action handler', async () => {
    await inTenant(tenantA, async () => {
      const res = await new GraphExecutor(handlers(c), new GraphRunRepository(client)).start(refundGraph(), { request: 'what are your hours?' });
      expect(res.outcome).toBe('informed');
      expect(c.refund).toBe(0);
    });
  });

  it('resumes after a crash without repeating the refund, ending in the same state as an uninterrupted run', async () => {
    await inTenant(tenantA, async () => {
      const repo = new GraphRunRepository(client);
      const clean = await new GraphExecutor(handlers({ refund: 0, refundKeys: [], verify: 0 }), repo).start(refundGraph(), { request: 'refund please', amount: 400 });

      let crashOnce = true;
      const crashing = new GraphExecutor(
        handlers(c, {
          verify: async () => {
            if (crashOnce) {
              crashOnce = false;
              throw new RunInterrupted('process died');
            }
            c.verify++;
            return { patch: { verification: { state: 'verified', observed: 'processed' } } };
          },
        }),
        repo
      );

      await expect(crashing.start(refundGraph(), { request: 'refund please', amount: 400 })).rejects.toBeInstanceOf(RunInterrupted);
      const runId = (await client.queryOne<{ id: string }>("SELECT id FROM graph_runs WHERE tenant_id = ? AND status = 'running'", [tenantA]))!.id;

      expect((await repo.getRun(runId))!.status).toBe('running'); // interrupted, not marked failed
      const resumed = await crashing.resume(runId);

      expect(resumed.outcome).toBe('verified');
      expect(c.refund).toBe(1); // the refund ran exactly once across crash + resume
      expect(hashState(resumed.state)).toBe(hashState(clean.state));
    });
  });

  it('a crash inside the tool call re-sends the SAME idempotency key so the target system can dedupe', async () => {
    await inTenant(tenantA, async () => {
      const repo = new GraphRunRepository(client);
      let die = true;
      const exec = new GraphExecutor(
        handlers(c, {
          tool: async ({ idempotencyKey }) => {
            c.refund++;
            c.refundKeys.push(idempotencyKey);
            if (die) {
              die = false;
              throw new RunInterrupted('died after calling the payment provider');
            }
            return { patch: { refund: { id: 'rfnd_123', status: 'submitted' } } };
          },
        }),
        repo
      );
      await exec.start(refundGraph(), { request: 'refund please', amount: 400 }).catch(() => undefined);
      const run = (await client.queryOne<{ id: string }>("SELECT id FROM graph_runs WHERE tenant_id = ? AND status = 'running'", [tenantA]))!;
      const res = await exec.resume(run.id);

      expect(res.outcome).toBe('verified');
      expect(c.refundKeys).toHaveLength(2);
      expect(c.refundKeys[0]).toBe(c.refundKeys[1]);
    });
  });

  it('parks at the human gate when over the mandate limit, and resumes on the decision', async () => {
    await inTenant(tenantA, async () => {
      const exec = new GraphExecutor(handlers(c), new GraphRunRepository(client));

      const parked = await exec.start(refundGraph(), { request: 'refund please', amount: 4000 });
      expect(parked.status).toBe('parked');
      expect(parked.parkReason).toBe('Refund above mandate limit');
      expect(c.refund).toBe(0);

      const approved = await exec.resume(parked.runId, { approval: { decision: 'approved', by: 'owner_1' } });
      expect(approved.outcome).toBe('verified');
      expect(c.refund).toBe(1);

      const parked2 = await exec.start(refundGraph(), { request: 'refund please', amount: 9000 });
      const rejected = await exec.resume(parked2.runId, { approval: { decision: 'rejected' } });
      expect(rejected.outcome).toBe('escalated');
      expect(c.refund).toBe(1);
      await expect(exec.resume(parked2.runId)).rejects.toThrow(/already completed/);
    });
  });

  it('a verification that never settles hits the loop bound and escalates', async () => {
    await inTenant(tenantA, async () => {
      const exec = new GraphExecutor(
        handlers(c, { verify: async () => (c.verify++, { patch: { verification: { state: 'pending' } } }) }),
        new GraphRunRepository(client)
      );
      const res = await exec.start(refundGraph(), { request: 'refund please', amount: 400 });
      expect(res.outcome).toBe('escalated');
      expect(res.error).toMatch(/maxVisits/);
      expect(c.verify).toBe(3);
      expect(res.state.receipt).toBeUndefined();
    });
  });

  it('fails honestly: missing handler, handler error, no matching edge', async () => {
    await inTenant(tenantA, async () => {
      const repo = new GraphRunRepository(client);
      const { proof, ...noProof } = handlers(c);
      const missing = await new GraphExecutor(noProof, repo).start(refundGraph(), { request: 'refund please', amount: 400 });
      expect(missing.status).toBe('failed');
      expect(missing.error).toMatch(/No handler configured for node kind 'proof'/);

      const boom = await new GraphExecutor(handlers(c, { policy: async () => { throw new Error('policy engine down'); } }), repo).start(refundGraph(), { request: 'refund please', amount: 400 });
      expect(boom.outcome).toBe('failed');
      expect(boom.error).toMatch(/policy engine down/);

      const noDefault: GraphDefinition = {
        id: 'strict_router', version: '1.0.0', entry: 'r', maxSteps: 5,
        nodes: [{ id: 'r', kind: 'router', config: {} }, { id: 'e', kind: 'end', outcome: 'informed', config: {} }],
        edges: [{ from: 'r', to: 'e', when: [{ path: 'x', op: 'eq', value: 1 }] }],
      };
      const stuck = await new GraphExecutor({}, repo).start(noDefault, { x: 2 });
      expect(stuck.status).toBe('failed');
      expect(stuck.error).toMatch(/No outgoing edge/);
    });
  });

  it('refuses to start an invalid graph', async () => {
    await inTenant(tenantA, async () => {
      const g = refundGraph();
      g.edges.push({ from: 'route_intent', to: 'refund', when: [{ path: 'intent', op: 'eq', value: 'yolo' }] });
      await expect(new GraphExecutor(handlers(c), new GraphRunRepository(client)).start(g, {})).rejects.toThrow(/policy_before_tool/);
    });
  });

  it('runs are tenant-isolated', async () => {
    const runId = await inTenant(tenantA, async () => {
      const exec = new GraphExecutor(handlers(c), new GraphRunRepository(client));
      return (await exec.start(refundGraph(), { request: 'refund please', amount: 4000 })).runId;
    });
    await inTenant(tenantB, async () => {
      const exec = new GraphExecutor(handlers(c), new GraphRunRepository(client));
      expect(await exec.getRun(runId)).toBeNull();
      await expect(exec.resume(runId, { approval: { decision: 'approved' } })).rejects.toThrow(/not found for this tenant/);
    });
    expect(c.refund).toBe(0);
  });
});
