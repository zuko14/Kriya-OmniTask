/**
 * Xylarc AI — Workflow Data Interpolator Unit Tests
 * Verifies runtime template interpolation across context and prior step outputs (§13 of CLAUDE.md).
 */

import { describe, it, expect } from 'vitest';
import { DataInterpolator, InterpolationScope } from '../../src/workflows/interpolator/dataInterpolator.js';

describe('Workflow Data Interpolator Unit Tests', () => {
  const scope: InterpolationScope = {
    context: {
      customerPhone: '+919988112233',
      discountPercent: 15,
      isVip: true,
      user: { name: 'Alice Smith', org: 'Acme Corp' },
    },
    steps: {
      step_qualification: {
        stepId: 'step_qualification',
        stepName: 'Lead Qualification',
        type: 'agent_task',
        status: 'completed',
        output: {
          isQualified: true,
          score: 88,
          notes: 'High purchase intent',
        },
        durationMs: 120,
        executedAt: new Date().toISOString(),
      },
      step_calendar: {
        stepId: 'step_calendar',
        stepName: 'Check Slots',
        type: 'tool_execution',
        status: 'completed',
        output: {
          availableSlot: '2026-08-20T10:00:00Z',
          confirmed: true,
        },
        durationMs: 45,
        executedAt: new Date().toISOString(),
      },
    },
  };

  it('should preserve primitive data types on exact variable substitution', () => {
    const interpolatedBoolean = DataInterpolator.interpolate('${context.isVip}', scope);
    expect(interpolatedBoolean).toBe(true);

    const interpolatedNumber = DataInterpolator.interpolate('${context.discountPercent}', scope);
    expect(interpolatedNumber).toBe(15);

    const interpolatedStepScore = DataInterpolator.interpolate(
      '${steps.step_qualification.output.score}',
      scope
    );
    expect(interpolatedStepScore).toBe(88);
  });

  it('should interpolate embedded string variables', () => {
    const template = 'Hello ${context.user.name} from ${context.user.org}! Slot: ${steps.step_calendar.output.availableSlot}';
    const result = DataInterpolator.interpolate(template, scope);
    expect(result).toBe('Hello Alice Smith from Acme Corp! Slot: 2026-08-20T10:00:00Z');
  });

  it('should recursively interpolate nested objects and arrays', () => {
    const payload = {
      recipient: '${context.customerPhone}',
      meta: {
        qualified: '${steps.step_qualification.output.isQualified}',
        slots: ['${steps.step_calendar.output.availableSlot}', '2026-08-21T10:00:00Z'],
      },
    };

    const result: any = DataInterpolator.interpolate(payload, scope);
    expect(result.recipient).toBe('+919988112233');
    expect(result.meta.qualified).toBe(true);
    expect(result.meta.slots[0]).toBe('2026-08-20T10:00:00Z');
    expect(result.meta.slots[1]).toBe('2026-08-21T10:00:00Z');
  });
});
