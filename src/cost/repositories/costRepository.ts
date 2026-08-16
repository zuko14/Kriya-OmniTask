/**
 * Xylarc AI — Cost Intelligence Repository
 * Persistence for cost attribution records, business outcomes, and tenant budget policies.
 */

import { BaseRepository } from '../../storage/repositories/baseRepository.js';
import { DatabaseClient } from '../../storage/db.js';
import {
  CostAttributionRecord,
  BusinessOutcomeRecord,
  TenantBudgetPolicy,
  CostCategory,
  CostProvider,
  OutcomeType,
  OutcomeStatus,
} from '../types/costTypes.js';

export class CostRepository extends BaseRepository<any> {
  protected readonly tableName = 'cost_attribution_records';

  constructor(client?: DatabaseClient) {
    super(client);
  }

  public async insertCostRecord(record: CostAttributionRecord): Promise<void> {
    await this.client.execute(
      `INSERT INTO cost_attribution_records
       (id, tenant_id, organization_id, agent_id, workflow_execution_id, task_id, cost_category, provider, resource_metric_name, resource_quantity, unit_cost_usd, total_cost_usd, outcome_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        record.id,
        record.tenantId,
        record.organizationId,
        record.agentId,
        record.workflowExecutionId || null,
        record.taskId,
        record.costCategory,
        record.provider,
        record.resourceMetricName,
        record.resourceQuantity,
        record.unitCostUsd,
        record.totalCostUsd,
        record.outcomeId || null,
        record.createdAt,
      ]
    );
  }

  public async listCostRecords(tenantId: string, limit = 100): Promise<CostAttributionRecord[]> {
    const rows = await this.client.query<any>(
      `SELECT id, tenant_id, organization_id, agent_id, workflow_execution_id, task_id, cost_category,
              provider, resource_metric_name, resource_quantity, unit_cost_usd, total_cost_usd, outcome_id, created_at
       FROM cost_attribution_records
       WHERE tenant_id = ?
       ORDER BY created_at DESC
       LIMIT ?;`,
      [tenantId, limit]
    );

    return rows.map((r) => ({
      id: r.id,
      tenantId: r.tenant_id,
      organizationId: r.organization_id,
      agentId: r.agent_id,
      workflowExecutionId: r.workflow_execution_id || undefined,
      taskId: r.task_id,
      costCategory: r.cost_category as CostCategory,
      provider: r.provider as CostProvider,
      resourceMetricName: r.resource_metric_name,
      resourceQuantity: Number(r.resource_quantity),
      unitCostUsd: Number(r.unit_cost_usd),
      totalCostUsd: Number(r.total_cost_usd),
      outcomeId: r.outcome_id || undefined,
      createdAt: r.created_at,
    }));
  }

  public async getCostRecordsByTaskIds(
    tenantId: string,
    taskIds: string[]
  ): Promise<CostAttributionRecord[]> {
    if (taskIds.length === 0) return [];

    const placeholders = taskIds.map(() => '?').join(',');
    const rows = await this.client.query<any>(
      `SELECT id, tenant_id, organization_id, agent_id, workflow_execution_id, task_id, cost_category,
              provider, resource_metric_name, resource_quantity, unit_cost_usd, total_cost_usd, outcome_id, created_at
       FROM cost_attribution_records
       WHERE tenant_id = ? AND task_id IN (${placeholders});`,
      [tenantId, ...taskIds]
    );

    return rows.map((r) => ({
      id: r.id,
      tenantId: r.tenant_id,
      organizationId: r.organization_id,
      agentId: r.agent_id,
      workflowExecutionId: r.workflow_execution_id || undefined,
      taskId: r.task_id,
      costCategory: r.cost_category as CostCategory,
      provider: r.provider as CostProvider,
      resourceMetricName: r.resource_metric_name,
      resourceQuantity: Number(r.resource_quantity),
      unitCostUsd: Number(r.unit_cost_usd),
      totalCostUsd: Number(r.total_cost_usd),
      outcomeId: r.outcome_id || undefined,
      createdAt: r.created_at,
    }));
  }

  public async insertBusinessOutcome(record: BusinessOutcomeRecord): Promise<void> {
    await this.client.execute(
      `INSERT INTO business_outcomes
       (id, tenant_id, organization_id, agent_id, workflow_execution_id, outcome_type, outcome_status, value_generated_usd, total_cost_usd, roi_multiplier, outcome_metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        record.id,
        record.tenantId,
        record.organizationId,
        record.agentId,
        record.workflowExecutionId || null,
        record.outcomeType,
        record.outcomeStatus,
        record.valueGeneratedUsd,
        record.totalCostUsd,
        record.roiMultiplier,
        JSON.stringify(record.outcomeMetadata),
        record.createdAt,
      ]
    );
  }

  public async listBusinessOutcomes(tenantId: string, limit = 100): Promise<BusinessOutcomeRecord[]> {
    const rows = await this.client.query<any>(
      `SELECT id, tenant_id, organization_id, agent_id, workflow_execution_id, outcome_type,
              outcome_status, value_generated_usd, total_cost_usd, roi_multiplier, outcome_metadata_json, created_at
       FROM business_outcomes
       WHERE tenant_id = ?
       ORDER BY created_at DESC
       LIMIT ?;`,
      [tenantId, limit]
    );

    return rows.map((r) => ({
      id: r.id,
      tenantId: r.tenant_id,
      organizationId: r.organization_id,
      agentId: r.agent_id,
      workflowExecutionId: r.workflow_execution_id || undefined,
      outcomeType: r.outcome_type as OutcomeType,
      outcomeStatus: r.outcome_status as OutcomeStatus,
      valueGeneratedUsd: Number(r.value_generated_usd),
      totalCostUsd: Number(r.total_cost_usd),
      roiMultiplier: Number(r.roi_multiplier),
      outcomeMetadata: JSON.parse(r.outcome_metadata_json),
      createdAt: r.created_at,
    }));
  }

  public async getBudgetPolicy(tenantId: string, organizationId = 'default'): Promise<TenantBudgetPolicy | null> {
    const rows = await this.client.query<any>(
      `SELECT id, tenant_id, organization_id, monthly_budget_usd, daily_budget_usd, warning_threshold_pct,
              hard_cap_action, current_month_spend_usd, current_day_spend_usd, is_circuit_broken, last_reset_at, created_at, updated_at
       FROM tenant_budget_policies
       WHERE tenant_id = ? AND organization_id = ?;`,
      [tenantId, organizationId]
    );

    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      id: r.id,
      tenantId: r.tenant_id,
      organizationId: r.organization_id,
      monthlyBudgetUsd: Number(r.monthly_budget_usd),
      dailyBudgetUsd: Number(r.daily_budget_usd),
      warningThresholdPct: Number(r.warning_threshold_pct),
      hardCapAction: r.hard_cap_action,
      currentMonthSpendUsd: Number(r.current_month_spend_usd),
      currentDaySpendUsd: Number(r.current_day_spend_usd),
      isCircuitBroken: Boolean(r.is_circuit_broken),
      lastResetAt: r.last_reset_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  public async upsertBudgetPolicy(policy: TenantBudgetPolicy): Promise<void> {
    await this.client.execute(
      `INSERT OR REPLACE INTO tenant_budget_policies
       (id, tenant_id, organization_id, monthly_budget_usd, daily_budget_usd, warning_threshold_pct, hard_cap_action, current_month_spend_usd, current_day_spend_usd, is_circuit_broken, last_reset_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        policy.id,
        policy.tenantId,
        policy.organizationId,
        policy.monthlyBudgetUsd,
        policy.dailyBudgetUsd,
        policy.warningThresholdPct,
        policy.hardCapAction,
        policy.currentMonthSpendUsd,
        policy.currentDaySpendUsd,
        policy.isCircuitBroken ? 1 : 0,
        policy.lastResetAt,
        policy.createdAt,
        policy.updatedAt,
      ]
    );
  }

  public async incrementSpend(tenantId: string, organizationId: string, amountUsd: number): Promise<void> {
    await this.client.execute(
      `UPDATE tenant_budget_policies
       SET current_month_spend_usd = current_month_spend_usd + ?,
           current_day_spend_usd = current_day_spend_usd + ?,
           updated_at = ?
       WHERE tenant_id = ? AND organization_id = ?;`,
      [amountUsd, amountUsd, new Date().toISOString(), tenantId, organizationId]
    );
  }

  public async setCircuitBreaker(tenantId: string, organizationId: string, isBroken: boolean): Promise<void> {
    await this.client.execute(
      `UPDATE tenant_budget_policies
       SET is_circuit_broken = ?,
           updated_at = ?
       WHERE tenant_id = ? AND organization_id = ?;`,
      [isBroken ? 1 : 0, new Date().toISOString(), tenantId, organizationId]
    );
  }

  public async getTenantSpendSummary(tenantId: string): Promise<{
    totalSpendUsd: number;
    byCategory: Record<CostCategory, number>;
    byProvider: Record<CostProvider, number>;
    byAgent: Record<string, number>;
  }> {
    const rows = await this.client.query<any>(
      `SELECT agent_id, cost_category, provider, total_cost_usd
       FROM cost_attribution_records
       WHERE tenant_id = ?;`,
      [tenantId]
    );

    let totalSpendUsd = 0.0;
    const byCategory: Record<CostCategory, number> = {
      token_llm: 0,
      voice_telephony: 0,
      api_tool: 0,
      vector_search: 0,
      compute_sandbox: 0,
    };
    const byProvider: Record<CostProvider, number> = {
      google: 0,
      openai: 0,
      anthropic: 0,
      deepseek: 0,
      local: 0,
      twilio: 0,
      elevenlabs: 0,
      livekit: 0,
      clearbit: 0,
      stripe: 0,
      custom_api: 0,
    };
    const byAgent: Record<string, number> = {};

    for (const r of rows) {
      const cost = Number(r.total_cost_usd);
      totalSpendUsd += cost;

      const cat = r.cost_category as CostCategory;
      if (byCategory[cat] !== undefined) {
        byCategory[cat] = Number((byCategory[cat] + cost).toFixed(6));
      }

      const prov = r.provider as CostProvider;
      if (byProvider[prov] !== undefined) {
        byProvider[prov] = Number((byProvider[prov] + cost).toFixed(6));
      }

      const agent = r.agent_id;
      byAgent[agent] = Number(((byAgent[agent] || 0) + cost).toFixed(6));
    }

    return {
      totalSpendUsd: Number(totalSpendUsd.toFixed(6)),
      byCategory,
      byProvider,
      byAgent,
    };
  }
}
