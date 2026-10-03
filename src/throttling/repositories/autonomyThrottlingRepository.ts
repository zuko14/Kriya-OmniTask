/**
 * Kriya Omnitask — Error-Budget Autonomy Throttling Repository
 * (CLAUDE.md §15, §37; Blueprint §14; docs/kriya WP-6.3, ADR-026)
 *
 * Persists agent error budget states, throttle levels, and immutable audit event transitions.
 */

import { DatabaseClient, db } from '../../storage/db.js';
import {
  AgentErrorBudgetRecord,
  AutonomyEventRecord,
} from '../types/autonomyThrottlingTypes.js';

export class AutonomyThrottlingRepository {
  private client: DatabaseClient;

  constructor(client?: DatabaseClient) {
    this.client = client || db.getClient();
  }

  /**
   * Retrieves the current error budget record for a specific agent in a tenant.
   */
  public async getBudget(
    tenantId: string,
    agentSlug: string
  ): Promise<AgentErrorBudgetRecord | null> {
    const row = await this.client.queryOne<any>(
      `SELECT * FROM agent_error_budgets 
       WHERE tenant_id = ? AND agent_slug = ?`,
      [tenantId, agentSlug]
    );

    if (!row) return null;
    return this.mapBudgetRow(row);
  }

  /**
   * Lists all agent error budgets for a tenant, optionally filtering by throttled status.
   */
  public async listBudgets(
    tenantId: string,
    onlyThrottled: boolean = false
  ): Promise<AgentErrorBudgetRecord[]> {
    let sql = `SELECT * FROM agent_error_budgets WHERE tenant_id = ?`;
    const params: unknown[] = [tenantId];

    if (onlyThrottled) {
      sql += ` AND is_throttled = 1`;
    }
    sql += ` ORDER BY agent_slug ASC`;

    const rows = await this.client.query<any>(sql, params);
    return rows.map((r) => this.mapBudgetRow(r));
  }

  /**
   * Upserts an agent error budget record.
   */
  public async upsertBudget(budget: AgentErrorBudgetRecord): Promise<void> {
    const existing = await this.getBudget(budget.tenant_id, budget.agent_slug);

    if (existing) {
      await this.client.execute(
        `UPDATE agent_error_budgets SET
           configured_tier_cap = ?,
           effective_tier_cap = ?,
           is_throttled = ?,
           target_sla_rate = ?,
           allowed_error_budget = ?,
           current_error_rate = ?,
           burned_budget_percent = ?,
           sample_count = ?,
           failure_count = ?,
           consecutive_failures = ?,
           throttled_at = ?,
           throttled_reason = ?,
           restored_at = ?,
           restored_by = ?,
           last_evaluated_at = ?,
           updated_at = ?
         WHERE tenant_id = ? AND agent_slug = ?`,
        [
          budget.configured_tier_cap,
          budget.effective_tier_cap,
          budget.is_throttled ? 1 : 0,
          budget.target_sla_rate,
          budget.allowed_error_budget,
          budget.current_error_rate,
          budget.burned_budget_percent,
          budget.sample_count,
          budget.failure_count,
          budget.consecutive_failures,
          budget.throttled_at,
          budget.throttled_reason,
          budget.restored_at,
          budget.restored_by,
          budget.last_evaluated_at,
          budget.updated_at,
          budget.tenant_id,
          budget.agent_slug,
        ]
      );
    } else {
      await this.client.execute(
        `INSERT INTO agent_error_budgets (
           id, tenant_id, agent_slug, configured_tier_cap, effective_tier_cap,
           is_throttled, target_sla_rate, allowed_error_budget, current_error_rate,
           burned_budget_percent, sample_count, failure_count, consecutive_failures,
           throttled_at, throttled_reason, restored_at, restored_by,
           last_evaluated_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          budget.id,
          budget.tenant_id,
          budget.agent_slug,
          budget.configured_tier_cap,
          budget.effective_tier_cap,
          budget.is_throttled ? 1 : 0,
          budget.target_sla_rate,
          budget.allowed_error_budget,
          budget.current_error_rate,
          budget.burned_budget_percent,
          budget.sample_count,
          budget.failure_count,
          budget.consecutive_failures,
          budget.throttled_at,
          budget.throttled_reason,
          budget.restored_at,
          budget.restored_by,
          budget.last_evaluated_at,
          budget.created_at,
          budget.updated_at,
        ]
      );
    }
  }

  /**
   * Inserts an immutable autonomy transition event.
   */
  public async recordEvent(event: AutonomyEventRecord): Promise<void> {
    await this.client.execute(
      `INSERT INTO agent_autonomy_events (
         id, tenant_id, agent_slug, event_type, from_tier, to_tier,
         burned_budget_percent, reason, actor, evidence_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        event.id,
        event.tenant_id,
        event.agent_slug,
        event.event_type,
        event.from_tier,
        event.to_tier,
        event.burned_budget_percent,
        event.reason,
        event.actor,
        event.evidence_json,
        event.created_at,
      ]
    );
  }

  /**
   * Lists historical autonomy transition events, paginated.
   */
  public async listEvents(
    tenantId: string,
    query?: { agentSlug?: string; limit?: number; offset?: number }
  ): Promise<{ events: AutonomyEventRecord[]; total: number }> {
    const limit = Math.min(Math.max(query?.limit ?? 50, 1), 100);
    const offset = Math.max(query?.offset ?? 0, 0);

    let countSql = `SELECT COUNT(*) as count FROM agent_autonomy_events WHERE tenant_id = ?`;
    let selectSql = `SELECT * FROM agent_autonomy_events WHERE tenant_id = ?`;
    const params: unknown[] = [tenantId];

    if (query?.agentSlug) {
      countSql += ` AND agent_slug = ?`;
      selectSql += ` AND agent_slug = ?`;
      params.push(query.agentSlug);
    }

    selectSql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;

    const [countRow, rows] = await Promise.all([
      this.client.queryOne<{ count: number }>(countSql, params),
      this.client.query<any>(selectSql, [...params, limit, offset]),
    ]);

    const total = Number(countRow?.count ?? 0);
    const events: AutonomyEventRecord[] = rows.map((r) => ({
      id: r.id,
      tenant_id: r.tenant_id,
      agent_slug: r.agent_slug,
      event_type: r.event_type,
      from_tier: r.from_tier,
      to_tier: r.to_tier,
      burned_budget_percent: Number(r.burned_budget_percent),
      reason: r.reason,
      actor: r.actor,
      evidence_json: r.evidence_json,
      created_at: r.created_at,
    }));

    return { events, total };
  }

  private mapBudgetRow(row: any): AgentErrorBudgetRecord {
    return {
      id: row.id,
      tenant_id: row.tenant_id,
      agent_slug: row.agent_slug,
      configured_tier_cap: row.configured_tier_cap,
      effective_tier_cap: row.effective_tier_cap,
      is_throttled: row.is_throttled === 1 || row.is_throttled === true,
      target_sla_rate: Number(row.target_sla_rate),
      allowed_error_budget: Number(row.allowed_error_budget),
      current_error_rate: Number(row.current_error_rate),
      burned_budget_percent: Number(row.burned_budget_percent),
      sample_count: Number(row.sample_count),
      failure_count: Number(row.failure_count),
      consecutive_failures: Number(row.consecutive_failures),
      throttled_at: row.throttled_at,
      throttled_reason: row.throttled_reason,
      restored_at: row.restored_at,
      restored_by: row.restored_by,
      last_evaluated_at: row.last_evaluated_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}
