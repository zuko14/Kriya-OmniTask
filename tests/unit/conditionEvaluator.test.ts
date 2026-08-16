/**
 * Xylarc AI — Policy Condition Evaluator Unit Tests
 * Verifies deterministic condition tree evaluation, nested field resolution, and boolean logic (§14 of CLAUDE.md).
 */

import { describe, it, expect } from 'vitest';
import { ConditionEvaluator } from '../../src/policy/evaluator/conditionEvaluator.js';

describe('Policy Condition Evaluator Unit Tests', () => {
  it('should evaluate simple equality and numerical comparisons', () => {
    const context = {
      discountPercent: 25,
      channel: 'whatsapp',
      user: { role: 'admin', age: 30 },
    };

    expect(
      ConditionEvaluator.evaluate(
        { field: 'discountPercent', operator: 'GREATER_THAN', value: 20 },
        context
      )
    ).toBe(true);

    expect(
      ConditionEvaluator.evaluate(
        { field: 'discountPercent', operator: 'LESS_THAN', value: 10 },
        context
      )
    ).toBe(false);

    expect(
      ConditionEvaluator.evaluate(
        { field: 'channel', operator: 'EQUALS', value: 'whatsapp' },
        context
      )
    ).toBe(true);
  });

  it('should resolve nested dot-notation fields', () => {
    const context = {
      customer: {
        profile: {
          lifecycleStage: 'churn_risk',
          optInConsent: false,
        },
      },
    };

    expect(
      ConditionEvaluator.evaluate(
        { field: 'customer.profile.lifecycleStage', operator: 'EQUALS', value: 'churn_risk' },
        context
      )
    ).toBe(true);

    expect(
      ConditionEvaluator.evaluate(
        { field: 'customer.profile.optInConsent', operator: 'EQUALS', value: false },
        context
      )
    ).toBe(true);
  });

  it('should evaluate IN, CONTAINS, and REGEX_MATCH operators', () => {
    const context = {
      tier: 'enterprise',
      tags: ['vip', 'priority_support', 'beta_tester'],
      message: 'Here is your verification code: 998811',
    };

    expect(
      ConditionEvaluator.evaluate(
        { field: 'tier', operator: 'IN', value: ['pro', 'enterprise', 'vip'] },
        context
      )
    ).toBe(true);

    expect(
      ConditionEvaluator.evaluate(
        { field: 'tags', operator: 'CONTAINS', value: 'vip' },
        context
      )
    ).toBe(true);

    expect(
      ConditionEvaluator.evaluate(
        { field: 'message', operator: 'REGEX_MATCH', value: 'verification code: \\d{6}' },
        context
      )
    ).toBe(true);
  });

  it('should evaluate composite AND / OR / NOT boolean trees', () => {
    const context = {
      amountUsd: 150,
      isVipCustomer: true,
      hasManagerApproval: false,
    };

    // (amountUsd > 100 AND NOT hasManagerApproval) => true
    const ruleAndNot = {
      logical: 'AND' as const,
      conditions: [
        { field: 'amountUsd', operator: 'GREATER_THAN' as const, value: 100 },
        {
          logical: 'NOT' as const,
          conditions: [
            { field: 'hasManagerApproval', operator: 'EQUALS' as const, value: true },
          ],
        },
      ],
    };

    expect(ConditionEvaluator.evaluate(ruleAndNot, context)).toBe(true);

    // (amountUsd > 200 OR isVipCustomer == false) => false
    const ruleOr = {
      logical: 'OR' as const,
      conditions: [
        { field: 'amountUsd', operator: 'GREATER_THAN' as const, value: 200 },
        { field: 'isVipCustomer', operator: 'EQUALS' as const, value: false },
      ],
    };

    expect(ConditionEvaluator.evaluate(ruleOr, context)).toBe(false);
  });
});
