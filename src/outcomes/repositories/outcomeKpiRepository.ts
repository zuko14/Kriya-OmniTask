/**
 * Kriya Omnitask — Outcome Instrumentation & Blueprint KPI Repository
 * (docs/kriya WP-6.1, Blueprint §14, CLAUDE.md §35, §39; ADR-024)
 *
 * Ground-truth multi-tenant data access across workflow runs, proof receipts,
 * verification jobs, tool executions, attention escalations, cost attribution,
 * business outcomes, and cost cascade events.
 */

import { randomUUID } from 'node:crypto';
import { BaseRepository } from '../../storage/repositories/baseRepository.js';
import { DatabaseClient, db } from '../../storage/db.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import {
  CascadeExecutionEventRecord,
  OutcomeMetricsSnapshotRecord,
  RecordCascadeEvent,
  RecordCascadeEventSchema,
  WindowType,
} from '../types/outcomeKpiTypes.js';

export class OutcomeKpiRepository extends BaseRepository<any> {
  protected readonly tableName = 'cascade_execution_events';

  constructor(client?: DatabaseClient) {
    super(client || db.getClient());
  }

  /**
   * Records a cost cascade (L0-L3) execution event.
   */
  public async recordCascadeEvent(
    event: RecordCascadeEvent,
    tenantIdOverride?: string
  ): Promise<CascadeExecutionEventRecord> {
    const parsed = RecordCascadeEventSchema.parse(event);
    const tenantId = tenantIdOverride || TenantContextManager.getTenantId();
    const id = randomUUID();
    const now = new Date().toISOString();

    await this.client.execute(
      `INSERT INTO cascade_execution_events
       (id, tenant_id, run_id, correlation_id, agent_id, workflow_id, cascade_level, model_id, resolved, latency_ms, input_tokens, output_tokens, cost_usd, rule_name, details_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        id,
        tenantId,
        parsed.runId || null,
        parsed.correlationId || null,
        parsed.agentId,
        parsed.workflowId || null,
        parsed.cascadeLevel,
        parsed.modelId || null,
        parsed.resolved ? 1 : 0,
        parsed.latencyMs,
        parsed.inputTokens,
        parsed.outputTokens,
        parsed.costUsd,
        parsed.ruleName || null,
        JSON.stringify(parsed.details),
        now,
      ]
    );

    return {
      id,
      tenant_id: tenantId,
      run_id: parsed.runId,
      correlation_id: parsed.correlationId,
      agent_id: parsed.agentId,
      workflow_id: parsed.workflowId,
      cascade_level: parsed.cascadeLevel,
      model_id: parsed.modelId,
      resolved: parsed.resolved ? 1 : 0,
      latency_ms: parsed.latencyMs,
      input_tokens: parsed.inputTokens,
      output_tokens: parsed.outputTokens,
      cost_usd: parsed.costUsd,
      rule_name: parsed.ruleName,
      details_json: JSON.stringify(parsed.details),
      created_at: now,
    };
  }

  /**
   * Lists cascade execution events within the given window.
   */
  public async listCascadeEvents(
    tenantId: string,
    filter?: { agentId?: string; workflowId?: string; since?: string; until?: string }
  ): Promise<CascadeExecutionEventRecord[]> {
    let sql = `SELECT * FROM cascade_execution_events WHERE tenant_id = ?`;
    const params: unknown[] = [tenantId];

    if (filter?.agentId) {
      sql += ` AND agent_id = ?`;
      params.push(filter.agentId);
    }
    if (filter?.workflowId) {
      sql += ` AND workflow_id = ?`;
      params.push(filter.workflowId);
    }
    if (filter?.since) {
      sql += ` AND created_at >= ?`;
      params.push(filter.since);
    }
    if (filter?.until) {
      sql += ` AND created_at <= ?`;
      params.push(filter.until);
    }
    sql += ` ORDER BY created_at ASC;`;

    return this.client.query<CascadeExecutionEventRecord>(sql, params);
  }

  /**
   * Queries workflow runs from graph_runs table.
   */
  public async queryWorkflowRuns(
    tenantId: string,
    filter?: { workflowId?: string; since?: string; until?: string }
  ): Promise<Array<{
    id: string;
    graph_id: string;
    status: string;
    outcome: string | null;
    error_message: string | null;
    park_reason: string | null;
    step_count: number;
    created_at: string;
    updated_at: string;
  }>> {
    let sql = `SELECT id, graph_id, status, outcome, error_message, park_reason, step_count, created_at, updated_at
               FROM graph_runs WHERE tenant_id = ?`;
    const params: unknown[] = [tenantId];

    if (filter?.workflowId) {
      sql += ` AND graph_id = ?`;
      params.push(filter.workflowId);
    }
    if (filter?.since) {
      sql += ` AND created_at >= ?`;
      params.push(filter.since);
    }
    if (filter?.until) {
      sql += ` AND created_at <= ?`;
      params.push(filter.until);
    }
    sql += ` ORDER BY created_at ASC;`;

    return this.client.query(sql, params);
  }

  /**
   * Queries proof receipts for consequential actions.
   */
  public async queryProofReceipts(
    tenantId: string,
    filter?: { since?: string; until?: string }
  ): Promise<Array<{
    id: string;
    run_id: string | null;
    action_type: string;
    risk_tier: string;
    body_json: string;
    issued_at: string;
  }>> {
    let sql = `SELECT id, run_id, action_type, risk_tier, body_json, issued_at
               FROM proof_receipts WHERE tenant_id = ?`;
    const params: unknown[] = [tenantId];

    if (filter?.since) {
      sql += ` AND issued_at >= ?`;
      params.push(filter.since);
    }
    if (filter?.until) {
      sql += ` AND issued_at <= ?`;
      params.push(filter.until);
    }
    sql += ` ORDER BY issued_at ASC;`;

    return this.client.query(sql, params);
  }

  /**
   * Queries verification jobs from verification_jobs table.
   */
  public async queryVerificationJobs(
    tenantId: string,
    filter?: { since?: string; until?: string }
  ): Promise<Array<{
    id: string;
    run_id: string;
    tool_slug: string;
    status: string;
    created_at: string;
    updated_at: string;
  }>> {
    let sql = `SELECT id, run_id, tool_slug, status, created_at, updated_at
               FROM verification_jobs WHERE tenant_id = ?`;
    const params: unknown[] = [tenantId];

    if (filter?.since) {
      sql += ` AND created_at >= ?`;
      params.push(filter.since);
    }
    if (filter?.until) {
      sql += ` AND created_at <= ?`;
      params.push(filter.until);
    }
    sql += ` ORDER BY created_at ASC;`;

    return this.client.query(sql, params);
  }

  /**
   * Queries tool executions from tool_executions table.
   */
  public async queryToolExecutions(
    tenantId: string,
    filter?: { agentId?: string; since?: string; until?: string }
  ): Promise<Array<{
    id: string;
    agent_id: string | null;
    tool_slug: string;
    risk_tier: string;
    status: string;
    duration_ms: number;
    created_at: string;
  }>> {
    let sql = `SELECT id, agent_id, tool_slug, risk_tier, status, duration_ms, created_at
               FROM tool_executions WHERE tenant_id = ?`;
    const params: unknown[] = [tenantId];

    if (filter?.agentId) {
      sql += ` AND agent_id = ?`;
      params.push(filter.agentId);
    }
    if (filter?.since) {
      sql += ` AND created_at >= ?`;
      params.push(filter.since);
    }
    if (filter?.until) {
      sql += ` AND created_at <= ?`;
      params.push(filter.until);
    }
    sql += ` ORDER BY created_at ASC;`;

    return this.client.query(sql, params);
  }

  /**
   * Queries human attention escalations.
   */
  public async queryAttentionItems(
    tenantId: string,
    filter?: { agentId?: string; since?: string; until?: string }
  ): Promise<Array<{
    id: string;
    source_agent_id: string;
    priority: string;
    status: string;
    reason_category: string;
    created_at: string;
    resolved_at: string | null;
  }>> {
    let sql = `SELECT id, source_agent_id, priority, status, reason_category, created_at, resolved_at
               FROM attention_items WHERE tenant_id = ?`;
    const params: unknown[] = [tenantId];

    if (filter?.agentId) {
      sql += ` AND source_agent_id = ?`;
      params.push(filter.agentId);
    }
    if (filter?.since) {
      sql += ` AND created_at >= ?`;
      params.push(filter.since);
    }
    if (filter?.until) {
      sql += ` AND created_at <= ?`;
      params.push(filter.until);
    }
    sql += ` ORDER BY created_at ASC;`;

    return this.client.query(sql, params);
  }

  /**
   * Queries cost attribution records.
   */
  public async queryCostRecords(
    tenantId: string,
    filter?: { agentId?: string; since?: string; until?: string }
  ): Promise<Array<{
    id: string;
    agent_id: string;
    workflow_execution_id: string | null;
    cost_category: string;
    provider: string;
    resource_metric_name: string;
    total_cost_usd: number;
    resource_quantity: number;
    outcome_id: string | null;
    created_at: string;
  }>> {
    let sql = `SELECT id, agent_id, workflow_execution_id, cost_category, provider, resource_metric_name, total_cost_usd, resource_quantity, outcome_id, created_at
               FROM cost_attribution_records WHERE tenant_id = ?`;
    const params: unknown[] = [tenantId];

    if (filter?.agentId) {
      sql += ` AND agent_id = ?`;
      params.push(filter.agentId);
    }
    if (filter?.since) {
      sql += ` AND created_at >= ?`;
      params.push(filter.since);
    }
    if (filter?.until) {
      sql += ` AND created_at <= ?`;
      params.push(filter.until);
    }
    sql += ` ORDER BY created_at ASC;`;

    return this.client.query(sql, params);
  }

  /**
   * Queries business outcomes records.
   */
  public async queryBusinessOutcomes(
    tenantId: string,
    filter?: { agentId?: string; since?: string; until?: string }
  ): Promise<Array<{
    id: string;
    agent_id: string;
    workflow_execution_id: string | null;
    outcome_type: string;
    outcome_status: string;
    value_generated_usd: number;
    total_cost_usd: number;
    created_at: string;
  }>> {
    let sql = `SELECT id, agent_id, workflow_execution_id, outcome_type, outcome_status, value_generated_usd, total_cost_usd, created_at
               FROM business_outcomes WHERE tenant_id = ?`;
    const params: unknown[] = [tenantId];

    if (filter?.agentId) {
      sql += ` AND agent_id = ?`;
      params.push(filter.agentId);
    }
    if (filter?.since) {
      sql += ` AND created_at >= ?`;
      params.push(filter.since);
    }
    if (filter?.until) {
      sql += ` AND created_at <= ?`;
      params.push(filter.until);
    }
    sql += ` ORDER BY created_at ASC;`;

    return this.client.query(sql, params);
  }

  /**
   * Saves a KPI calculation snapshot.
   */
  public async saveSnapshot(snapshot: OutcomeMetricsSnapshotRecord): Promise<void> {
    await this.client.execute(
      `INSERT INTO outcome_metrics_snapshots
       (id, tenant_id, window_type, window_start, window_end, dimension_type, dimension_id, metrics_json, calculated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        snapshot.id,
        snapshot.tenant_id,
        snapshot.window_type,
        snapshot.window_start,
        snapshot.window_end,
        snapshot.dimension_type,
        snapshot.dimension_id,
        snapshot.metrics_json,
        snapshot.calculated_at,
      ]
    );
  }

  /**
   * Retrieves the most recent KPI snapshot if available.
   */
  public async getLatestSnapshot(
    tenantId: string,
    windowType: WindowType,
    dimensionType: string,
    dimensionId: string
  ): Promise<OutcomeMetricsSnapshotRecord | null> {
    const rows = await this.client.query<OutcomeMetricsSnapshotRecord>(
      `SELECT * FROM outcome_metrics_snapshots
       WHERE tenant_id = ? AND window_type = ? AND dimension_type = ? AND dimension_id = ?
       ORDER BY calculated_at DESC LIMIT 1;`,
      [tenantId, windowType, dimensionType, dimensionId]
    );
    return rows.length > 0 ? rows[0] : null;
  }
}
