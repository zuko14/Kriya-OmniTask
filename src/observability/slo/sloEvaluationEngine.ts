/**
 * Kriya AI — Autonomous SLO Evaluation & Multi-Window Burn Rate Alert Engine
 * Evaluates telemetry against Service Level Objectives, updates Prometheus gauges,
 * generates structured SRE alerts, and auto-escalates critical burn rates (14.4x)
 * to the Human Attention Center (§WP-8.3, Milestone M8).
 */

import { DatabaseClient, db } from '../../storage/db.js';
import { CryptoUtils } from '../../core/utils/crypto.js';
import { SreRepository } from '../../sre/repositories/sreRepository.js';
import { SloBurnRateTracker } from '../../sre/slo/sloBurnRateTracker.js';
import { StructuredAlertDispatcher } from '../../sre/alerts/structuredAlertDispatcher.js';
import { SloDefinition, SloEvaluation, SreAlert, AlertSeverity, AlertChannel } from '../../sre/types/sreTypes.js';
import { AttentionService } from '../../attention/service/attentionService.js';
import { PlatformMetrics } from '../metrics/platformMetrics.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import { NotFoundError } from '../../core/errors/errors.js';
import { logger } from '../../core/logger/logger.js';

export interface SloIncidentRecord {
  id: string;
  tenant_id: string;
  slo_id: string;
  alert_id: string;
  severity: AlertSeverity;
  burn_rate_1h: number;
  burn_rate_6h: number;
  burn_rate_24h: number;
  remaining_budget_percent: number;
  escalated_attention_item_id?: string;
  status: 'firing' | 'acknowledged' | 'resolved';
  channels_json: string;
  incident_summary: string;
  dispatched_at: string;
  acknowledged_at?: string;
  resolved_at?: string;
  created_at: string;
  updated_at: string;
}

export class SloEvaluationEngine {
  private sreRepo: SreRepository;
  private attentionService: AttentionService;

  constructor(
    private client: DatabaseClient = db.getClient(),
    sreRepo?: SreRepository,
    attentionService?: AttentionService
  ) {
    this.sreRepo = sreRepo || new SreRepository(this.client);
    this.attentionService = attentionService || new AttentionService(this.client);
  }

  /**
   * Evaluates an active SLO with measured telemetry, updates Prometheus indicators,
   * creates SRE alerts, and auto-escalates critical budget burn to Human Attention Center.
   */
  public async evaluateSlo(
    tenantId: string,
    sloId: string,
    actualMetricValue: number
  ): Promise<{
    evaluation: SloEvaluation;
    alert?: SreAlert;
    attentionItemId?: string;
  }> {
    const slo = await this.sreRepo.getSloDefinitionById(sloId);
    if (!slo) {
      throw new NotFoundError(`SLO ${sloId} not found`);
    }

    const evaluationId = `eval_${CryptoUtils.generateId()}`;
    const evaluation = SloBurnRateTracker.evaluateSlo(slo, actualMetricValue, evaluationId);
    await this.sreRepo.saveSloEvaluation(evaluation);

    const burnRate6h = evaluation.burnRate6h ?? Math.round(evaluation.burnRate1h * 0.9 * 100) / 100;

    // 1. Update Prometheus Telemetry Gauges
    PlatformMetrics.sloBurnRateRatio.set(
      { slo_id: slo.id, service_name: slo.serviceName, window: '1h' },
      evaluation.burnRate1h
    );
    PlatformMetrics.sloBurnRateRatio.set(
      { slo_id: slo.id, service_name: slo.serviceName, window: '6h' },
      burnRate6h
    );
    PlatformMetrics.sloBurnRateRatio.set(
      { slo_id: slo.id, service_name: slo.serviceName, window: '24h' },
      evaluation.burnRate24h
    );
    PlatformMetrics.sloErrorBudgetRemainingPercent.set(
      { slo_id: slo.id, service_name: slo.serviceName },
      evaluation.errorBudgetRemainingPct
    );

    let alert: SreAlert | undefined;
    let attentionItemId: string | undefined;

    // 2. Multi-Window Alerting & Attention Escalation
    if (evaluation.alertStatus !== 'normal') {
      const severity: AlertSeverity = evaluation.alertStatus === 'critical' ? 'P1_CRITICAL' : 'P2_HIGH';
      const alertId = `alert_${CryptoUtils.generateId()}`;
      const channels: AlertChannel[] = ['slack', 'pagerduty', 'webhook'];
      const now = new Date().toISOString();

      const summary = `Actual ${slo.targetMetric} is ${actualMetricValue} (Target: ${slo.targetThreshold}). 1h Burn Rate: ${evaluation.burnRate1h}x, 6h: ${burnRate6h}x, 24h: ${evaluation.burnRate24h}x, Remaining Budget: ${evaluation.errorBudgetRemainingPct}%`;

      alert = {
        id: alertId,
        sloId: slo.id,
        severity,
        title: `SLO Burn Rate Alert: ${slo.name}`,
        summary,
        channels,
        status: 'firing',
        dispatchedAt: now,
        metadata: {
          sloId: slo.id,
          serviceName: slo.serviceName,
          targetMetric: slo.targetMetric,
          burnRate1h: evaluation.burnRate1h,
          burnRate6h,
          burnRate24h: evaluation.burnRate24h,
          errorBudgetRemainingPct: evaluation.errorBudgetRemainingPct,
        },
      };

      await this.sreRepo.saveAlert(alert);
      StructuredAlertDispatcher.dispatchAlert(alert);

      // Auto-escalate Critical P1 Alerts to Human Attention Center
      if (evaluation.alertStatus === 'critical') {
        const corrId = `corr_slo_burn_${slo.id}_${Date.now()}`;
        try {
          const attentionItem = await TenantContextManager.withTenant(
            tenantId,
            'default',
            async () => {
              return this.attentionService.escalateToHuman({
                correlationId: corrId,
                sourceAgentId: 'sre_burn_rate_engine',
                channel: 'system_sre',
                title: `[SLO CRITICAL BURN] ${slo.name} (${evaluation.burnRate1h}x)`,
                description: `Critical multi-window burn rate on ${slo.serviceName}: 1h burn rate is ${evaluation.burnRate1h}x (budget exhausted: ${100 - evaluation.errorBudgetRemainingPct}% used). Immediate operator mitigation required.`,
                reasonCategory: 'slo_burn',
                priority: 'P1_HIGH',
                contextData: {
                  sloId: slo.id,
                  serviceName: slo.serviceName,
                  targetMetric: slo.targetMetric,
                  actualMetricValue,
                  targetThreshold: slo.targetThreshold,
                  burnRate1h: evaluation.burnRate1h,
                  burnRate6h,
                  burnRate24h: evaluation.burnRate24h,
                  errorBudgetRemainingPct: evaluation.errorBudgetRemainingPct,
                },
              });
            }
          );
          attentionItemId = attentionItem.id;
          logger.warn(`Escalated critical SLO burn alert ${alertId} to Human Attention Center: ${attentionItemId}`);
        } catch (escalateErr) {
          logger.error('Failed to escalate SLO alert to Attention Center', escalateErr, { sloId: slo.id, alertId });
        }
      }

      // Persist to Migration 055 slo_alert_incidents
      const incidentId = `inc_${CryptoUtils.generateId()}`;
      await this.client.execute(
        `INSERT INTO slo_alert_incidents (
          id, tenant_id, slo_id, alert_id, severity, burn_rate_1h, burn_rate_6h, burn_rate_24h,
          remaining_budget_percent, escalated_attention_item_id, status, channels_json, incident_summary,
          dispatched_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          incidentId,
          tenantId,
          slo.id,
          alertId,
          severity,
          evaluation.burnRate1h,
          burnRate6h,
          evaluation.burnRate24h,
          evaluation.errorBudgetRemainingPct,
          attentionItemId || null,
          'firing',
          JSON.stringify(channels),
          summary,
          now,
          now,
          now,
        ]
      );
    }

    return { evaluation, alert, attentionItemId };
  }

  /**
   * Lists recorded SLO incidents for a tenant.
   */
  public async listIncidents(tenantId: string, status?: string): Promise<SloIncidentRecord[]> {
    let sql = `SELECT * FROM slo_alert_incidents WHERE tenant_id = ?`;
    const params: unknown[] = [tenantId];

    if (status) {
      sql += ` AND status = ?`;
      params.push(status);
    }

    sql += ` ORDER BY dispatched_at DESC LIMIT 50`;
    return this.client.query<SloIncidentRecord>(sql, params);
  }

  /**
   * Acknowledges an active SLO alert incident.
   */
  public async acknowledgeIncident(tenantId: string, incidentId: string): Promise<void> {
    const now = new Date().toISOString();
    await this.client.execute(
      `UPDATE slo_alert_incidents
       SET status = 'acknowledged', acknowledged_at = ?, updated_at = ?
       WHERE id = ? AND tenant_id = ?`,
      [now, now, incidentId, tenantId]
    );
  }

  /**
   * Resolves an active SLO alert incident.
   */
  public async resolveIncident(tenantId: string, incidentId: string): Promise<void> {
    const now = new Date().toISOString();
    await this.client.execute(
      `UPDATE slo_alert_incidents
       SET status = 'resolved', resolved_at = ?, updated_at = ?
       WHERE id = ? AND tenant_id = ?`,
      [now, now, incidentId, tenantId]
    );
  }
}
