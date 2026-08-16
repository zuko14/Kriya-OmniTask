import { describe, it, expect } from 'vitest';
import { BottleneckDetector } from '../../src/digitaltwin/diagnostics/bottleneckDetector.js';

describe('Operational Bottleneck & Revenue Leak Detector Unit Tests', () => {
  it('should detect revenue leak from low lead-to-booking conversion ratio', () => {
    const leaks = BottleneckDetector.diagnoseFunnel({
      totalLeads: 100,
      qualifiedLeads: 50,
      bookedAppointments: 5, // Only 10% (threshold: 40%)
      closedWonCustomers: 2,
      averageContractValueUsd: 2000,
    });

    expect(leaks.length).toBe(1);
    expect(leaks[0].bottleneckType).toBe('revenue_leak');
    expect(leaks[0].severity).toBe('HIGH');
    expect(leaks[0].impactEstimateUsd).toBeGreaterThan(0);
    expect(leaks[0].recommendation).toContain('Calendar Booking Specialist');
  });

  it('should detect operational support bottlenecks (SLA breaches, escalations, churn)', () => {
    const bottlenecks = BottleneckDetector.diagnoseSupportOperations({
      totalTickets: 100,
      escalatedToHumanCount: 45, // 45% (threshold: 35%)
      slaBreachCount: 8,
      averageFirstResponseSeconds: 150,
      highChurnRiskCount: 5,
    });

    expect(bottlenecks.length).toBe(3);

    const types = bottlenecks.map((b) => b.bottleneckType);
    expect(types).toContain('escalation_spike');
    expect(types).toContain('sla_breach');
    expect(types).toContain('churn_cluster');

    const churnIssue = bottlenecks.find((b) => b.bottleneckType === 'churn_cluster');
    expect(churnIssue?.severity).toBe('CRITICAL');
    expect(churnIssue?.impactEstimateUsd).toBe(5 * 1200);
  });
});
