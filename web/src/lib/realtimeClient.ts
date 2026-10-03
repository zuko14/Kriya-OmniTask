/**
 * Kriya Omnitask — Real-Time SSE Stream Client (§19 of CLAUDE1.md)
 * Implements "Backfill-then-stream", sequence integrity verification with self-healing backfill,
 * Last-Event-ID auto-reconnect with exponential backoff, and frame-throttled batch rendering.
 */

import { apiFetch } from './apiClient';

export type RealtimeEventType =
  | 'task.started'
  | 'task.completed'
  | 'task.failed'
  | 'task.escalated'
  | 'agent.state_changed'
  | 'attention.created'
  | 'approval.required'
  | 'model.degraded'
  | 'external.retrieved'
  | 'security.event'
  | 'stream.ping';

export interface RealtimeEventEnvelope {
  seq: number;
  ts: string;
  tenant_id: string;
  type: RealtimeEventType;
  agent_id?: string;
  execution_id?: string;
  payload: Record<string, any>;
}

export interface StreamInitialSnapshot {
  tenantId: string;
  snapshotAt: string;
  latestSeq: number;
  events: RealtimeEventEnvelope[];
  agentStates: Record<string, { state: string; load: number; currentTask?: string; updatedAt: string }>;
}

export interface StreamBackfillResult {
  tenantId: string;
  fromSeq: number;
  toSeq: number;
  events: RealtimeEventEnvelope[];
  count: number;
  hasMore: boolean;
}

export interface RealtimeClientOptions {
  tenantId: string;
  token?: string;
  onEvent?: (event: RealtimeEventEnvelope) => void;
  onBatchRender?: (events: RealtimeEventEnvelope[], agentStates: Record<string, any>) => void;
  onStatusChange?: (status: { isConnected: boolean; isReconnecting: boolean; error?: string }) => void;
  baseUrl?: string;
  reconnectMaxDelayMs?: number;
  batchIntervalMs?: number;
  eventSourceFactory?: (url: string) => EventSource;
}

export class RealtimeStreamClient {
  private tenantId: string;
  private token?: string;
  private baseUrl: string;
  private onEvent?: (event: RealtimeEventEnvelope) => void;
  private onBatchRender?: (events: RealtimeEventEnvelope[], agentStates: Record<string, any>) => void;
  private onStatusChange?: (status: { isConnected: boolean; isReconnecting: boolean; error?: string }) => void;
  private eventSourceFactory?: (url: string) => EventSource;

  private lastSeq: number = 0;
  private isConnected: boolean = false;
  private isReconnecting: boolean = false;
  private isDestroyed: boolean = false;
  private eventSource: EventSource | null = null;
  private reconnectTimeoutId: any = null;
  private reconnectAttempt: number = 0;
  private maxReconnectDelayMs: number = 30000;
  private batchIntervalMs: number = 16; // ~60fps frame batching (§19)

  // In-memory event buffer & state
  private eventBuffer: RealtimeEventEnvelope[] = [];
  private allEvents: RealtimeEventEnvelope[] = [];
  private agentStates: Record<string, any> = {};
  private renderTimerId: any = null;
  private isBackfilling: boolean = false;

  constructor(options: RealtimeClientOptions) {
    this.tenantId = options.tenantId;
    this.token = options.token;
    this.baseUrl = options.baseUrl || '';
    this.onEvent = options.onEvent;
    this.onBatchRender = options.onBatchRender;
    this.onStatusChange = options.onStatusChange;
    this.eventSourceFactory = options.eventSourceFactory;
    this.maxReconnectDelayMs = options.reconnectMaxDelayMs || 30000;
    this.batchIntervalMs = options.batchIntervalMs || 16;
  }

  /**
   * Initializes real-time connection using "Backfill-then-stream" rule (§19).
   */
  public async connect(): Promise<void> {
    if (this.isDestroyed) return;

    try {
      this.notifyStatus(false, true);

      // 1. Backfill initial snapshot (last 50 events + agent states)
      await this.fetchInitialSnapshot();

      // 2. Attach SSE stream
      this.attachEventSource();
    } catch (err: any) {
      this.notifyStatus(false, true, err.message);
      this.scheduleReconnect();
    }
  }

  /**
   * Disconnects and cleans up resources.
   */
  public disconnect(): void {
    this.isDestroyed = true;
    if (this.reconnectTimeoutId) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }
    if (this.renderTimerId) {
      clearInterval(this.renderTimerId);
      this.renderTimerId = null;
    }
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this.notifyStatus(false, false);
  }

  /**
   * Step 1: Initial Snapshot backfill (§19).
   */
  public async fetchInitialSnapshot(): Promise<StreamInitialSnapshot> {
    const snapshot = await apiFetch<StreamInitialSnapshot>(
      `${this.baseUrl}/api/v2/tenants/${this.tenantId}/stream/initial`
    );

    this.agentStates = { ...snapshot.agentStates };

    if (snapshot.events && snapshot.events.length > 0) {
      for (const ev of snapshot.events) {
        this.insertEventOrdered(ev);
      }
      this.lastSeq = Math.max(this.lastSeq, snapshot.latestSeq, snapshot.events[snapshot.events.length - 1].seq);
    } else {
      this.lastSeq = Math.max(this.lastSeq, snapshot.latestSeq);
    }

    this.flushBatchToRender();
    return snapshot;
  }

  /**
   * Step 2: Attach EventSource with Last-Event-ID (§19).
   */
  private attachEventSource(): void {
    if (this.isDestroyed) return;

    const streamUrl = `${this.baseUrl}/api/v2/tenants/${this.tenantId}/stream?lastEventId=${this.lastSeq}`;

    if (this.eventSourceFactory) {
      this.eventSource = this.eventSourceFactory(streamUrl);
    } else if (typeof window !== 'undefined' && 'EventSource' in window) {
      this.eventSource = new EventSource(streamUrl);
    } else {
      // In Node / non-browser test environment without factory
      return;
    }

    this.eventSource.onopen = () => {
      this.isConnected = true;
      this.isReconnecting = false;
      this.reconnectAttempt = 0;
      this.notifyStatus(true, false);
      this.startRenderLoop();
    };

    this.eventSource.onerror = () => {
      if (this.isDestroyed) return;
      this.isConnected = false;
      this.isReconnecting = true;
      this.notifyStatus(false, true, 'SSE Stream disconnected. Reconnecting...');
      if (this.eventSource) {
        this.eventSource.close();
        this.eventSource = null;
      }
      this.scheduleReconnect();
    };

    this.eventSource.onmessage = (event: MessageEvent) => {
      if (!event.data || event.data.startsWith(': ping')) return;
      try {
        const envelope: RealtimeEventEnvelope = JSON.parse(event.data);
        this.handleIncomingEvent(envelope);
      } catch (err) {
        // Ignore unparseable frames
      }
    };
  }

  /**
   * Handles incoming event with Sequence Integrity & Gap Detection (§19).
   */
  public async handleIncomingEvent(envelope: RealtimeEventEnvelope): Promise<void> {
    if (envelope.type === 'stream.ping') return;

    // Sequence integrity check: Monotonic sequence (§19)
    if (this.lastSeq > 0 && envelope.seq > this.lastSeq + 1) {
      // Sequence Gap Detected! Trigger self-healing backfill (§19)
      const missingFrom = this.lastSeq + 1;
      const missingTo = envelope.seq - 1;
      await this.healSequenceGap(missingFrom, missingTo);
    }

    this.lastSeq = Math.max(this.lastSeq, envelope.seq);
    this.insertEventOrdered(envelope);
    this.updateAgentStateFromEvent(envelope);

    this.onEvent?.(envelope);
  }

  /**
   * Gap Self-Healing Backfill: fetches missing sequence window (§19).
   */
  public async healSequenceGap(fromSeq: number, toSeq: number): Promise<void> {
    if (this.isBackfilling) return;
    this.isBackfilling = true;

    try {
      const backfill = await apiFetch<StreamBackfillResult>(
        `${this.baseUrl}/api/v2/tenants/${this.tenantId}/stream/backfill?from=${fromSeq}&to=${toSeq}`
      );

      if (backfill.events && backfill.events.length > 0) {
        for (const ev of backfill.events) {
          this.insertEventOrdered(ev);
          this.updateAgentStateFromEvent(ev);
        }
      }
    } catch {
      // Continue gracefully if backfill fails
    } finally {
      this.isBackfilling = false;
    }
  }

  private insertEventOrdered(envelope: RealtimeEventEnvelope): void {
    // Avoid duplicates
    if (this.allEvents.some((e) => e.seq === envelope.seq)) return;

    this.allEvents.push(envelope);
    this.allEvents.sort((a, b) => a.seq - b.seq);

    this.eventBuffer.push(envelope);
  }

  private updateAgentStateFromEvent(envelope: RealtimeEventEnvelope): void {
    if (!envelope.agent_id) return;
    const agentId = envelope.agent_id;
    const current = this.agentStates[agentId] || { state: 'live', load: 0.5, updatedAt: envelope.ts };

    if (envelope.type === 'agent.state_changed') {
      current.state = envelope.payload?.toState || current.state;
      current.load = typeof envelope.payload?.load === 'number' ? envelope.payload.load : current.load;
    } else if (envelope.type === 'task.started') {
      current.currentTask = envelope.payload?.taskSummary || envelope.payload?.taskType;
    } else if (envelope.type === 'task.completed' || envelope.type === 'task.failed') {
      current.currentTask = undefined;
    }

    current.updatedAt = envelope.ts;
    this.agentStates[agentId] = current;
  }

  private startRenderLoop(): void {
    if (this.renderTimerId) return;
    this.renderTimerId = setInterval(() => {
      this.flushBatchToRender();
    }, this.batchIntervalMs);
  }

  private flushBatchToRender(): void {
    if (this.onBatchRender) {
      this.onBatchRender([...this.allEvents], { ...this.agentStates });
    }
    this.eventBuffer = [];
  }

  private scheduleReconnect(): void {
    if (this.isDestroyed || this.reconnectTimeoutId) return;

    this.reconnectAttempt += 1;
    // Exponential backoff, capped at 30s (§19)
    const delay = Math.min(Math.pow(2, this.reconnectAttempt) * 500, this.maxReconnectDelayMs);

    this.reconnectTimeoutId = setTimeout(() => {
      this.reconnectTimeoutId = null;
      if (!this.isDestroyed) {
        this.attachEventSource();
      }
    }, delay);
  }

  private notifyStatus(connected: boolean, reconnecting: boolean, error?: string): void {
    this.isConnected = connected;
    this.isReconnecting = reconnecting;
    this.onStatusChange?.({ isConnected: connected, isReconnecting: reconnecting, error });
  }

  // Getters
  public getEvents(): RealtimeEventEnvelope[] {
    return [...this.allEvents];
  }

  public getAgentStates(): Record<string, any> {
    return { ...this.agentStates };
  }

  public getLastSeq(): number {
    return this.lastSeq;
  }

  public getStatus() {
    return { isConnected: this.isConnected, isReconnecting: this.isReconnecting };
  }
}
