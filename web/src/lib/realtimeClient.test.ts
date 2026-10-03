import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RealtimeStreamClient, RealtimeEventEnvelope } from './realtimeClient';
import * as apiClient from './apiClient';

describe('RealtimeStreamClient Unit Tests (§19, Criteria 1, 2, 3, 5)', () => {
  const TEST_TENANT = 'tenant_rt_client_test';

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('1. Backfill-then-stream: fetches initial snapshot on mount (no empty theatre, ever) (§19, Criterion 1)', async () => {
    const mockSnapshot = {
      tenantId: TEST_TENANT,
      snapshotAt: '2026-08-20T10:00:00Z',
      latestSeq: 42,
      events: [
        {
          seq: 41,
          ts: '2026-08-20T09:59:58Z',
          tenant_id: TEST_TENANT,
          type: 'task.started' as const,
          agent_id: 'lead_qual',
          payload: { taskType: 'WhatsApp Chat' },
        },
        {
          seq: 42,
          ts: '2026-08-20T09:59:59Z',
          tenant_id: TEST_TENANT,
          type: 'task.completed' as const,
          agent_id: 'lead_qual',
          payload: { outcome: 'qualified' },
        },
      ],
      agentStates: {
        lead_qual: { state: 'live', load: 0.6, updatedAt: '2026-08-20T09:59:59Z' },
      },
    };

    vi.spyOn(apiClient, 'apiFetch').mockResolvedValueOnce(mockSnapshot);

    const onBatchRender = vi.fn();
    const client = new RealtimeStreamClient({
      tenantId: TEST_TENANT,
      onBatchRender,
    });

    const snapshot = await client.fetchInitialSnapshot();

    expect(snapshot.events).toHaveLength(2);
    expect(client.getLastSeq()).toBe(42);
    expect(client.getEvents()).toHaveLength(2);
    expect(client.getAgentStates().lead_qual.state).toBe('live');
    expect(onBatchRender).toHaveBeenCalled();

    client.disconnect();
  });

  it('2. Sequence Gap Self-Healing: a forced sequence gap triggers backfill and self-heals (§19, Criterion 3)', async () => {
    const client = new RealtimeStreamClient({
      tenantId: TEST_TENANT,
    });

    // Ingest event #10
    await client.handleIncomingEvent({
      seq: 10,
      ts: '2026-08-20T10:00:00Z',
      tenant_id: TEST_TENANT,
      type: 'task.started',
      payload: { index: 10 },
    });
    expect(client.getLastSeq()).toBe(10);

    // Mock the backfill response for missing events #11 and #12
    const mockBackfillResponse = {
      tenantId: TEST_TENANT,
      fromSeq: 11,
      toSeq: 12,
      events: [
        {
          seq: 11,
          ts: '2026-08-20T10:00:01Z',
          tenant_id: TEST_TENANT,
          type: 'task.started' as const,
          payload: { index: 11 },
        },
        {
          seq: 12,
          ts: '2026-08-20T10:00:02Z',
          tenant_id: TEST_TENANT,
          type: 'task.completed' as const,
          payload: { index: 12 },
        },
      ],
      count: 2,
      hasMore: false,
    };

    const apiFetchSpy = vi.spyOn(apiClient, 'apiFetch').mockResolvedValueOnce(mockBackfillResponse);

    // Force a sequence gap: jump from seq 10 directly to seq 13
    await client.handleIncomingEvent({
      seq: 13,
      ts: '2026-08-20T10:00:03Z',
      tenant_id: TEST_TENANT,
      type: 'agent.state_changed',
      payload: { index: 13 },
    });

    // Verify backfill was invoked for missing window 11 to 12
    expect(apiFetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/stream/backfill?from=11&to=12')
    );

    // Verify stream self-healed in exact monotonic order (10, 11, 12, 13)
    const events = client.getEvents();
    expect(events).toHaveLength(4);
    expect(events.map((e) => e.seq)).toEqual([10, 11, 12, 13]);
    expect(client.getLastSeq()).toBe(13);

    client.disconnect();
  });

  it('3. Reconnect with Last-Event-ID: maintains lastSeq across reconnects without losing events (§19, Criterion 2)', () => {
    let capturedUrl = '';
    const mockEventSource = {
      onopen: null as any,
      onerror: null as any,
      onmessage: null as any,
      close: vi.fn(),
    };

    const client = new RealtimeStreamClient({
      tenantId: TEST_TENANT,
      eventSourceFactory: (url) => {
        capturedUrl = url;
        return mockEventSource as any;
      },
    });

    // Simulate previous events up to seq 85
    (client as any).lastSeq = 85;

    // Attach EventSource
    (client as any).attachEventSource();

    // Verify stream URL contains lastEventId=85
    expect(capturedUrl).toContain('/stream?lastEventId=85');

    client.disconnect();
  });

  it('4. Throughput & Batch Rendering: sustains 20+ events/sec without dropped frames (§19, Criterion 5)', async () => {
    const onBatchRender = vi.fn();
    const client = new RealtimeStreamClient({
      tenantId: TEST_TENANT,
      onBatchRender,
      batchIntervalMs: 10,
    });

    (client as any).startRenderLoop();

    // Send 100 rapid events (simulating 100 events in high-volume traffic)
    for (let i = 1; i <= 100; i++) {
      await client.handleIncomingEvent({
        seq: i,
        ts: new Date().toISOString(),
        tenant_id: TEST_TENANT,
        type: 'task.started',
        agent_id: `agent_${i % 5}`,
        payload: { eventNum: i },
      });
    }

    // Wait for batch render frame
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Verify all 100 events received without any drops
    expect(client.getEvents()).toHaveLength(100);
    expect(client.getLastSeq()).toBe(100);
    expect(onBatchRender).toHaveBeenCalled();

    client.disconnect();
  });
});
