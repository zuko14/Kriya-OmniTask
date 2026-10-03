/**
 * Kriya Omnitask — Graph Runtime persistence (docs/kriya WP-2.2)
 * Runs, append-only checkpoints and the side-effect ledger. Every query is scoped to the active
 * tenant context.
 */

import { DatabaseClient, db } from '../../storage/db.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import { CryptoUtils } from '../../core/utils/crypto.js';

export type GraphRunStatus = 'running' | 'parked' | 'completed' | 'failed';

export interface GraphRunRecord {
  id: string;
  tenant_id: string;
  graph_id: string;
  graph_version: string;
  graph_json: string;
  status: GraphRunStatus;
  next_node_id: string | null;
  state_json: string;
  step_count: number;
  visits_json: string;
  outcome: string | null;
  park_reason: string | null;
  error_message: string | null;
  correlation_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface GraphCheckpointRecord {
  id: string;
  tenant_id: string;
  run_id: string;
  step: number;
  node_id: string;
  node_kind: string;
  next_node_id: string | null;
  state_hash: string;
  state_json: string;
  duration_ms: number;
  created_at: string;
}

export class GraphRunRepository {
  constructor(private readonly customClient?: DatabaseClient) {}

  private get client(): DatabaseClient {
    return this.customClient ?? db.getClient();
  }

  private tenant(): string {
    return TenantContextManager.getTenantId();
  }

  public inTransaction<T>(fn: (tx: DatabaseClient) => Promise<T>): Promise<T> {
    return this.client.transaction(fn);
  }

  public async createRun(params: {
    graphId: string;
    graphVersion: string;
    graphJson: string;
    entry: string;
    state: Record<string, unknown>;
    correlationId?: string;
  }): Promise<GraphRunRecord> {
    const now = new Date().toISOString();
    const id = `run_${CryptoUtils.generateId()}`;
    await this.client.execute(
      `INSERT INTO graph_runs (id, tenant_id, graph_id, graph_version, graph_json, status, next_node_id, state_json,
         step_count, visits_json, correlation_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'running', ?, ?, 0, '{}', ?, ?, ?)`,
      [id, this.tenant(), params.graphId, params.graphVersion, params.graphJson, params.entry, JSON.stringify(params.state), params.correlationId ?? null, now, now]
    );
    return (await this.getRun(id))!;
  }

  public getClient(): DatabaseClient {
    return this.client;
  }

  public async getRun(id: string): Promise<GraphRunRecord | null> {
    return this.client.queryOne<GraphRunRecord>('SELECT * FROM graph_runs WHERE id = ? AND tenant_id = ?', [id, this.tenant()]);
  }

  public async listRuns(filter: { status?: GraphRunStatus; limit?: number } = {}): Promise<GraphRunRecord[]> {
    let sql = 'SELECT * FROM graph_runs WHERE tenant_id = ?';
    const params: unknown[] = [this.tenant()];
    if (filter.status) {
      sql += ' AND status = ?';
      params.push(filter.status);
    }
    sql += ' ORDER BY created_at DESC';
    if (filter.limit) {
      sql += ' LIMIT ?';
      params.push(filter.limit);
    }
    return this.client.query<GraphRunRecord>(sql, params);
  }

  public async findByCorrelationId(correlationId: string): Promise<GraphRunRecord | null> {
    return this.client.queryOne<GraphRunRecord>('SELECT * FROM graph_runs WHERE tenant_id = ? AND correlation_id = ? ORDER BY created_at ASC LIMIT 1', [this.tenant(), correlationId]);
  }

  /** Writes only the provided fields (no read-modify-write of the whole row). */
  public async updateRun(
    id: string,
    fields: Partial<Pick<GraphRunRecord, 'status' | 'next_node_id' | 'state_json' | 'step_count' | 'visits_json' | 'outcome' | 'park_reason' | 'error_message'>>,
    client: DatabaseClient = this.client
  ): Promise<void> {
    const entries: Array<[string, unknown]> = Object.entries(fields).filter(([, v]) => v !== undefined);
    entries.push(['updated_at', new Date().toISOString()]);
    await client.execute(
      `UPDATE graph_runs SET ${entries.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ? AND tenant_id = ?`,
      [...entries.map(([, v]) => v), id, this.tenant()]
    );
  }

  public async addCheckpoint(
    cp: Omit<GraphCheckpointRecord, 'id' | 'tenant_id' | 'created_at'>,
    client: DatabaseClient = this.client
  ): Promise<void> {
    await client.execute(
      `INSERT INTO graph_checkpoints (id, tenant_id, run_id, step, node_id, node_kind, next_node_id, state_hash, state_json, duration_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [`cp_${CryptoUtils.generateId()}`, this.tenant(), cp.run_id, cp.step, cp.node_id, cp.node_kind, cp.next_node_id, cp.state_hash, cp.state_json, cp.duration_ms, new Date().toISOString()]
    );
  }

  public async listCheckpoints(runId: string): Promise<GraphCheckpointRecord[]> {
    return this.client.query<GraphCheckpointRecord>(
      'SELECT * FROM graph_checkpoints WHERE run_id = ? AND tenant_id = ? ORDER BY step ASC',
      [runId, this.tenant()]
    );
  }

  public async getSideEffect(idempotencyKey: string): Promise<Record<string, unknown> | null> {
    const row = await this.client.queryOne<{ patch_json: string }>(
      'SELECT patch_json FROM graph_side_effects WHERE idempotency_key = ? AND tenant_id = ?',
      [idempotencyKey, this.tenant()]
    );
    return row ? (JSON.parse(row.patch_json) as Record<string, unknown>) : null;
  }

  /** Recorded side effects of a run, newest first (the order compensation must undo them in). */
  public async listSideEffects(runId: string): Promise<Array<{ idempotency_key: string; node_id: string; patch_json: string }>> {
    return this.client.query(
      'SELECT idempotency_key, node_id, patch_json FROM graph_side_effects WHERE run_id = ? AND tenant_id = ? ORDER BY created_at DESC, rowid DESC',
      [runId, this.tenant()]
    );
  }

  public async recordSideEffect(idempotencyKey: string, runId: string, nodeId: string, patch: Record<string, unknown>): Promise<void> {
    await this.client.execute(
      `INSERT INTO graph_side_effects (idempotency_key, tenant_id, run_id, node_id, patch_json, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [idempotencyKey, this.tenant(), runId, nodeId, JSON.stringify(patch), new Date().toISOString()]
    );
  }
}
