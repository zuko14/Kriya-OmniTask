/**
 * Xylarc AI — Deterministic Executive Briefing Synthesizer
 * Evidence-first narrative generator for Executive Summaries & WhatsApp Morning Briefings (§13, §14 of CLAUDE.md).
 */

import {
  MetricsSnapshot,
  RoiMetrics,
  KeyHighlight,
  AttentionItem,
} from '../types/biTypes.js';

export interface SynthesizedBriefing {
  title: string;
  summaryMarkdown: string;
  whatsappFormattedText: string;
  keyHighlights: KeyHighlight[];
  attentionItems: AttentionItem[];
}

export class BriefingSynthesizer {
  /**
   * Synthesizes deterministic, evidence-based daily briefing artifacts from aggregated snapshot and ROI metrics.
   */
  public static synthesize(
    snapshot: MetricsSnapshot,
    roi: RoiMetrics,
    tenantName: string = 'Enterprise'
  ): SynthesizedBriefing {
    const title = `Xylarc AI Executive Daily Briefing — ${snapshot.date}`;

    // 1. Key Highlights
    const keyHighlights: KeyHighlight[] = [
      {
        title: 'Workforce Autonomy Rate',
        description: `${snapshot.autonomousResolutionRatePct}% of all customer interactions were resolved autonomously without human intervention.`,
        trend: snapshot.autonomousResolutionRatePct >= 85 ? 'UP' : 'STABLE',
        metricValue: `${snapshot.autonomousResolutionRatePct}%`,
      },
      {
        title: 'Customer Acquisition Pipeline',
        description: `${snapshot.newLeadsToday} new inbound leads captured, with ${snapshot.qualifiedLeadsToday} qualified leads and ${snapshot.bookedAppointmentsToday} demo appointments confirmed.`,
        trend: snapshot.newLeadsToday > 0 ? 'UP' : 'STABLE',
        metricValue: `${snapshot.newLeadsToday} leads`,
      },
      {
        title: 'Operational Cost Efficiency',
        description: `Autonomous agents saved approximately ${roi.estimatedLaborHoursSaved} hours of human labor, generating $${roi.netSavingsUsd} in net operational savings (${roi.roiMultiple}x ROI).`,
        trend: 'UP',
        metricValue: `$${roi.netSavingsUsd} saved`,
      },
    ];

    // 2. Attention Items
    const attentionItems: AttentionItem[] = [];

    if (snapshot.activeBottlenecksCount > 0) {
      attentionItems.push({
        priority: snapshot.estimatedRevenueLeakUsd > 1000 ? 'HIGH' : 'MEDIUM',
        title: 'Active Operational Bottlenecks Detected',
        description: `${snapshot.activeBottlenecksCount} bottlenecks active with estimated revenue leak of $${snapshot.estimatedRevenueLeakUsd}.`,
        suggestedAction:
          'Review the Operational Diagnostics tab to trigger automated specialist follow-up campaigns.',
      });
    }

    if (snapshot.qualifiedLeadsToday > 0 && snapshot.bookedAppointmentsToday === 0) {
      attentionItems.push({
        priority: 'MEDIUM',
        title: 'Qualified Leads Awaiting Booking',
        description: `${snapshot.qualifiedLeadsToday} qualified leads have not yet scheduled a consultation.`,
        suggestedAction:
          'Deploy Calendar Booking Specialist interactive slot proposals.',
      });
    }

    // 3. Markdown Executive Summary
    const summaryMarkdown = `# ${title}
**Organization:** ${tenantName} | **Date:** ${snapshot.date} | **System Status:** 🟢 Optimal Autonomous Operation

---

## 📊 Executive KPI Snapshot
| Metric | Value | Target / Status |
| :--- | :--- | :--- |
| **Total Managed Customers** | ${snapshot.totalCustomers} | Active Base |
| **New Inbound Leads (Today)** | ${snapshot.newLeadsToday} | Pipeline Growth |
| **Qualified Pipeline Leads** | ${snapshot.qualifiedLeadsToday} | Ready for Booking |
| **Booked Consultations** | ${snapshot.bookedAppointmentsToday} | Confirmed Slots |
| **Agent Tasks Executed** | ${snapshot.agentTasksExecutedToday} | Full Workforce |
| **Autonomous Resolution Rate** | ${snapshot.autonomousResolutionRatePct}% | Target: > 85% |
| **Avg Response Latency** | ${snapshot.avgResponseTimeSeconds}s | Target: < 60s |
| **Active Bottlenecks** | ${snapshot.activeBottlenecksCount} ($${snapshot.estimatedRevenueLeakUsd} leak) | Attention Required |

---

## 💰 Workforce ROI & Cost Savings
- **Labor Hours Saved:** **${roi.estimatedLaborHoursSaved} hrs**
- **Estimated Human Labor Cost Saved:** **$${roi.estimatedLaborCostSavedUsd}**
- **Autonomous Model Compute Cost:** **$${roi.totalAgentModelCostUsd}**
- **Net Daily Savings:** **$${roi.netSavingsUsd}** (${roi.roiMultiple}x ROI multiple)

---

## 🌟 Key Highlights
${keyHighlights.map((h) => `- **${h.title}** (${h.trend}): ${h.description}`).join('\n')}

---

## ⚠️ Executive Attention Items
${
  attentionItems.length > 0
    ? attentionItems
        .map(
          (a) =>
            `- **[${a.priority}] ${a.title}:** ${a.description}\n  *Recommended Action:* ${a.suggestedAction}`
        )
        .join('\n')
    : '✅ No critical operational bottlenecks requiring immediate executive intervention.'
}
`;

    // 4. WhatsApp Formatted Text
    const whatsappFormattedText = `☀️ *XYLARC AI — EXECUTIVE MORNING BRIEFING*
📅 *Date:* ${snapshot.date}
🏢 *Organization:* ${tenantName}

📊 *KEY METRICS SUMMARY:*
• *New Inbound Leads:* ${snapshot.newLeadsToday}
• *Qualified Pipeline:* ${snapshot.qualifiedLeadsToday}
• *Booked Consultations:* ${snapshot.bookedAppointmentsToday}
• *Autonomous Resolution Rate:* ${snapshot.autonomousResolutionRatePct}%
• *Avg Response Time:* ${snapshot.avgResponseTimeSeconds}s

💰 *DAILY ROI & COST SAVINGS:*
• *Labor Hours Saved:* ${roi.estimatedLaborHoursSaved} hrs
• *Net Operational Savings:* $${roi.netSavingsUsd} (${roi.roiMultiple}x ROI)

⚠️ *ACTION ITEMS:*
${
  attentionItems.length > 0
    ? attentionItems
        .map((a) => `• [${a.priority}] *${a.title}*: ${a.suggestedAction}`)
        .join('\n')
    : '• ✅ All autonomous systems operating normally.'
}

_Reply "STATUS" for live workforce telemetry or "REPORT" for full PDF digest._`;

    return {
      title,
      summaryMarkdown,
      whatsappFormattedText,
      keyHighlights,
      attentionItems,
    };
  }
}
