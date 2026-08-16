import { describe, it, expect } from 'vitest';
import { BudgetEnforcer } from '../../src/cost/budget/budgetEnforcer.js';
import { TenantBudgetPolicy } from '../../src/cost/types/costTypes.js';

describe('BudgetEnforcer Unit Tests', () => {
  const policy: TenantBudgetPolicy = {
    id: 'tbp_1',
    tenantId: 'tenant_1',
    organizationId: 'org_1',
    monthlyBudgetUsd: 100.0,
    dailyBudgetUsd: 10.0,
    warningThresholdPct: 80.0,
    hardCapAction: 'circuit_break_reject',
    currentMonthSpendUsd: 50.0,
    currentDaySpendUsd: 5.0,
    isCircuitBroken: false,
    lastResetAt: '2026-01-01T00:00:00Z',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  it('should permit execution when spend is within normal budget limits', () => {
    const res = BudgetEnforcer.evaluateBudget(policy, 1.0);
    expect(res.allowed).toBe(true);
    expect(res.actionTaken).toBe('proceed');
    expect(res.monthlyUtilizationPct).toBe(51.0);
  });

  it('should trigger warning when spend crosses warning threshold (>= 80%)', () => {
    const res = BudgetEnforcer.evaluateBudget(policy, 3.5); // 5.0 + 3.5 = 8.5 / 10 = 85% daily
    expect(res.allowed).toBe(true);
    expect(res.actionTaken).toBe('warning');
    expect(res.dailyUtilizationPct).toBe(85.0);
  });

  it('should enforce hard circuit break and block execution when spend exceeds budget ceiling', () => {
    const res = BudgetEnforcer.evaluateBudget(policy, 6.0); // 5.0 + 6.0 = 11.0 >= 10.0 daily
    expect(res.allowed).toBe(false);
    expect(res.actionTaken).toBe('circuit_break');
    expect(res.reason).toContain('Budget cap reached');
  });

  it('should support degraded mode when hardCapAction is degrade_to_cheapest_model', () => {
    const degradedPolicy: TenantBudgetPolicy = {
      ...policy,
      hardCapAction: 'degrade_to_cheapest_model',
    };

    const res = BudgetEnforcer.evaluateBudget(degradedPolicy, 6.0);
    expect(res.allowed).toBe(true);
    expect(res.actionTaken).toBe('degraded_mode');
  });
});
