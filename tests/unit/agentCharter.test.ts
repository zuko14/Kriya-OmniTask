/**
 * Kriya Omnitask — Agent charter tests (docs/kriya WP-4.1)
 * Publish/version/immutability, registry-derived tiers, autonomy cap → human gate,
 * context minimisation, receipts naming the charter version, tamper detection, tenant isolation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { db, SQLiteDatabaseClient } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { TenantContextManager } from '../../src/core/context/tenantContext.js';
import { TenantRepository } from '../../src/storage/repositories/tenantRepository.js';
import { AgentRepository } from '../../src/agents/repositories/agentRepository.js';
import { AgentCharterInput, CharterService, charterToLoopSpec } from '../../src/agents/charter/agentCharter.js';
import { ToolRegistryService } from '../../src/tools/registry/toolRegistry.js';
import { buildAgentLoop } from '../../src/runtime/graph/agentLoop.js';
import { createRuntimeHandlers } from '../../src/runtime/graph/handlers.js';
import { GraphExecutor } from '../../src/runtime/graph/executor.js';
import { GraphRunRepository } from '../../src/runtime/graph/graphRunRepository.js';
import { ProofService } from '../../src/trust/proof/proofService.js';
import { MandateService } from '../../src/trust/mandate/mandateService.js';
import { ModelGateway, ModelCandidate } from '../../src/model/gateway/modelGateway.js';
import { LLMProviderAdapter } from '../../src/orchestration/routing/modelRouter.js';

const notes = new Map<string, string>();
const registry = new ToolRegistryService();
registry.registerTool({
  definition: { slug: 'chr_lookup', name: 'Lookup', description: 'Read a record', category: 'crm', riskTier: 'LOW', requiresApproval: false, inputSchema: {}, outputSchema: {}, isSystem: false },
  inputValidator: z.object({ id: z.string() }),
  handler: async (input) => ({ id: input.id, name: 'Ravi' }),
  verify: async () => ({ state: 'verified' }),
});
registry.registerTool({
  definition: { slug: 'chr_write_note', name: 'Write note', description: 'Write a CRM note', category: 'crm', riskTier: 'MEDIUM', requiresApproval: false, inputSchema: {}, outputSchema: {}, isSystem: false },
  inputValidator: z.object({ text: z.string() }),
  handler: async (input, ctx) => {
    const noteId = `note_${ctx.idempotencyKey}`;
    notes.set(noteId, String(input.text));
    return { noteId };
  },
  verify: async (input, output) => (notes.get(String(output.noteId)) === input.text ? { state: 'verified' } : { state: 'mismatch' }),
});

const charter = (over: Partial<AgentCharterInput> = {}): AgentCharterInput => ({
  slug: 'intake',
  version: '1.0.0',
  owns: 'first contact and intent capture',
  goal: 'You are the intake agent. Record what the customer needs.',
  tools: [
    { slug: 'chr_lookup', description: 'args {id}: read the customer record' },
    { slug: 'chr_write_note', description: 'args {text}: write a note on the customer record' },
  ],
  autonomyTierCap: 'T1',
  owner: 'ops_lead',
  ...over,
});

const scripted = (plans: object[], seen?: unknown[]) => {
  let i = 0;
  return new ModelGateway({
    adapterFor: (_c: ModelCandidate): LLMProviderAdapter => ({
      async execute(_model: string, _system: string, userPrompt: string) {
        seen?.push(userPrompt);
        return { content: JSON.stringify(plans[Math.min(i++, plans.length - 1)]), promptTokens: 10, completionTokens: 10, costUsd: 0.00001 };
      },
    }),
  });
};

describe('Agent charters (WP-4.1)', () => {
  let client: SQLiteDatabaseClient;
  let tenantA: string;
  let tenantB: string;
  const inA = <T>(fn: () => Promise<T>) => TenantContextManager.withTenant(tenantA, 'default', fn, { userId: 'owner_1', roles: ['owner'] });
  const inB = <T>(fn: () => Promise<T>) => TenantContextManager.withTenant(tenantB, 'default', fn, { userId: 'owner_2', roles: ['owner'] });
  const registerAgent = () =>
    new AgentRepository(client).create({ slug: 'intake', name: 'Intake', category: 'specialist', department: 'support', autonomy_level: 1, risk_tier: 'LOW', status: 'idle', version: '0.0.0', is_system: 0, config_json: '{}' });

  beforeEach(async () => {
    client = new SQLiteDatabaseClient(':memory:');
    db.setClientForTesting(client);
    await new SchemaMigrator(client).applyMigrations();
    const tenants = new TenantRepository(client);
    tenantA = (await tenants.create({ name: 'Clinic A', slug: 'chr-a', plan_tier: 'enterprise', channel_plan: 'combined' })).id;
    tenantB = (await tenants.create({ name: 'Clinic B', slug: 'chr-b', plan_tier: 'enterprise', channel_plan: 'combined' })).id;
    notes.clear();
  });

  afterEach(async () => {
    await client.close();
  });

  it('publishes versions append-only: identical re-publish is a no-op, changed content under the same version is refused', async () => {
    await inA(async () => {
      await registerAgent();
      const svc = new CharterService(registry, client);
      const v1 = await svc.publish(charter(), 'owner_1');
      expect((await svc.publish(charter(), 'owner_1')).hash).toBe(v1.hash);
      await expect(svc.publish(charter({ goal: 'You are the intake agent. Be more aggressive.' }), 'owner_1')).rejects.toThrow(/already published/);

      await svc.publish(charter({ version: '1.10.0', autonomyTierCap: 'T0' }), 'owner_1');
      await svc.publish(charter({ version: '1.9.0' }), 'owner_1');
      expect((await svc.history('intake')).map((c) => c.charter.version)).toEqual(['1.0.0', '1.9.0', '1.10.0']);
      expect((await svc.get('intake'))!.charter.version).toBe('1.10.0'); // semver, not string order
      expect((await svc.get('intake', '1.0.0'))!.charter.autonomyTierCap).toBe('T1');
      expect((await new AgentRepository(client).findBySlug('intake'))!.version).toBe('1.9.0'); // last published
    });
  });

  it('refuses unknown tools, unknown fields, duplicate tools, and agents that are not registered', async () => {
    await inA(async () => {
      const svc = new CharterService(registry, client);
      await expect(svc.publish(charter(), 'owner_1')).rejects.toThrow(/register the agent/);
      await registerAgent();
      await expect(svc.publish(charter({ tools: [{ slug: 'chr_delete_all', description: 'deletes everything' }] }), 'owner_1')).rejects.toThrow(/not registered/);
      await expect(svc.publish({ ...charter(), riskOverride: 'T0' } as AgentCharterInput, 'owner_1')).rejects.toThrow();
      await expect(svc.publish(charter({ tools: [{ slug: 'chr_lookup', description: 'a lookup' }, { slug: 'chr_lookup', description: 'b lookup' }] }), 'owner_1')).rejects.toThrow(/unique/);
    });
  });

  it('takes tiers from the tool registry and gates tools above the autonomy cap', () => {
    const t1 = charterToLoopSpec(charter({ autonomyTierCap: 'T1' }), registry).tools;
    expect(t1.map((t) => [t.slug, t.tier, !!t.requireApproval])).toEqual([['chr_lookup', 'T0', false], ['chr_write_note', 'T1', false]]);
    const t0 = charterToLoopSpec(charter({ autonomyTierCap: 'T0' }), registry).tools;
    expect(t0.find((t) => t.slug === 'chr_write_note')!.requireApproval).toBe(true);
  });

  it('a T0-capped agent parks before a T1 write, runs only on approval, and receipts name the charter version', async () => {
    await inA(async () => {
      await registerAgent();
      const published = await new CharterService(registry, client).publish(charter({ version: '2.0.0', autonomyTierCap: 'T0' }), 'owner_1');
      const gateway = scripted([
        { action: 'tool', tool: 'chr_write_note', args: { text: 'wants a cardiology slot' }, reason: 'record need' },
        { action: 'finish', answer: 'Noted.', reason: 'done' },
      ]);
      const loop = buildAgentLoop(charterToLoopSpec(published.charter, registry));
      const { handlers, compensator } = createRuntimeHandlers({ agentSlug: 'intake', agentVersion: published.charter.version, gateway, schemas: loop.schemas, rules: loop.rules, toolRegistry: registry, proofService: new ProofService(client), mandateService: new MandateService(client) });
      const exec = new GraphExecutor(handlers, new GraphRunRepository(client), compensator);

      const parked = await exec.start(loop.graph, { request: 'I need a heart doctor' });
      expect(parked.status).toBe('parked');
      expect(notes.size).toBe(0);

      const done = await exec.resume(parked.runId, { approval: { decision: 'approved', by: 'owner_1' } });
      expect(done.outcome).toBe('verified');
      expect(notes.size).toBe(1);
      const [receipt] = (await new ProofService(client).exportBundle()).receipts;
      expect(receipt.body.actor).toMatchObject({ agentSlug: 'intake', agentVersion: '2.0.0', humanApproverId: 'owner_1' });
    });
  });

  it('a rejected approval ends escalated and executes nothing', async () => {
    await inA(async () => {
      const loop = buildAgentLoop(charterToLoopSpec(charter({ autonomyTierCap: 'T0' }), registry));
      const gateway = scripted([{ action: 'tool', tool: 'chr_write_note', args: { text: 'x' }, reason: 'r' }]);
      const { handlers, compensator } = createRuntimeHandlers({ agentSlug: 'intake', gateway, schemas: loop.schemas, rules: loop.rules, toolRegistry: registry, proofService: new ProofService(client) });
      const exec = new GraphExecutor(handlers, new GraphRunRepository(client), compensator);
      const parked = await exec.start(loop.graph, { request: 'note this' });
      const res = await exec.resume(parked.runId, { approval: { decision: 'rejected', by: 'owner_1' } });
      expect(res.outcome).toBe('escalated');
      expect(notes.size).toBe(0);
    });
  });

  it('the planning model sees only the charter data scope', async () => {
    await inA(async () => {
      const seen: unknown[] = [];
      const loop = buildAgentLoop(charterToLoopSpec(charter({ dataScope: ['context.customer'] }), registry));
      const { handlers, compensator } = createRuntimeHandlers({ agentSlug: 'intake', gateway: scripted([{ action: 'finish', answer: 'ok', reason: 'r' }], seen), schemas: loop.schemas, rules: loop.rules, toolRegistry: registry });
      await new GraphExecutor(handlers, new GraphRunRepository(client), compensator).start(loop.graph, {
        request: 'hi',
        context: { customer: { name: 'Ravi' }, billing: { card: '4111-1111' } },
      });
      expect(JSON.stringify(seen)).toContain('Ravi');
      expect(JSON.stringify(seen)).not.toContain('4111');
    });
  });

  it('detects a tampered stored charter and keeps charters tenant-isolated', async () => {
    await inA(async () => {
      await registerAgent();
      await new CharterService(registry, client).publish(charter(), 'owner_1');
    });
    await inB(async () => {
      const svc = new CharterService(registry, client);
      expect(await svc.get('intake')).toBeNull();
      await expect(svc.publish(charter(), 'owner_2')).rejects.toThrow(/register the agent/);
    });
    await client.execute(`UPDATE agent_charters SET charter_json = replace(charter_json, '"T1"', '"T3"') WHERE tenant_id = ?`, [tenantA]);
    await inA(async () => {
      await expect(new CharterService(registry, client).get('intake', '1.0.0')).rejects.toThrow(/integrity/);
    });
  });
});
