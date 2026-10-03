import { describe, it, expect, beforeEach } from 'vitest';
import { RealtimeEventRepository } from '../../src/realtime/repositories/realtimeEventRepository.js';
import { db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';

describe('RealtimeEventRepository Unit Tests (§19, M9)', () => {
  let repo: RealtimeEventRepository;
  const TEST_TENANT = 'tenant_rt_repo_test';

  beforeEach(async () => {
    const client = db.getClient();
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();
    repo = new RealtimeEventRepository(client);

    const now = new Date().toISOString();
    await client.execute(
      `INSERT OR REPLACE INTO tenants (id, name, slug, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?);`,
      [TEST_TENANT, 'Realtime Repo Test Tenant', 'rt-repo-test', now, now]
    );
  });

  it('appends events with strictly monotonic sequence numbers (§19)', async () => {
    const ev1 = await repo.appendEvent({
      tenantId: TEST_TENANT,
      type: 'task.started',
      agentId: 'lead_qual',
      executionId: 'exec_101',
      payload: { taskType: 'WhatsApp Chat', customerPhone: '+919876543210' },
    });

    const ev2 = await repo.appendEvent({
      tenantId: TEST_TENANT,
      type: 'task.completed',
      agentId: 'lead_qual',
      executionId: 'exec_101',
      payload: { outcome: 'lead_qualified' },
    });

    const ev3 = await repo.appendEvent({
      tenantId: TEST_TENANT,
      type: 'agent.state_changed',
      agentId: 'lead_qual',
      payload: { toState: 'idle', load: 0.2 },
    });

    expect(ev1.seq).toBeGreaterThan(0);
    expect(ev2.seq).toBe(ev1.seq + 1);
    expect(ev3.seq).toBe(ev2.seq + 1);
    expect(ev1.tenant_id).toBe(TEST_TENANT);
    expect(ev1.type).toBe('task.started');
  });

  it('retrieves latest events in chronological order for backfill-then-stream (§19)', async () => {
    for (let i = 1; i <= 10; i++) {
      await repo.appendEvent({
        tenantId: TEST_TENANT,
        type: 'task.started',
        agentId: `agent_${i}`,
        payload: { index: i },
      });
    }

    const latest = await repo.getLatestEvents(TEST_TENANT, 5);
    expect(latest).toHaveLength(5);
    // Ascending order
    expect(latest[0].seq).toBeLessThan(latest[1].seq);
    expect(latest[4].payload.index).toBe(10);
  });

  it('retrieves explicit range for sequence gap self-healing backfill (§19)', async () => {
    const created = [];
    for (let i = 1; i <= 6; i++) {
      const ev = await repo.appendEvent({
        tenantId: TEST_TENANT,
        type: 'task.started',
        payload: { i },
      });
      created.push(ev);
    }

    const fromSeq = created[1].seq;
    const toSeq = created[4].seq;

    const backfill = await repo.getBackfill(TEST_TENANT, fromSeq, toSeq);
    expect(backfill.count).toBe(4);
    expect(backfill.events[0].seq).toBe(fromSeq);
    expect(backfill.events[3].seq).toBe(toSeq);
  });

  it('retrieves events since Last-Event-ID for reconnection (§19)', async () => {
    const ev1 = await repo.appendEvent({ tenantId: TEST_TENANT, type: 'task.started' });
    const ev2 = await repo.appendEvent({ tenantId: TEST_TENANT, type: 'task.completed' });
    const ev3 = await repo.appendEvent({ tenantId: TEST_TENANT, type: 'model.degraded' });

    const missed = await repo.getEventsSince(TEST_TENANT, ev1.seq);
    expect(missed).toHaveLength(2);
    expect(missed[0].seq).toBe(ev2.seq);
    expect(missed[1].seq).toBe(ev3.seq);
  });

  it('derives agent states from recent event stream (§19)', async () => {
    await repo.appendEvent({
      tenantId: TEST_TENANT,
      type: 'agent.state_changed',
      agentId: 'support_agent',
      payload: { toState: 'attention', load: 0.95 },
    });

    const states = await repo.getAgentStates(TEST_TENANT);
    expect(states.support_agent).toBeDefined();
    expect(states.support_agent.state).toBe('attention');
    expect(states.support_agent.load).toBe(0.95);
  });
});
