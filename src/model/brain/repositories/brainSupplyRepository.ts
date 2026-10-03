import { db, DatabaseClient } from '../../../storage/db.js';
import {
  TenantBrainConfig,
  TenantBrainRecord,
  CatalogueModel,
  BrainAlignmentRunRecord,
} from '../types/brainSupplyTypes.js';

interface RawBrainConfigRow {
  tenant_id: string;
  brain_supply: string;
  monthly_budget_usd: number;
  daily_budget_usd: number;
  current_month_spend_usd: number;
  current_day_spend_usd: number;
  spend_anomaly_threshold_multiplier: number;
  status: string;
  created_at: string;
  updated_at: string;
}

interface RawTenantBrainRow {
  id: string;
  tenant_id: string;
  provider: string;
  model_id: string;
  model_version: string;
  credential_vault_service_slug: string | null;
  key_last_four: string;
  status: string;
  health_status: string;
  certified_tiers_json: string;
  certified_languages_json: string;
  assigned_agents_json: string;
  current_month_spend_usd: number;
  expires_at: string | null;
  last_certified_at: string | null;
  created_at: string;
  updated_at: string;
}

interface RawCatalogueRow {
  id: string;
  provider: string;
  model_id: string;
  display_name: string;
  context_window: number;
  indicative_cost_per_million_inr: number;
  structured_output_support: number;
  tool_calling_support: number;
  min_context_window_met: number;
  region_compliant: number;
  suitability_state: string;
  named_limitation: string | null;
  failed_hard_requirement: string | null;
  created_at: string;
  updated_at: string;
}

interface RawAlignmentRunRow {
  id: string;
  tenant_id: string;
  model_id: string;
  model_version: string;
  provider: string;
  status: string;
  current_stage: number;
  stages_json: string;
  estimated_cost_usd: number;
  actual_cost_usd: number;
  report_card_json: string;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export class BrainSupplyRepository {
  private client: DatabaseClient;

  constructor(client: DatabaseClient = db.getClient()) {
    this.client = client;
  }

  // =========================================================================
  // 1. Tenant Brain Supply Configuration & Budgets
  // =========================================================================
  public async getTenantBrainConfig(tenantId: string): Promise<TenantBrainConfig> {
    const row = await this.client.queryOne<RawBrainConfigRow>(
      'SELECT * FROM tenant_brain_configs WHERE tenant_id = ?',
      [tenantId]
    );

    if (row) {
      return this.mapRowToBrainConfig(row);
    }

    // Default configuration for tenant (§9.5: BYO is default, spend budget required)
    const now = new Date().toISOString();
    const defaultConfig: TenantBrainConfig = {
      tenantId,
      brainSupply: 'byo',
      monthlyBudgetUsd: 50.0,
      dailyBudgetUsd: 5.0,
      currentMonthSpendUsd: 0.0,
      currentDaySpendUsd: 0.0,
      spendAnomalyThresholdMultiplier: 3.0,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };

    await this.saveTenantBrainConfig(defaultConfig);
    return defaultConfig;
  }

  public async saveTenantBrainConfig(config: TenantBrainConfig): Promise<TenantBrainConfig> {
    const now = new Date().toISOString();
    await this.client.execute(
      `INSERT OR REPLACE INTO tenant_brain_configs (
        tenant_id, brain_supply, monthly_budget_usd, daily_budget_usd,
        current_month_spend_usd, current_day_spend_usd, spend_anomaly_threshold_multiplier,
        status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        config.tenantId,
        config.brainSupply,
        config.monthlyBudgetUsd,
        config.dailyBudgetUsd,
        config.currentMonthSpendUsd,
        config.currentDaySpendUsd,
        config.spendAnomalyThresholdMultiplier,
        config.status,
        config.createdAt || now,
        now,
      ]
    );

    return {
      ...config,
      updatedAt: now,
    };
  }

  // =========================================================================
  // 2. Active Tenant Brains (§18.6.1)
  // =========================================================================
  public async listTenantBrains(tenantId: string): Promise<TenantBrainRecord[]> {
    const rows = await this.client.query<RawTenantBrainRow>(
      'SELECT * FROM tenant_brains WHERE tenant_id = ? ORDER BY created_at DESC',
      [tenantId]
    );
    return rows.map((r: RawTenantBrainRow) => this.mapRowToTenantBrain(r));
  }

  public async getTenantBrain(id: string, tenantId?: string): Promise<TenantBrainRecord | null> {
    const sql = tenantId
      ? 'SELECT * FROM tenant_brains WHERE id = ? AND tenant_id = ?'
      : 'SELECT * FROM tenant_brains WHERE id = ?';
    const params = tenantId ? [id, tenantId] : [id];
    const row = await this.client.queryOne<RawTenantBrainRow>(sql, params);
    if (!row) return null;
    return this.mapRowToTenantBrain(row);
  }

  public async saveTenantBrain(brain: TenantBrainRecord): Promise<TenantBrainRecord> {
    const now = new Date().toISOString();
    await this.client.execute(
      `INSERT OR REPLACE INTO tenant_brains (
        id, tenant_id, provider, model_id, model_version,
        credential_vault_service_slug, key_last_four, status, health_status,
        certified_tiers_json, certified_languages_json, assigned_agents_json,
        current_month_spend_usd, expires_at, last_certified_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        brain.id,
        brain.tenantId,
        brain.provider,
        brain.modelId,
        brain.modelVersion,
        brain.credentialVaultServiceSlug || null,
        brain.keyLastFour,
        brain.status,
        brain.healthStatus,
        JSON.stringify(brain.certifiedTiers),
        JSON.stringify(brain.certifiedLanguages),
        JSON.stringify(brain.assignedAgents),
        brain.currentMonthSpendUsd,
        brain.expiresAt || null,
        brain.lastCertifiedAt || null,
        brain.createdAt || now,
        now,
      ]
    );

    return {
      ...brain,
      updatedAt: now,
    };
  }

  public async deleteTenantBrain(id: string, tenantId: string): Promise<boolean> {
    const res = await this.client.execute(
      'DELETE FROM tenant_brains WHERE id = ? AND tenant_id = ?',
      [id, tenantId]
    );
    return (res.changes ?? 0) > 0;
  }

  // =========================================================================
  // 3. Model Catalogue & Suitability Reference (§9.6)
  // =========================================================================
  public async listCatalogueModels(provider?: string): Promise<CatalogueModel[]> {
    const sql = provider
      ? 'SELECT * FROM brain_catalogue WHERE provider = ? ORDER BY indicative_cost_per_million_inr ASC'
      : 'SELECT * FROM brain_catalogue ORDER BY indicative_cost_per_million_inr ASC';
    const params = provider ? [provider] : [];
    const rows = await this.client.query<RawCatalogueRow>(sql, params);
    return rows.map((r: RawCatalogueRow) => this.mapRowToCatalogue(r));
  }

  public async getCatalogueModel(modelId: string): Promise<CatalogueModel | null> {
    const row = await this.client.queryOne<RawCatalogueRow>(
      'SELECT * FROM brain_catalogue WHERE model_id = ?',
      [modelId]
    );
    if (!row) return null;
    return this.mapRowToCatalogue(row);
  }

  // =========================================================================
  // 4. Alignment Check Runs (§9.7, §18.6.3)
  // =========================================================================
  public async createAlignmentRun(run: BrainAlignmentRunRecord): Promise<BrainAlignmentRunRecord> {
    const now = new Date().toISOString();
    await this.client.execute(
      `INSERT OR REPLACE INTO brain_alignment_runs (
        id, tenant_id, model_id, model_version, provider,
        status, current_stage, stages_json, estimated_cost_usd, actual_cost_usd,
        report_card_json, error_message, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        run.id,
        run.tenantId,
        run.modelId,
        run.modelVersion,
        run.provider,
        run.status,
        run.currentStage,
        JSON.stringify(run.stages || {}),
        run.estimatedCostUsd,
        run.actualCostUsd,
        JSON.stringify(run.reportCard || {}),
        run.errorMessage || null,
        run.createdAt || now,
        now,
      ]
    );

    return {
      ...run,
      createdAt: run.createdAt || now,
      updatedAt: now,
    };
  }

  public async updateAlignmentRun(
    runId: string,
    updates: Partial<BrainAlignmentRunRecord>
  ): Promise<BrainAlignmentRunRecord | null> {
    // Write ONLY the provided fields. A read-modify-write of the whole row let a concurrent
    // progress update silently overwrite an admin's cancellation (lost update).
    const columns: Array<[string, unknown]> = [];
    if (updates.status !== undefined) columns.push(['status', updates.status]);
    if (updates.currentStage !== undefined) columns.push(['current_stage', updates.currentStage]);
    if (updates.stages !== undefined) columns.push(['stages_json', JSON.stringify(updates.stages || {})]);
    if (updates.actualCostUsd !== undefined) columns.push(['actual_cost_usd', updates.actualCostUsd]);
    if (updates.reportCard !== undefined) columns.push(['report_card_json', JSON.stringify(updates.reportCard || {})]);
    if (updates.errorMessage !== undefined) columns.push(['error_message', updates.errorMessage || null]);
    columns.push(['updated_at', new Date().toISOString()]);

    const result = await this.client.execute(
      `UPDATE brain_alignment_runs SET ${columns.map(([c]) => `${c} = ?`).join(', ')} WHERE id = ?`,
      [...columns.map(([, v]) => v), runId]
    );
    if (result.changes === 0) return null;

    return this.getAlignmentRun(runId);
  }

  public async getAlignmentRun(runId: string): Promise<BrainAlignmentRunRecord | null> {
    const row = await this.client.queryOne<RawAlignmentRunRow>(
      'SELECT * FROM brain_alignment_runs WHERE id = ?',
      [runId]
    );
    if (!row) return null;

    return {
      id: row.id,
      tenantId: row.tenant_id,
      modelId: row.model_id,
      modelVersion: row.model_version,
      provider: row.provider,
      status: row.status as any,
      currentStage: row.current_stage,
      stages: JSON.parse(row.stages_json || '{}'),
      estimatedCostUsd: row.estimated_cost_usd,
      actualCostUsd: row.actual_cost_usd,
      reportCard: JSON.parse(row.report_card_json || '{}'),
      errorMessage: row.error_message || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // =========================================================================
  // Mappers
  // =========================================================================
  private mapRowToBrainConfig(row: RawBrainConfigRow): TenantBrainConfig {
    return {
      tenantId: row.tenant_id,
      brainSupply: row.brain_supply as any,
      monthlyBudgetUsd: row.monthly_budget_usd,
      dailyBudgetUsd: row.daily_budget_usd,
      currentMonthSpendUsd: row.current_month_spend_usd,
      currentDaySpendUsd: row.current_day_spend_usd,
      spendAnomalyThresholdMultiplier: row.spend_anomaly_threshold_multiplier,
      status: row.status as any,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapRowToTenantBrain(row: RawTenantBrainRow): TenantBrainRecord {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      provider: row.provider,
      modelId: row.model_id,
      modelVersion: row.model_version,
      credentialVaultServiceSlug: row.credential_vault_service_slug || undefined,
      keyLastFour: row.key_last_four,
      status: row.status as any,
      healthStatus: row.health_status as any,
      certifiedTiers: JSON.parse(row.certified_tiers_json || '[]'),
      certifiedLanguages: JSON.parse(row.certified_languages_json || '[]'),
      assignedAgents: JSON.parse(row.assigned_agents_json || '[]'),
      currentMonthSpendUsd: row.current_month_spend_usd,
      expiresAt: row.expires_at,
      lastCertifiedAt: row.last_certified_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapRowToCatalogue(row: RawCatalogueRow): CatalogueModel {
    const isSelectable = row.suitability_state !== 'UNSUITABLE';
    return {
      id: row.id,
      provider: row.provider,
      modelId: row.model_id,
      displayName: row.display_name,
      contextWindow: row.context_window,
      indicativeCostPerMillionInr: row.indicative_cost_per_million_inr,
      structuredOutputSupport: Boolean(row.structured_output_support),
      toolCallingSupport: Boolean(row.tool_calling_support),
      minContextWindowMet: Boolean(row.min_context_window_met),
      regionCompliant: Boolean(row.region_compliant),
      suitabilityState: row.suitability_state as any,
      namedLimitation: row.named_limitation,
      failedHardRequirement: row.failed_hard_requirement,
      isSelectable,
      advisoryNotice:
        'Advisory only — based on general model characteristics. Run the alignment check to see how it performs on your actual workforce.',
    };
  }
}
