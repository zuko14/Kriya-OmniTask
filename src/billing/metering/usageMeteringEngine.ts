/**
 * Kriya AI — Usage Metering Engine
 * Aggregates high-throughput, event-driven usage events into deterministic billing summaries.
 */

import { UsageMeterRecord, UsageSummary } from '../types/billingTypes.js';

export class UsageMeteringEngine {
  /**
   * Aggregates usage meter records for a specified billing window.
   */
  public static aggregateUsage(
    tenantId: string,
    records: UsageMeterRecord[],
    periodStart: string,
    periodEnd: string
  ): UsageSummary {
    const summary: UsageSummary = {
      tenantId,
      periodStart,
      periodEnd,
      totalTokens: 0,
      totalVoiceMinutes: 0,
      totalWorkflowExecutions: 0,
      totalAgentSeatHours: 0,
      totalApiCalls: 0,
      totalVectorStorageMb: 0,
    };

    const startTime = new Date(periodStart).getTime();
    const endTime = new Date(periodEnd).getTime();

    for (const rec of records) {
      const recTime = new Date(rec.recordedAt).getTime();
      if (recTime < startTime || recTime > endTime) {
        continue; // Skip out-of-period records
      }

      switch (rec.metricType) {
        case 'tokens':
          summary.totalTokens += rec.quantity;
          break;
        case 'voice_minutes':
          summary.totalVoiceMinutes += rec.quantity;
          break;
        case 'workflow_executions':
          summary.totalWorkflowExecutions += rec.quantity;
          break;
        case 'agent_seat_hours':
          summary.totalAgentSeatHours += rec.quantity;
          break;
        case 'api_calls':
          summary.totalApiCalls += rec.quantity;
          break;
        case 'vector_storage_mb':
          summary.totalVectorStorageMb += rec.quantity;
          break;
      }
    }

    return summary;
  }
}
