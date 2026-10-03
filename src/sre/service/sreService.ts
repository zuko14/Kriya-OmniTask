/**
 * Kriya AI — Site Reliability Engineering (SRE) Service
 * Orchestrates waterfall trace rendering, SLO evaluations, burn rate tracking, and incident alerting.
 */

import { CryptoUtils } from '../../core/utils/crypto.js';
import { SreRepository } from '../repositories/sreRepository.js';
import { TraceRepository } from '../../observability/repositories/traceRepository.js';
import { WaterfallTraceVisualizer } from '../waterfall/waterfallTraceVisualizer.js';
import { SloBurnRateTracker } from '../slo/sloBurnRateTracker.js';
import { StructuredAlertDispatcher } from '../alerts/structuredAlertDispatcher.js';
import {
  SloDefinition,
  SloEvaluation,
  SreAlert,
  WaterfallTraceView,
  AlertChannel,
  AlertSeverity,
} from '../types/sreTypes.js';
import { NotFoundError } from '../../core/errors/errors.js';
import { logger } from '../../core/logger/logger.js';

export class SreService {
  constructor(
    private sreRepo: SreRepository,
    private traceRepo: TraceRepository
  ) {}

  /**
   * Generates a waterfall timeline visualization for a distributed trace.
   */
  public async getTraceWaterfall(traceId: string): Promise<WaterfallTraceView> {
    const spans = await this.traceRepo.listSpans(traceId);
    return WaterfallTraceVisualizer.buildWaterfallView(traceId, spans);
  }

  /**
   * Registers or updates a Service Level Objective (SLO).
   */
  public async createSlo(
    name: string,
    serviceName: string,
    targetMetric: SloDefinition['targetMetric'],
    targetThreshold: number,
    windowDays = 30
  ): Promise<SloDefinition> {
    const now = new Date().toISOString();
    const slo: SloDefinition = {
      id: `slo_${CryptoUtils.generateId()}`,
      name,
      serviceName,
      targetMetric,
      targetThreshold,
      windowDays,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };

    await this.sreRepo.saveSloDefinition(slo);
    logger.info(`Created SLO '${slo.name}' for service '${slo.serviceName}' (Threshold: ${slo.targetThreshold})`);
    return slo;
  }

  /**
   * Evaluates an active SLO with measured telemetry and automatically creates alerts on budget burn.
   */
  public async evaluateSlo(sloId: string, actualMetricValue: number): Promise<SloEvaluation> {
    const slo = await this.sreRepo.getSloDefinitionById(sloId);
    if (!slo) {
      throw new NotFoundError(`SLO ${sloId} not found`);
    }

    const evaluationId = `eval_${CryptoUtils.generateId()}`;
    const evaluation = SloBurnRateTracker.evaluateSlo(slo, actualMetricValue, evaluationId);
    await this.sreRepo.saveSloEvaluation(evaluation);

    // If burn rate is critical or warning, generate an incident alert
    if (evaluation.alertStatus !== 'normal') {
      const severity: AlertSeverity = evaluation.alertStatus === 'critical' ? 'P1_CRITICAL' : 'P2_HIGH';
      const alertId = `alert_${CryptoUtils.generateId()}`;
      const channels: AlertChannel[] = ['slack', 'pagerduty', 'webhook'];

      const alert: SreAlert = {
        id: alertId,
        sloId: slo.id,
        severity,
        title: `SLO Burn Rate Alert: ${slo.name}`,
        summary: `Actual ${slo.targetMetric} is ${actualMetricValue} (Target: ${slo.targetThreshold}). 1h Burn Rate: ${evaluation.burnRate1h}x, Remaining Budget: ${evaluation.errorBudgetRemainingPct}%`,
        channels,
        status: 'firing',
        dispatchedAt: new Date().toISOString(),
        metadata: {
          sloId: slo.id,
          serviceName: slo.serviceName,
          targetMetric: slo.targetMetric,
          burnRate1h: evaluation.burnRate1h,
          burnRate24h: evaluation.burnRate24h,
        },
      };

      await this.sreRepo.saveAlert(alert);
      const dispatched = StructuredAlertDispatcher.dispatchAlert(alert);
      logger.warn(`Dispatched SRE Alert ${alert.id} (${alert.severity}) to ${dispatched.length} channels`);
    }

    return evaluation;
  }

  public async listSlos(): Promise<SloDefinition[]> {
    return this.sreRepo.listSloDefinitions();
  }

  public async listAlerts(status?: SreAlert['status'], limit = 50): Promise<SreAlert[]> {
    return this.sreRepo.listAlerts(status, limit);
  }

  public async acknowledgeAlert(alertId: string): Promise<void> {
    const alert = await this.sreRepo.getAlertById(alertId);
    if (!alert) {
      throw new NotFoundError(`Alert ${alertId} not found`);
    }
    await this.sreRepo.updateAlertStatus(alertId, 'acknowledged');
    logger.info(`Acknowledged SRE alert ${alertId}`);
  }

  public async resolveAlert(alertId: string): Promise<void> {
    const alert = await this.sreRepo.getAlertById(alertId);
    if (!alert) {
      throw new NotFoundError(`Alert ${alertId} not found`);
    }
    await this.sreRepo.updateAlertStatus(alertId, 'resolved');
    logger.info(`Resolved SRE alert ${alertId}`);
  }
}
