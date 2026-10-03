/**
 * Kriya Omnitask — Real-Time Stream Hub (§19)
 * Coordinates tenant-isolated pub/sub distribution, persistence, and SSE event streaming.
 *
 * HARD RULE (§19):
 * Server-side tenant filtering: The server filters by tenant BEFORE emitting.
 * Never emit another tenant's event to a stream client.
 */

import { RealtimeEventRepository } from '../repositories/realtimeEventRepository.js';
import {
  PublishRealtimeEventInput,
  RealtimeEventEnvelope,
  StreamInitialSnapshot,
} from '../types/realtimeTypes.js';
import { logger } from '../../core/logger/logger.js';

export type StreamClientListener = (event: RealtimeEventEnvelope) => void;

export class RealtimeStreamHub {
  private repo: RealtimeEventRepository;
  // Map of tenantId -> Array of subscriber callback functions
  private tenantSubscribers: Map<string, Set<StreamClientListener>> = new Map();

  constructor(repo?: RealtimeEventRepository) {
    this.repo = repo || new RealtimeEventRepository();
  }

  /**
   * Publishes an event to the persistent event ledger and fans out to tenant-isolated subscribers (§19).
   */
  public async publishEvent(input: PublishRealtimeEventInput): Promise<RealtimeEventEnvelope> {
    const envelope = await this.repo.appendEvent(input);

    // Fan-out strictly to subscribers of this exact tenantId
    const subscribers = this.tenantSubscribers.get(input.tenantId);
    if (subscribers && subscribers.size > 0) {
      for (const listener of subscribers) {
        try {
          listener(envelope);
        } catch (err) {
          logger.warn(`Error dispatching realtime event seq=${envelope.seq} to subscriber`, { err });
        }
      }
    }

    return envelope;
  }

  /**
   * Subscribes an SSE client to the real-time stream of a specific tenant.
   * Returns an unsubscribe function.
   */
  public subscribe(tenantId: string, listener: StreamClientListener): () => void {
    if (!this.tenantSubscribers.has(tenantId)) {
      this.tenantSubscribers.set(tenantId, new Set());
    }

    this.tenantSubscribers.get(tenantId)!.add(listener);

    return () => {
      const subs = this.tenantSubscribers.get(tenantId);
      if (subs) {
        subs.delete(listener);
        if (subs.size === 0) {
          this.tenantSubscribers.delete(tenantId);
        }
      }
    };
  }

  /**
   * Gets the initial snapshot for "Backfill then stream" (§19).
   */
  public async getInitialSnapshot(tenantId: string, limit: number = 50): Promise<StreamInitialSnapshot> {
    const events = await this.repo.getLatestEvents(tenantId, limit);
    const agentStates = await this.repo.getAgentStates(tenantId);
    const latestSeq = events.length > 0 ? events[events.length - 1].seq : await this.repo.getLatestSeq(tenantId);

    return {
      tenantId,
      snapshotAt: new Date().toISOString(),
      latestSeq,
      events,
      agentStates,
    };
  }

  /**
   * Gets backfill range for gap self-healing (§19).
   */
  public async getBackfill(tenantId: string, fromSeq: number, toSeq: number) {
    return this.repo.getBackfill(tenantId, fromSeq, toSeq);
  }

  /**
   * Gets events since Last-Event-ID for reconnection (§19).
   */
  public async getEventsSince(tenantId: string, afterSeq: number, limit?: number) {
    return this.repo.getEventsSince(tenantId, afterSeq, limit);
  }

  /**
   * Returns number of active subscribers for a tenant.
   */
  public getSubscriberCount(tenantId: string): number {
    return this.tenantSubscribers.get(tenantId)?.size || 0;
  }
}

// Global Singleton Instance for workforce events
export const realtimeStreamHub = new RealtimeStreamHub();
