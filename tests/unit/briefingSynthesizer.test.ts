import { describe, it, expect } from 'vitest';
import { BriefingSynthesizer } from '../../src/bi/synthesizer/briefingSynthesizer.js';
import { MetricsSnapshot, RoiMetrics } from '../../src/bi/types/biTypes.js';

describe('Briefing Synthesizer Unit Tests', () => {
  const mockSnapshot: MetricsSnapshot = {
    date: '2026-08-15',
    totalCustomers: 150,
    newLeadsToday: 12,
    qualifiedLeadsToday: 8,
    bookedAppointmentsToday: 4,
    activeSupportTickets: 10,
    supportResolutionRatePct: 95.0,
    avgResponseTimeSeconds: 35,
    agentTasksExecutedToday: 48,
    autonomousResolutionRatePct: 91.5,
    activeBottlenecksCount: 1,
    estimatedRevenueLeakUsd: 1200,
  };

  const mockRoi: RoiMetrics = {
    totalAgentTasksExecuted: 48,
    estimatedLaborHoursSaved: 12.0,
    estimatedLaborCostSavedUsd: 360.0,
    totalAgentModelCostUsd: 0.24,
    netSavingsUsd: 359.76,
    roiMultiple: 1500.0,
  };

  it('should synthesize rich markdown briefing and compact WhatsApp text without hallucination', () => {
    const result = BriefingSynthesizer.synthesize(mockSnapshot, mockRoi, 'Acme Global');

    expect(result.title).toContain('2026-08-15');
    expect(result.summaryMarkdown).toContain('Acme Global');
    expect(result.summaryMarkdown).toContain('12 hrs');
    expect(result.summaryMarkdown).toContain('$359.76');
    expect(result.summaryMarkdown).toContain('Active Operational Bottlenecks Detected');

    // WhatsApp formatting
    expect(result.whatsappFormattedText).toContain('☀️ *XYLARC AI — EXECUTIVE MORNING BRIEFING*');
    expect(result.whatsappFormattedText).toContain('• *New Inbound Leads:* 12');
    expect(result.whatsappFormattedText).toContain('• *Autonomous Resolution Rate:* 91.5%');
    expect(result.whatsappFormattedText).toContain('$359.76');

    // Highlights and Attention items
    expect(result.keyHighlights.length).toBeGreaterThanOrEqual(3);
    expect(result.attentionItems.length).toBeGreaterThanOrEqual(1);
    expect(result.attentionItems[0].priority).toBe('HIGH');
  });
});
