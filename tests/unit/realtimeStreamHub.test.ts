import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RealtimeStreamHub } from '../../src/realtime/services/realtimeStreamHub.js';
import { RealtimeEventRepository } from '../../src/realtime/repositories/realtimeEventRepository.js';
import { db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';

describe('RealtimeStreamHub Unit Tests (§19, Criteria 4)', () => {
  let repo: RealtimeEventRepository;
  let hub: RealtimeStreamHub;
  const TENANT_A = 'tenant_rt_hub_a';
  const TENANT_B = 'tenant_rt_hub_b';

  beforeEach(async () => {
    const client = db.getClient();
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();
    repo = new RealtimeEventRepository(client);
    hub = new RealtimeStreamHub(repo);

    const now = new Date().toISOString();
    await client.execute(
      `INSERT OR REPLACE INTO tenants (id, name, slug, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?);`,
      [TENANT_A, 'Tenant A', 'tenant-a', now, now]
    );
    await client.execute(
      `INSERT OR REPLACE INTO tenants (id, name, slug, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?);`,
      [TENANT_B, 'Tenant B', 'tenant-b', now, now]
    );
  });

  it('proves server-side tenant isolation: Tenant A client NEVER receives Tenant B events (§19, Criterion 4)', async () => {
    const tenantAListener = vi.fn();
    const tenantBListener = vi.fn();

    const unsubA = hub.subscribe(TENANT_A, tenantAListener);
    const unsubB = hub.subscribe(TENANT_B, tenantBListener);

    // Publish event for Tenant A
    await hub.publishEvent({
      tenantId: TENANT_A,
      type: 'task.started',
      agentId: 'lead_qual',
      payload: { secret: 'Tenant A Confidential Data' },
    });

    // Publish event for Tenant B
    await hub.publishEvent({
      tenantId: TENANT_B,
      type: 'security.event',
      agentId: 'firewall',
      payload: { secret: 'Tenant B Confidential Data' },
    });

    // Tenant A listener ONLY received Tenant A's event
    expect(tenantAListener).toHaveBeenCalledTimes(1);
    expect(tenantAListener.mock.calls[0][0].tenant_id).toBe(TENANT_A);
    expect(tenantAListener.mock.calls[0][0].payload.secret).toBe('Tenant A Confidential Data');

    // Tenant B listener ONLY received Tenant B's event
    expect(tenantBListener).toHaveBeenCalledTimes(1);
    expect(tenantBListener.mock.calls[0][0].tenant_id).toBe(TENANT_B);
    expect(tenantBListener.mock.calls[0][0].payload.secret).toBe('Tenant B Confidential Data');

    unsubA();
    unsubB();
  });

  it('broadcasts event to multiple active subscribers of the same tenant', async () => {
    const listener1 = vi.fn();
    const listener2 = vi.fn();

    const unsub1 = hub.subscribe(TENANT_A, listener1);
    const unsub2 = hub.subscribe(TENANT_A, listener2);

    expect(hub.getSubscriberCount(TENANT_A)).toBe(2);

    await hub.publishEvent({
      tenantId: TENANT_A,
      type: 'attention.created',
      payload: { reason: 'SLA Breach Warning' },
    });

    expect(listener1).toHaveBeenCalledTimes(1);
    expect(listener2).toHaveBeenCalledTimes(1);

    unsub1();
    expect(hub.getSubscriberCount(TENANT_A)).toBe(1);
    unsub2();
    expect(hub.getSubscriberCount(TENANT_A)).toBe(0);
  });
});
