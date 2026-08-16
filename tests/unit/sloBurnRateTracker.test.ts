import { describe, it, expect } from 'vitest';
import { SloBurnRateTracker } from '../../src/sre/slo/sloBurnRateTracker.js';
import { SloDefinition } from '../../src/sre/types/sreTypes.js';

describe('SloBurnRateTracker Unit Tests', () => {
  const availabilitySlo: SloDefinition = {
    id: 'slo_avail_test',
    name: 'Core Agent Gateway Availability',
    serviceName: 'agent-gateway',
    targetMetric: 'availability',
    targetThreshold: 99.9, // 99.9% target -> 0.1% allowed error budget
    windowDays: 30,
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  it('should evaluate compliant SLO and maintain error budget under healthy metrics', () => {
    // 100% availability -> 0 deficit -> 100% budget remaining
    const perfectEval = SloBurnRateTracker.evaluateSlo(availabilitySlo, 100.0, 'eval_perf');
    expect(perfectEval.isCompliant).toBe(true);
    expect(perfectEval.errorBudgetRemainingPct).toBe(100);
    expect(perfectEval.burnRate1h).toBe(0);
    expect(perfectEval.alertStatus).toBe('normal');

    // 99.95% availability -> 0.05% error out of 0.1% budget -> 50% budget remaining, 0.5x burn rate
    const evalResult = SloBurnRateTracker.evaluateSlo(availabilitySlo, 99.95, 'eval_1');
    expect(evalResult.isCompliant).toBe(true);
    expect(evalResult.errorBudgetRemainingPct).toBe(50);
    expect(evalResult.burnRate1h).toBe(0.5);
    expect(evalResult.alertStatus).toBe('normal');
  });

  it('should calculate elevated burn rates and trigger warning or critical alert status on budget exhaustion', () => {
    // Metric drops to 98.0% (Deficit = 2.0% on 0.1% budget -> Burn Rate = 20x -> Critical Alert)
    const criticalEval = SloBurnRateTracker.evaluateSlo(availabilitySlo, 98.0, 'eval_crit');

    expect(criticalEval.isCompliant).toBe(false);
    expect(criticalEval.burnRate1h).toBeGreaterThanOrEqual(14.4); // > 14.4x burn rate
    expect(criticalEval.errorBudgetRemainingPct).toBe(0);
    expect(criticalEval.alertStatus).toBe('critical');

    // Metric drops to 99.7% (Deficit = 0.3% on 0.1% budget -> Burn Rate = 3.0x -> Warning Alert)
    const warningEval = SloBurnRateTracker.evaluateSlo(availabilitySlo, 99.7, 'eval_warn');

    expect(warningEval.isCompliant).toBe(false);
    expect(warningEval.burnRate1h).toBe(3.0);
    expect(warningEval.alertStatus).toBe('warning');
  });
});
