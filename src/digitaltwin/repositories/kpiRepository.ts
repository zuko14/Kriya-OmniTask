/**
 * Xylarc AI — Organization KPIs & Bottlenecks Repository
 * Relational storage for business metric trees and operational bottleneck diagnosis (§14, §15 of CLAUDE.md).
 */

import { BaseRepository } from '../../storage/repositories/baseRepository.js';
import { DatabaseClient } from '../../storage/db.js';
import {
  OrganizationKpiRecord,
  OperationalBottleneckRecord,
  CreateKpiRequest,
  KpiStatus,
  BottleneckSeverity,
  BottleneckType,
} from '../types/digitalTwinTypes.js';
import { CryptoUtils } from '../../core/utils/crypto.js';

export class KpiRepository extends BaseRepository<OrganizationKpiRecord> {
  protected readonly tableName = 'organization_kpis';

  constructor(client?: DatabaseClient) {
    super(client);
  }

  /**
   * Defines or updates an organization KPI.
   */
  public async createOrUpdateKpi(data: CreateKpiRequest & { status?: KpiStatus }): Promise<OrganizationKpiRecord> {
    const tenantId = this.getTenantId();
    const existing = await this.client.queryOne<OrganizationKpiRecord>(
      'SELECT * FROM organization_kpis WHERE tenant_id = ? AND kpi_key = ?;',
      [tenantId, data.kpiKey]
    );

    const now = new Date().toISOString();

    if (existing) {
      await this.client.execute(
        `UPDATE organization_kpis SET
          kpi_name = ?,
          category = ?,
          entity_id = ?,
          target_value = ?,
          actual_value = ?,
          unit = ?,
          timeframe = ?,
          status = ?,
          calculation_method_json = ?,
          last_evaluated_at = ?,
          updated_at = ?
         WHERE id = ? AND tenant_id = ?;`,
        [
          data.kpiName,
          data.category,
          data.entityId || null,
          data.targetValue,
          data.actualValue ?? existing.actual_value,
          data.unit,
          data.timeframe,
          data.status || existing.status,
          JSON.stringify(data.calculationMethod || {}),
          now,
          now,
          existing.id,
          tenantId,
        ]
      );
      return (await this.findById(existing.id))!;
    }

    const id = CryptoUtils.generateId();
    const record: OrganizationKpiRecord = {
      id,
      tenant_id: tenantId,
      organization_id: 'default',
      entity_id: data.entityId,
      kpi_name: data.kpiName,
      kpi_key: data.kpiKey,
      category: data.category || 'operational',
      target_value: data.targetValue,
      actual_value: data.actualValue || 0.0,
      unit: data.unit || 'ratio',
      status: data.status || 'on_track',
      timeframe: data.timeframe || 'monthly',
      calculation_method_json: JSON.stringify(data.calculationMethod || {}),
      last_evaluated_at: now,
      created_at: now,
      updated_at: now,
    };

    await this.client.execute(
      `INSERT INTO organization_kpis (
        id, tenant_id, organization_id, entity_id, kpi_name, kpi_key, category,
        target_value, actual_value, unit, status, timeframe, calculation_method_json,
        last_evaluated_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        record.id,
        record.tenant_id,
        record.organization_id,
        record.entity_id || null,
        record.kpi_name,
        record.kpi_key,
        record.category,
        record.target_value,
        record.actual_value,
        record.unit,
        record.status,
        record.timeframe,
        record.calculation_method_json,
        record.last_evaluated_at,
        record.created_at,
        record.updated_at,
      ]
    );

    return record;
  }

  /**
   * Lists all KPIs for tenant.
   */
  public async listKpis(): Promise<OrganizationKpiRecord[]> {
    const tenantId = this.getTenantId();
    return this.client.query<OrganizationKpiRecord>(
      'SELECT * FROM organization_kpis WHERE tenant_id = ? ORDER BY category ASC, kpi_name ASC;',
      [tenantId]
    );
  }

  /**
   * Records a detected operational bottleneck.
   */
  public async recordBottleneck(params: {
    bottleneckType: BottleneckType;
    entityId?: string;
    title: string;
    description: string;
    severity: BottleneckSeverity;
    impactEstimateUsd: number;
    recommendation: string;
  }): Promise<OperationalBottleneckRecord> {
    const tenantId = this.getTenantId();
    const id = CryptoUtils.generateId();
    const now = new Date().toISOString();

    const record: OperationalBottleneckRecord = {
      id,
      tenant_id: tenantId,
      organization_id: 'default',
      bottleneck_type: params.bottleneckType,
      entity_id: params.entityId,
      title: params.title,
      description: params.description,
      severity: params.severity,
      impact_estimate_usd: params.impactEstimateUsd,
      recommendation: params.recommendation,
      status: 'detected',
      detected_at: now,
      created_at: now,
      updated_at: now,
    };

    await this.client.execute(
      `INSERT INTO operational_bottlenecks (
        id, tenant_id, organization_id, bottleneck_type, entity_id, title,
        description, severity, impact_estimate_usd, recommendation, status, detected_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        record.id,
        record.tenant_id,
        record.organization_id,
        record.bottleneck_type,
        record.entity_id || null,
        record.title,
        record.description,
        record.severity,
        record.impact_estimate_usd,
        record.recommendation,
        record.status,
        record.detected_at,
      ]
    );

    return record;
  }

  /**
   * Lists all active bottlenecks for tenant.
   */
  public async listBottlenecks(): Promise<OperationalBottleneckRecord[]> {
    const tenantId = this.getTenantId();
    return this.client.query<OperationalBottleneckRecord>(
      "SELECT * FROM operational_bottlenecks WHERE tenant_id = ? AND status != 'resolved' ORDER BY impact_estimate_usd DESC;",
      [tenantId]
    );
  }
}
