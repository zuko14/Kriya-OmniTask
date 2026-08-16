/**
 * Xylarc AI — Outcome Unit Economics Engine
 * Calculates true cost-per-outcome, ROI multipliers, and aggregate economic efficiency metrics.
 */

import {
  BusinessOutcomeRecord,
  CostAttributionRecord,
  RecordOutcomeRequest,
  UnitEconomicsSummary,
  OutcomeType,
} from '../types/costTypes.js';
import { CryptoUtils } from '../../core/utils/crypto.js';

export class OutcomeUnitEconomicsEngine {
  /**
   * Constructs a business outcome record with linked task cost aggregation and ROI derivation.
   */
  public static calculateOutcome(
    tenantId: string,
    organizationId: string,
    request: RecordOutcomeRequest,
    linkedCosts: CostAttributionRecord[]
  ): BusinessOutcomeRecord {
    const outcomeId = `out_${CryptoUtils.generateId()}`;
    const now = new Date().toISOString();

    const totalCostUsd = linkedCosts.reduce((sum, item) => sum + item.totalCostUsd, 0);
    const valueGenerated = request.valueGeneratedUsd || 0.0;

    let roiMultiplier = 0.0;
    if (totalCostUsd > 0) {
      roiMultiplier = Number(((valueGenerated - totalCostUsd) / totalCostUsd).toFixed(2));
    } else if (valueGenerated > 0) {
      roiMultiplier = Number(valueGenerated.toFixed(2));
    }

    return {
      id: outcomeId,
      tenantId,
      organizationId,
      agentId: request.agentId,
      workflowExecutionId: request.workflowExecutionId,
      outcomeType: request.outcomeType,
      outcomeStatus: request.outcomeStatus || 'achieved',
      valueGeneratedUsd: Number(valueGenerated.toFixed(2)),
      totalCostUsd: Number(totalCostUsd.toFixed(6)),
      roiMultiplier,
      outcomeMetadata: request.metadata || {},
      createdAt: now,
    };
  }

  /**
   * Computes aggregate unit economics by outcome type.
   */
  public static aggregateUnitEconomics(
    outcomes: BusinessOutcomeRecord[]
  ): Record<OutcomeType, UnitEconomicsSummary> {
    const groups: Partial<Record<OutcomeType, BusinessOutcomeRecord[]>> = {};

    for (const outcome of outcomes) {
      if (!groups[outcome.outcomeType]) {
        groups[outcome.outcomeType] = [];
      }
      groups[outcome.outcomeType]!.push(outcome);
    }

    const summaries: Partial<Record<OutcomeType, UnitEconomicsSummary>> = {};

    for (const [typeStr, group] of Object.entries(groups)) {
      const type = typeStr as OutcomeType;
      const totalCount = group.length;
      const achievedCount = group.filter((o) => o.outcomeStatus === 'achieved').length;
      const successRatePct = totalCount > 0 ? Number(((achievedCount / totalCount) * 100).toFixed(1)) : 0;
      const totalCostUsd = group.reduce((sum, o) => sum + o.totalCostUsd, 0);
      const totalValueGeneratedUsd = group.reduce((sum, o) => sum + o.valueGeneratedUsd, 0);
      const avgCostPerOutcomeUsd = totalCount > 0 ? Number((totalCostUsd / totalCount).toFixed(4)) : 0;
      const avgRoiMultiplier =
        totalCostUsd > 0
          ? Number(((totalValueGeneratedUsd - totalCostUsd) / totalCostUsd).toFixed(2))
          : 0;

      summaries[type] = {
        outcomeType: type,
        totalCount,
        achievedCount,
        successRatePct,
        totalCostUsd: Number(totalCostUsd.toFixed(4)),
        totalValueGeneratedUsd: Number(totalValueGeneratedUsd.toFixed(2)),
        avgCostPerOutcomeUsd,
        avgRoiMultiplier,
      };
    }

    return summaries as Record<OutcomeType, UnitEconomicsSummary>;
  }
}
