/**
 * Kriya Omnitask — Reach Session Repository (WP-5.5, Blueprint §10, §15, ADR-022)
 *
 * Persists browser automation sessions, evidence hashes, and Proof linkage
 * with strict multi-tenant isolation.
 */

import { DatabaseClient, db } from '../../storage/db.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import { ReachSessionRecord } from '../types/reachTypes.js';

export class ReachSessionRepository {
  constructor(private readonly customClient?: DatabaseClient) {}

  private get client(): DatabaseClient {
    return this.customClient ?? db.getClient();
  }

  private resolveTenantId(): string {
    const ctx = TenantContextManager.get();
    if (!ctx || !ctx.tenantId) {
      throw new Error('Tenant context is required for ReachSessionRepository operations');
    }
    return ctx.tenantId;
  }

  public async create(data: {
    id: string;
    tenant_id?: string;
    run_id?: string | null;
    status: string;
    initial_url: string;
    final_url?: string | null;
    actions_count: number;
    proof_receipt_id?: string | null;
    evidence_sha256?: string | null;
    error_message?: string | null;
    duration_ms: number;
  }): Promise<ReachSessionRecord> {
    const tenantId = data.tenant_id || this.resolveTenantId();

    const sql = `
      INSERT INTO reach_sessions (
        id, tenant_id, run_id, status, initial_url, final_url,
        actions_count, proof_receipt_id, evidence_sha256, error_message, duration_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    await this.client.query(sql, [
      data.id,
      tenantId,
      data.run_id || null,
      data.status,
      data.initial_url,
      data.final_url || null,
      data.actions_count,
      data.proof_receipt_id || null,
      data.evidence_sha256 || null,
      data.error_message || null,
      data.duration_ms,
    ]);

    const record = await this.findById(data.id, tenantId);
    if (!record) {
      throw new Error(`Failed to retrieve created reach_session '${data.id}'`);
    }
    return record;
  }

  public async update(
    id: string,
    updates: Partial<{
      status: string;
      final_url: string | null;
      actions_count: number;
      proof_receipt_id: string | null;
      evidence_sha256: string | null;
      error_message: string | null;
      duration_ms: number;
    }>,
    tenantIdOverride?: string
  ): Promise<void> {
    const tenantId = tenantIdOverride || this.resolveTenantId();

    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.status !== undefined) {
      fields.push('status = ?');
      values.push(updates.status);
    }
    if (updates.final_url !== undefined) {
      fields.push('final_url = ?');
      values.push(updates.final_url);
    }
    if (updates.actions_count !== undefined) {
      fields.push('actions_count = ?');
      values.push(updates.actions_count);
    }
    if (updates.proof_receipt_id !== undefined) {
      fields.push('proof_receipt_id = ?');
      values.push(updates.proof_receipt_id);
    }
    if (updates.evidence_sha256 !== undefined) {
      fields.push('evidence_sha256 = ?');
      values.push(updates.evidence_sha256);
    }
    if (updates.error_message !== undefined) {
      fields.push('error_message = ?');
      values.push(updates.error_message);
    }
    if (updates.duration_ms !== undefined) {
      fields.push('duration_ms = ?');
      values.push(updates.duration_ms);
    }

    if (fields.length === 0) return;

    values.push(id, tenantId);
    const sql = `UPDATE reach_sessions SET ${fields.join(', ')} WHERE id = ? AND tenant_id = ?`;
    await this.client.query(sql, values);
  }

  public async findById(id: string, tenantIdOverride?: string): Promise<ReachSessionRecord | null> {
    const tenantId = tenantIdOverride || this.resolveTenantId();
    const sql = 'SELECT * FROM reach_sessions WHERE id = ? AND tenant_id = ?';
    const rows = await this.client.query<ReachSessionRecord>(sql, [id, tenantId]);
    return rows[0] || null;
  }

  public async listByTenant(limit = 50, tenantIdOverride?: string): Promise<ReachSessionRecord[]> {
    const tenantId = tenantIdOverride || this.resolveTenantId();
    const sql = `
      SELECT * FROM reach_sessions
      WHERE tenant_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `;
    return this.client.query<ReachSessionRecord>(sql, [tenantId, limit]);
  }
}
