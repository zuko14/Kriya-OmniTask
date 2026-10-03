import { BrainSupplyRepository } from '../repositories/brainSupplyRepository.js';
import { BudgetLadderStatus, TenantBrainConfig } from '../types/brainSupplyTypes.js';
import { AttentionService } from '../../../attention/service/attentionService.js';
import { auditLogger } from '../../../security/audit/auditLogger.js';
import { ValidationError } from '../../../core/errors/errors.js';
import { logger } from '../../../core/logger/logger.js';

export class SpendBudgetAnomalyEngine {
  private brainRepo: BrainSupplyRepository;
  private attentionService: AttentionService;

  constructor(
    brainRepo: BrainSupplyRepository = new BrainSupplyRepository(),
    attentionService: AttentionService = new AttentionService()
  ) {
    this.brainRepo = brainRepo;
    this.attentionService = attentionService;
  }

  /**
   * Validates whether a brain can be activated in BYO mode (§9.8).
   * A brain CANNOT be enabled in BYO mode without a spend budget (> 0).
   */
  public validateActivationBudget(config: TenantBrainConfig): void {
    if (config.brainSupply === 'byo') {
      if (!config.monthlyBudgetUsd || config.monthlyBudgetUsd <= 0) {
        throw new ValidationError('A brain cannot be enabled in BYO mode without a monthly spend budget.');
      }
      if (!config.dailyBudgetUsd || config.dailyBudgetUsd <= 0) {
        throw new ValidationError('A brain cannot be enabled in BYO mode without a daily spend budget.');
      }
    }
  }

  /**
   * Evaluates the spend threshold ladder (70 / 85 / 95 / 100) and anomaly detection (§9.8).
   */
  public async evaluateSpendStatus(
    tenantId: string,
    currentCostIncrementUsd = 0.0
  ): Promise<BudgetLadderStatus> {
    const config = await this.brainRepo.getTenantBrainConfig(tenantId);
    const newMonthSpend = config.currentMonthSpendUsd + currentCostIncrementUsd;
    const newDaySpend = config.currentDaySpendUsd + currentCostIncrementUsd;

    const monthlyBudget = config.monthlyBudgetUsd || 50.0;
    const utilizationPct = Math.min(100, Number(((newMonthSpend / monthlyBudget) * 100).toFixed(1)));
    const dailyAvg = Number((newMonthSpend / Math.max(1, new Date().getDate())).toFixed(2));

    // Update spend on config
    if (currentCostIncrementUsd > 0) {
      await this.brainRepo.saveTenantBrainConfig({
        ...config,
        currentMonthSpendUsd: newMonthSpend,
        currentDaySpendUsd: newDaySpend,
      });
    }

    // 1. Check Spend Anomaly Detection (§9.8)
    // A sudden multiple of baseline (e.g. daily spend > 3x daily budget/avg)
    const anomalyThreshold = config.dailyBudgetUsd * config.spendAnomalyThresholdMultiplier;
    let anomalyDetected = false;
    let attentionItemId: string | undefined;

    if (newDaySpend > anomalyThreshold && config.status !== 'paused_anomaly') {
      anomalyDetected = true;
      logger.warn(
        `[SPEND ANOMALY] Spend velocity anomaly detected for tenant '${tenantId}': Daily spend $${newDaySpend.toFixed(
          2
        )} exceeded anomaly threshold $${anomalyThreshold.toFixed(2)}. Pausing execution.`
      );

      // Pause autonomous execution
      await this.brainRepo.saveTenantBrainConfig({
        ...config,
        status: 'paused_anomaly',
      });

      // Raise Attention Item in Human Attention Center
      const attentionItem = await this.attentionService.escalateToHuman({
        correlationId: `corr_anomaly_${tenantId}_${Date.now()}`,
        sourceAgentId: 'brain_spend_monitor',
        channel: 'system_monitor',
        title: 'Brain Spend Velocity Anomaly',
        description: `Sudden spend rate anomaly detected: $${newDaySpend.toFixed(2)} in 24h exceeds baseline limit. Autonomous execution paused to protect budget.`,
        reasonCategory: 'financial_threshold',
        priority: 'P1_HIGH',
        contextData: {
          tenantId,
          dailySpendUsd: newDaySpend,
          dailyBudgetUsd: config.dailyBudgetUsd,
          monthlyBudgetUsd: config.monthlyBudgetUsd,
          anomalyThreshold,
        },
      });

      attentionItemId = attentionItem.id;

      await auditLogger.logEvent({
        action: 'brain.spend_anomaly_paused',
        resourceType: 'tenant_brain_config',
        resourceId: tenantId,
        details: {
          tenantId,
          dailySpendUsd: newDaySpend,
          attentionItemId,
        },
      });
    }

    // 2. Evaluate Threshold Ladder (§9.8)
    // 70% warn → 85% shift to cheaper → 95% restrict to critical → 100% stop
    let thresholdTier: BudgetLadderStatus['thresholdTier'] = 'normal';
    let actionTaken: BudgetLadderStatus['actionTaken'] = 'proceed';

    if (utilizationPct >= 100) {
      thresholdTier = 'stop_100';
      actionTaken = 'stop_execution';
    } else if (utilizationPct >= 95) {
      thresholdTier = 'restrict_95';
      actionTaken = 'critical_only';
    } else if (utilizationPct >= 85) {
      thresholdTier = 'shift_85';
      actionTaken = 'shift_cheaper';
    } else if (utilizationPct >= 70) {
      thresholdTier = 'warn_70';
      actionTaken = 'warning';
    }

    return {
      monthlyBudgetUsd: monthlyBudget,
      currentMonthSpendUsd: newMonthSpend,
      utilizationPercentage: utilizationPct,
      dailyAverageSpendUsd: dailyAvg,
      thresholdTier,
      actionTaken,
      anomalyWatchActive: true,
      anomalyDetected,
      attentionItemId,
    };
  }
}
