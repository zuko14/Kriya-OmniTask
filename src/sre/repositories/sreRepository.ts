/**
 * Kriya AI — Site Reliability Engineering (SRE) Repository
 * Database access layer for SLO definitions, evaluations, and alerts.
 */

import { DatabaseClient } from '../../storage/db.js';
import { SloDefinition, SloEvaluation, SreAlert } from '../types/sreTypes.js';

export class SreRepository {
  constructor(private client: DatabaseClient) {}

  public async saveSloDefinition(slo: SloDefinition): Promise<void> {
    await this.client.execute(
      `INSERT INTO slo_definitions (
        id, name, service_name, target_metric, target_threshold, window_days, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        target_threshold = excluded.target_threshold,
        window_days = excluded.window_days,
        is_active = excluded.is_active,
        updated_at = excluded.updated_at;`,
      [
        slo.id,
        slo.name,
        slo.serviceName,
        slo.targetMetric,
        slo.targetThreshold,
        slo.windowDays,
        slo.isActive ? 1 : 0,
        slo.createdAt,
        slo.updatedAt,
      ]
    );
  }

  public async getSloDefinitionById(id: string): Promise<SloDefinition | null> {
    const rows = await this.client.query<any>('SELECT * FROM slo_definitions WHERE id = ?;', [id]);
    if (!rows.length) return null;
    return this.mapRowToSlo(rows[0]);
  }

  public async listSloDefinitions(): Promise<SloDefinition[]> {
    const rows = await this.client.query<any>('SELECT * FROM slo_definitions WHERE is_active = 1;');
    return rows.map((r: any) => this.mapRowToSlo(r));
  }

  public async saveSloEvaluation(evaluation: SloEvaluation): Promise<void> {
    await this.client.execute(
      `INSERT INTO slo_evaluations (
        id, slo_id, evaluation_timestamp, actual_metric_value, is_compliant,
        error_budget_total_pct, error_budget_remaining_pct, burn_rate_1h, burn_rate_24h, alert_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        evaluation.id,
        evaluation.sloId,
        evaluation.evaluationTimestamp,
        evaluation.actualMetricValue,
        evaluation.isCompliant ? 1 : 0,
        evaluation.errorBudgetTotalPct,
        evaluation.errorBudgetRemainingPct,
        evaluation.burnRate1h,
        evaluation.burnRate24h,
        evaluation.alertStatus,
      ]
    );
  }

  public async getLatestEvaluationForSlo(sloId: string): Promise<SloEvaluation | null> {
    const rows = await this.client.query<any>(
      'SELECT * FROM slo_evaluations WHERE slo_id = ? ORDER BY evaluation_timestamp DESC LIMIT 1;',
      [sloId]
    );
    if (!rows.length) return null;
    const r = rows[0];
    return {
      id: r.id,
      sloId: r.slo_id,
      evaluationTimestamp: r.evaluation_timestamp,
      actualMetricValue: Number(r.actual_metric_value),
      isCompliant: Boolean(r.is_compliant),
      errorBudgetTotalPct: Number(r.error_budget_total_pct),
      errorBudgetRemainingPct: Number(r.error_budget_remaining_pct),
      burnRate1h: Number(r.burn_rate_1h),
      burnRate24h: Number(r.burn_rate_24h),
      alertStatus: r.alert_status,
    };
  }

  public async saveAlert(alert: SreAlert): Promise<void> {
    await this.client.execute(
      `INSERT INTO sre_alerts (
        id, slo_id, severity, title, summary, channels_json, status,
        dispatched_at, acknowledged_at, resolved_at, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        acknowledged_at = excluded.acknowledged_at,
        resolved_at = excluded.resolved_at;`,
      [
        alert.id,
        alert.sloId ?? null,
        alert.severity,
        alert.title,
        alert.summary,
        JSON.stringify(alert.channels),
        alert.status,
        alert.dispatchedAt,
        alert.acknowledgedAt ?? null,
        alert.resolvedAt ?? null,
        alert.metadata ? JSON.stringify(alert.metadata) : null,
      ]
    );
  }

  public async getAlertById(id: string): Promise<SreAlert | null> {
    const rows = await this.client.query<any>('SELECT * FROM sre_alerts WHERE id = ?;', [id]);
    if (!rows.length) return null;
    return this.mapRowToAlert(rows[0]);
  }

  public async listAlerts(status?: SreAlert['status'], limit = 50): Promise<SreAlert[]> {
    const query = status
      ? 'SELECT * FROM sre_alerts WHERE status = ? ORDER BY dispatched_at DESC LIMIT ?;'
      : 'SELECT * FROM sre_alerts ORDER BY dispatched_at DESC LIMIT ?;';
    const params = status ? [status, limit] : [limit];

    const rows = await this.client.query<any>(query, params);
    return rows.map((r: any) => this.mapRowToAlert(r));
  }

  public async updateAlertStatus(
    id: string,
    status: SreAlert['status'],
    timestamp: string = new Date().toISOString()
  ): Promise<void> {
    if (status === 'acknowledged') {
      await this.client.execute(
        'UPDATE sre_alerts SET status = ?, acknowledged_at = ? WHERE id = ?;',
        [status, timestamp, id]
      );
    } else if (status === 'resolved') {
      await this.client.execute(
        'UPDATE sre_alerts SET status = ?, resolved_at = ? WHERE id = ?;',
        [status, timestamp, id]
      );
    }
  }

  private mapRowToSlo(r: any): SloDefinition {
    return {
      id: r.id,
      name: r.name,
      serviceName: r.service_name,
      targetMetric: r.target_metric,
      targetThreshold: Number(r.target_threshold),
      windowDays: Number(r.window_days),
      isActive: Boolean(r.is_active),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  private mapRowToAlert(r: any): SreAlert {
    return {
      id: r.id,
      sloId: r.slo_id ?? undefined,
      severity: r.severity,
      title: r.title,
      summary: r.summary,
      channels: JSON.parse(r.channels_json),
      status: r.status,
      dispatchedAt: r.dispatched_at,
      acknowledgedAt: r.acknowledged_at ?? undefined,
      resolvedAt: r.resolved_at ?? undefined,
      metadata: r.metadata_json ? JSON.parse(r.metadata_json) : undefined,
    };
  }
}
