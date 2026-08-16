/**
 * Xylarc AI — Business Intelligence & Executive Daily Briefing Type Definitions
 * Typed contracts for multi-source aggregation, deterministic narrative synthesis & briefings (§13, §14 of CLAUDE.md).
 */

import { z } from 'zod';
import { BaseEntity } from '../../storage/repositories/baseRepository.js';

export const BriefingTypeEnum = z.enum([
  'daily_executive',
  'weekly_commercial',
  'support_health',
  'custom',
]);

export type BriefingType = z.infer<typeof BriefingTypeEnum>;

export interface MetricsSnapshot {
  date: string;
  totalCustomers: number;
  newLeadsToday: number;
  qualifiedLeadsToday: number;
  bookedAppointmentsToday: number;
  activeSupportTickets: number;
  supportResolutionRatePct: number;
  avgResponseTimeSeconds: number;
  agentTasksExecutedToday: number;
  autonomousResolutionRatePct: number;
  activeBottlenecksCount: number;
  estimatedRevenueLeakUsd: number;
}

export interface KeyHighlight {
  title: string;
  description: string;
  trend: 'UP' | 'DOWN' | 'STABLE';
  metricValue?: string;
}

export interface AttentionItem {
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  title: string;
  description: string;
  suggestedAction: string;
  relatedEntityId?: string;
}

export interface RoiMetrics {
  totalAgentTasksExecuted: number;
  estimatedLaborHoursSaved: number;
  estimatedLaborCostSavedUsd: number;
  totalAgentModelCostUsd: number;
  netSavingsUsd: number;
  roiMultiple: number;
}

export const GenerateBriefingRequestSchema = z.object({
  briefingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  briefingType: BriefingTypeEnum.default('daily_executive'),
  recipientPhoneNumber: z.string().optional(),
});

export type GenerateBriefingRequest = z.input<typeof GenerateBriefingRequestSchema>;

export interface ExecutiveBriefingRecord extends BaseEntity {
  organization_id: string;
  briefing_date: string;
  briefing_type: BriefingType;
  title: string;
  summary_markdown: string;
  metrics_snapshot_json: string;
  key_highlights_json: string;
  attention_items_json: string;
  roi_metrics_json: string;
  whatsapp_formatted_text: string;
  status: 'generated' | 'delivered' | 'reviewed';
  delivered_at?: string;
}

export const DeliverBriefingRequestSchema = z.object({
  recipientPhoneNumber: z.string().min(8).max(20),
});

export type DeliverBriefingRequest = z.input<typeof DeliverBriefingRequestSchema>;
