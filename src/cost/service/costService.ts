/**
 * Xylarc AI — Cost Intelligence Service
 * High-level orchestration for cost attribution, unit economics calculation, and budget enforcement.
 */

import { CostRepository } from '../repositories/costRepository.js';
import { CostAttributionEngine } from '../attribution/costAttributionEngine.js';
import { OutcomeUnitEconomicsEngine } from '../outcomes/outcomeUnitEconomicsEngine.js';
import { BudgetEnforcer } from '../budget/budgetEnforcer.js';
import {
  RecordCostRequest,
  CostAttributionRecord,
  RecordOutcomeRequest,
  BusinessOutcomeRecord,
  TenantBudgetPolicy,
  UpdateBudgetPolicyRequest,
  UnitEconomicsSummary,
  SpendBreakdown,
  BudgetEvaluationResult,
  OutcomeType,
} from '../types/costTypes.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import { CryptoUtils } from '../../core/utils/crypto.js';

export class CostService {
  private repo = new CostRepository();

  /**
   * Ingests a new cost record and updates tenant budget spend counters.
   */
  public async recordCost(request: RecordCostRequest): Promise<CostAttributionRecord> {
    const tenantId = TenantContextManager.getTenantId();
    const orgId = TenantContextManager.getRequired().organizationId || 'default';

    const record = CostAttributionEngine.attributeCost(tenantId, orgId, request);
    await this.repo.insertCostRecord(record);

    // Increment tenant policy spend counters
    await this.repo.incrementSpend(tenantId, orgId, record.totalCostUsd);

    // Evaluate budget and trip circuit breaker if hard cap reached
    const policy = await this.repo.getBudgetPolicy(tenantId, orgId);
    if (policy && !policy.isCircuitBroken) {
      const evaluation = BudgetEnforcer.evaluateBudget(policy, 0);
      if (evaluation.actionTaken === 'circuit_break') {
        await this.repo.setCircuitBreaker(tenantId, orgId, true);
      }
    }

    return record;
  }

  public async listCostRecords(limit = 100): Promise<CostAttributionRecord[]> {
    const tenantId = TenantContextManager.getTenantId();
    return this.repo.listCostRecords(tenantId, limit);
  }

  /**
   * Records a business outcome, linking its matched task costs to derive exact unit economics and ROI.
   */
  public async recordOutcome(request: RecordOutcomeRequest): Promise<BusinessOutcomeRecord> {
    const tenantId = TenantContextManager.getTenantId();
    const orgId = TenantContextManager.getRequired().organizationId || 'default';

    let linkedCosts: CostAttributionRecord[] = [];
    if (request.taskIds && request.taskIds.length > 0) {
      linkedCosts = await this.repo.getCostRecordsByTaskIds(tenantId, request.taskIds);
    }

    const outcome = OutcomeUnitEconomicsEngine.calculateOutcome(tenantId, orgId, request, linkedCosts);
    await this.repo.insertBusinessOutcome(outcome);

    return outcome;
  }

  public async listBusinessOutcomes(limit = 100): Promise<BusinessOutcomeRecord[]> {
    const tenantId = TenantContextManager.getTenantId();
    return this.repo.listBusinessOutcomes(tenantId, limit);
  }

  public async getUnitEconomics(): Promise<Record<OutcomeType, UnitEconomicsSummary>> {
    const tenantId = TenantContextManager.getTenantId();
    const outcomes = await this.repo.listBusinessOutcomes(tenantId, 500);
    return OutcomeUnitEconomicsEngine.aggregateUnitEconomics(outcomes);
  }

  public async getSpendBreakdown(): Promise<SpendBreakdown> {
    const tenantId = TenantContextManager.getTenantId();
    const orgId = TenantContextManager.getRequired().organizationId || 'default';

    const summary = await this.repo.getTenantSpendSummary(tenantId);
    const policy = await this.repo.getBudgetPolicy(tenantId, orgId);

    return BudgetEnforcer.buildSpendBreakdown(
      summary.totalSpendUsd,
      summary.byCategory,
      summary.byProvider,
      summary.byAgent,
      policy
    );
  }

  public async getBudgetPolicy(): Promise<TenantBudgetPolicy | null> {
    const tenantId = TenantContextManager.getTenantId();
    const orgId = TenantContextManager.getRequired().organizationId || 'default';
    return this.repo.getBudgetPolicy(tenantId, orgId);
  }

  public async updateBudgetPolicy(request: UpdateBudgetPolicyRequest): Promise<TenantBudgetPolicy> {
    const tenantId = TenantContextManager.getTenantId();
    const orgId = TenantContextManager.getRequired().organizationId || 'default';
    const now = new Date().toISOString();

    const existing = await this.repo.getBudgetPolicy(tenantId, orgId);

    const policy: TenantBudgetPolicy = {
      id: existing ? existing.id : `tbp_${CryptoUtils.generateId()}`,
      tenantId,
      organizationId: orgId,
      monthlyBudgetUsd: request.monthlyBudgetUsd,
      dailyBudgetUsd: request.dailyBudgetUsd,
      warningThresholdPct: request.warningThresholdPct,
      hardCapAction: request.hardCapAction,
      currentMonthSpendUsd: existing ? existing.currentMonthSpendUsd : 0.0,
      currentDaySpendUsd: existing ? existing.currentDaySpendUsd : 0.0,
      isCircuitBroken: existing ? existing.isCircuitBroken : false,
      lastResetAt: existing ? existing.lastResetAt : now,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
    };

    await this.repo.upsertBudgetPolicy(policy);
    return policy;
  }

  public async evaluateBudgetSafety(estimatedCostUsd = 0.0): Promise<BudgetEvaluationResult> {
    const tenantId = TenantContextManager.getTenantId();
    const orgId = TenantContextManager.getRequired().organizationId || 'default';
    const policy = await this.repo.getBudgetPolicy(tenantId, orgId);
    return BudgetEnforcer.evaluateBudget(policy, estimatedCostUsd);
  }

  public async resetCircuitBreaker(): Promise<void> {
    const tenantId = TenantContextManager.getTenantId();
    const orgId = TenantContextManager.getRequired().organizationId || 'default';
    await this.repo.setCircuitBreaker(tenantId, orgId, false);
  }
}
