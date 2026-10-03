/**
 * Kriya Omnitask — Real-Time Event Ledger Repository (§19)
 * Provides monotonic sequence generation, stream appending, backfill queries, and agent state rollups.
 */

import { DatabaseClient, db } from '../../storage/db.js';
import {
  PublishRealtimeEventInput,
  RealtimeEventEnvelope,
  RealtimeEventRecord,
  StreamBackfillResult,
} from '../types/realtimeTypes.js';

export class RealtimeEventRepository {
  private client: DatabaseClient;

  constructor(client?: DatabaseClient) {
    this.client = client || db.getClient();
  }

  /**
   * Appends an event to the tenant's real-time monotonic stream (§19).
   */
  public async appendEvent(input: PublishRealtimeEventInput): Promise<RealtimeEventEnvelope> {
    const ts = input.ts || new Date().toISOString();
    const now = new Date().toISOString();
    const payloadJson = JSON.stringify(input.payload || {});

    // SQLite AUTOINCREMENT generates strictly monotonic integers
    await this.client.execute(
      `INSERT INTO realtime_event_stream (
        tenant_id, ts, type, agent_id, execution_id, payload_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?);`,
      [
        input.tenantId,
        ts,
        input.type,
        input.agentId || null,
        input.executionId || null,
        payloadJson,
        now,
      ]
    );

    // Fetch the inserted record with its generated seq
    const rows = await this.client.query<RealtimeEventRecord>(
      `SELECT seq, tenant_id, ts, type, agent_id, execution_id, payload_json, created_at
       FROM realtime_event_stream
       WHERE tenant_id = ?
       ORDER BY seq DESC
       LIMIT 1;`,
      [input.tenantId]
    );

    if (rows.length === 0) {
      throw new Error(`Failed to append realtime event for tenant ${input.tenantId}`);
    }

    return this.mapRecordToEnvelope(rows[0]);
  }

  /**
   * Retrieves events occurring after `afterSeq` for `Last-Event-ID` reconnection (§19).
   */
  public async getEventsSince(
    tenantId: string,
    afterSeq: number,
    limit: number = 100
  ): Promise<RealtimeEventEnvelope[]> {
    const rows = await this.client.query<RealtimeEventRecord>(
      `SELECT seq, tenant_id, ts, type, agent_id, execution_id, payload_json, created_at
       FROM realtime_event_stream
       WHERE tenant_id = ? AND seq > ?
       ORDER BY seq ASC
       LIMIT ?;`,
      [tenantId, afterSeq, limit]
    );

    return rows.map((r) => this.mapRecordToEnvelope(r));
  }

  /**
   * Retrieves an explicit sequence range for gap self-healing backfill (§19).
   */
  public async getBackfill(
    tenantId: string,
    fromSeq: number,
    toSeq: number,
    limit: number = 200
  ): Promise<StreamBackfillResult> {
    const rows = await this.client.query<RealtimeEventRecord>(
      `SELECT seq, tenant_id, ts, type, agent_id, execution_id, payload_json, created_at
       FROM realtime_event_stream
       WHERE tenant_id = ? AND seq >= ? AND seq <= ?
       ORDER BY seq ASC
       LIMIT ?;`,
      [tenantId, fromSeq, toSeq, limit]
    );

    const events = rows.map((r) => this.mapRecordToEnvelope(r));
    return {
      tenantId,
      fromSeq,
      toSeq,
      events,
      count: events.length,
      hasMore: events.length === limit,
    };
  }

  /**
   * Retrieves the last N events for initial mount snapshot ("Backfill then stream" §19).
   */
  public async getLatestEvents(tenantId: string, limit: number = 50): Promise<RealtimeEventEnvelope[]> {
    const rows = await this.client.query<RealtimeEventRecord>(
      `SELECT seq, tenant_id, ts, type, agent_id, execution_id, payload_json, created_at
       FROM realtime_event_stream
       WHERE tenant_id = ?
       ORDER BY seq DESC
       LIMIT ?;`,
      [tenantId, limit]
    );

    // Return in ascending chronological sequence
    return rows.reverse().map((r) => this.mapRecordToEnvelope(r));
  }

  /**
   * Retrieves the highest sequence number for a tenant.
   */
  public async getLatestSeq(tenantId: string): Promise<number> {
    const rows = await this.client.query<{ max_seq: number | null }>(
      `SELECT MAX(seq) as max_seq FROM realtime_event_stream WHERE tenant_id = ?;`,
      [tenantId]
    );
    return rows[0]?.max_seq || 0;
  }

  /**
   * Derives current state of active agents from recent state events (§19).
   */
  public async getAgentStates(
    tenantId: string
  ): Promise<Record<string, { state: string; load: number; currentTask?: string; updatedAt: string }>> {
    const rows = await this.client.query<RealtimeEventRecord>(
      `SELECT seq, tenant_id, ts, type, agent_id, execution_id, payload_json, created_at
       FROM realtime_event_stream
       WHERE tenant_id = ? AND agent_id IS NOT NULL
       ORDER BY seq DESC
       LIMIT 100;`,
      [tenantId]
    );

    const states: Record<string, { state: string; load: number; currentTask?: string; updatedAt: string }> = {};

    for (const row of rows) {
      if (!row.agent_id || states[row.agent_id]) continue;
      try {
        const payload = JSON.parse(row.payload_json);
        states[row.agent_id] = {
          state: payload.state || (row.type === 'agent.state_changed' ? payload.toState : 'live'),
          load: typeof payload.load === 'number' ? payload.load : 0.5,
          currentTask: payload.taskSummary || payload.taskType || undefined,
          updatedAt: row.ts,
        };
      } catch {
        // Fallback default
        states[row.agent_id] = {
          state: 'live',
          load: 0.5,
          updatedAt: row.ts,
        };
      }
    }

    return states;
  }

  private mapRecordToEnvelope(record: RealtimeEventRecord): RealtimeEventEnvelope {
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(record.payload_json);
    } catch {
      payload = {};
    }

    return {
      seq: record.seq,
      ts: record.ts,
      tenant_id: record.tenant_id,
      type: record.type,
      agent_id: record.agent_id || undefined,
      execution_id: record.execution_id || undefined,
      payload,
    };
  }
}
