/**
 * Xylarc AI — Operational Bottleneck & Revenue Leak Diagnostic Detector
 * Scans workforce execution traces, customer funnel data, and SLAs to detect operational bottlenecks (§13, §14 of CLAUDE.md).
 */

import {
  BottleneckType,
  BottleneckSeverity,
} from '../types/digitalTwinTypes.js';

export interface DetectedBottleneckCandidate {
  bottleneckType: BottleneckType;
  entityId?: string;
  title: string;
  description: string;
  severity: BottleneckSeverity;
  impactEstimateUsd: number;
  recommendation: string;
}

export interface FunnelMetricsInput {
  totalLeads: number;
  qualifiedLeads: number;
  bookedAppointments: number;
  closedWonCustomers: number;
  averageContractValueUsd?: number;
}

export interface SupportMetricsInput {
  totalTickets: number;
  escalatedToHumanCount: number;
  slaBreachCount: number;
  averageFirstResponseSeconds: number;
  highChurnRiskCount: number;
}

export class BottleneckDetector {
  /**
   * Evaluates sales and commercial funnel data to detect revenue drop-offs and leaks.
   */
  public static diagnoseFunnel(metrics: FunnelMetricsInput): DetectedBottleneckCandidate[] {
    const bottlenecks: DetectedBottleneckCandidate[] = [];
    const acv = metrics.averageContractValueUsd || 1200;

    // 1. Check Lead-to-Booking Drop-off (Qualified leads that never booked)
    if (metrics.qualifiedLeads > 0) {
      const bookingRatio = metrics.bookedAppointments / metrics.qualifiedLeads;
      if (bookingRatio < 0.4) {
        const lostBookings = Math.round(metrics.qualifiedLeads * 0.4 - metrics.bookedAppointments);
        const estimatedLeakUsd = lostBookings * acv * 0.25; // 25% close rate assumption

        bottlenecks.push({
          bottleneckType: 'revenue_leak',
          title: 'High Drop-off Between Qualified Lead and Calendar Booking',
          description: `Only ${Math.round(bookingRatio * 100)}% of qualified leads scheduled a consultation (target: >= 40%).`,
          severity: bookingRatio < 0.2 ? 'HIGH' : 'MEDIUM',
          impactEstimateUsd: Math.round(estimatedLeakUsd),
          recommendation:
            'Deploy the Calendar Booking Specialist automated follow-up sequence with interactive WhatsApp slot buttons.',
        });
      }
    }

    return bottlenecks;
  }

  /**
   * Evaluates customer support operations for SLA breaches and capacity overload.
   */
  public static diagnoseSupportOperations(metrics: SupportMetricsInput): DetectedBottleneckCandidate[] {
    const bottlenecks: DetectedBottleneckCandidate[] = [];

    // 1. Human Escalation Spike
    if (metrics.totalTickets > 0) {
      const escalationRatio = metrics.escalatedToHumanCount / metrics.totalTickets;
      if (escalationRatio > 0.35) {
        bottlenecks.push({
          bottleneckType: 'escalation_spike',
          title: 'Elevated Human Support Escalation Rate',
          description: `${Math.round(escalationRatio * 100)}% of tickets are being escalated to human operators (target: < 20%).`,
          severity: escalationRatio > 0.5 ? 'CRITICAL' : 'HIGH',
          impactEstimateUsd: metrics.escalatedToHumanCount * 35, // ~$35 estimated support handling cost per escalation
          recommendation:
            'Update Customer Support Specialist knowledge base with updated troubleshooting SOPs to improve Tier-1 autonomous resolution.',
        });
      }
    }

    // 2. SLA Response Breaches
    if (metrics.slaBreachCount > 0) {
      bottlenecks.push({
        bottleneckType: 'sla_breach',
        title: 'Customer Communication SLA Response Breaches Detected',
        description: `${metrics.slaBreachCount} customer inquiries breached target response SLA.`,
        severity: metrics.slaBreachCount > 5 ? 'HIGH' : 'MEDIUM',
        impactEstimateUsd: metrics.slaBreachCount * 100,
        recommendation:
          'Increase concurrent agent dispatch limits and verify WhatsApp Cloud API connector webhook delivery latency.',
      });
    }

    // 3. Churn Risk Cluster
    if (metrics.highChurnRiskCount > 0) {
      bottlenecks.push({
        bottleneckType: 'churn_cluster',
        title: 'At-Risk Customer Churn Concentration',
        description: `${metrics.highChurnRiskCount} active customer accounts exhibit severe churn risk indicators (> 70%).`,
        severity: metrics.highChurnRiskCount > 3 ? 'CRITICAL' : 'HIGH',
        impactEstimateUsd: metrics.highChurnRiskCount * 1200,
        recommendation:
          'Trigger Reactivation & Retention Specialist win-back campaigns and alert Customer Success account managers.',
      });
    }

    return bottlenecks;
  }
}
