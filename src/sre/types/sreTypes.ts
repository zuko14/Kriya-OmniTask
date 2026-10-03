/**
 * Kriya AI — Site Reliability Engineering (SRE) Types & Contracts
 * Definitions for distributed waterfall tracing, SLO tracking, multi-window burn rates, and structured alerts.
 */

import { z } from 'zod';

export type SloTargetMetric =
  | 'availability'
  | 'p95_latency_ms'
  | 'p99_latency_ms'
  | 'error_rate'
  | 'workflow_success_rate';

export type AlertSeverity = 'P1_CRITICAL' | 'P2_HIGH' | 'P3_MEDIUM' | 'P4_LOW';
export type AlertStatus = 'firing' | 'acknowledged' | 'resolved';
export type AlertChannel = 'slack' | 'pagerduty' | 'webhook' | 'email';

export const SloDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  serviceName: z.string(),
  targetMetric: z.enum([
    'availability',
    'p95_latency_ms',
    'p99_latency_ms',
    'error_rate',
    'workflow_success_rate',
  ]),
  targetThreshold: z.number().positive(),
  windowDays: z.number().int().positive().default(30),
  isActive: z.boolean().default(true),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SloDefinition = z.infer<typeof SloDefinitionSchema>;

export const SloEvaluationSchema = z.object({
  id: z.string(),
  sloId: z.string(),
  evaluationTimestamp: z.string(),
  actualMetricValue: z.number(),
  isCompliant: z.boolean(),
  errorBudgetTotalPct: z.number(),
  errorBudgetRemainingPct: z.number(),
  burnRate1h: z.number(),
  burnRate6h: z.number().optional(),
  burnRate24h: z.number(),
  alertStatus: z.enum(['normal', 'warning', 'critical']),
});
export type SloEvaluation = z.infer<typeof SloEvaluationSchema>;

export const SreAlertSchema = z.object({
  id: z.string(),
  sloId: z.string().optional(),
  severity: z.enum(['P1_CRITICAL', 'P2_HIGH', 'P3_MEDIUM', 'P4_LOW']),
  title: z.string(),
  summary: z.string(),
  channels: z.array(z.enum(['slack', 'pagerduty', 'webhook', 'email'])),
  status: z.enum(['firing', 'acknowledged', 'resolved']),
  dispatchedAt: z.string(),
  acknowledgedAt: z.string().optional(),
  resolvedAt: z.string().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});
export type SreAlert = z.infer<typeof SreAlertSchema>;

export interface WaterfallSpanNode {
  spanId: string;
  parentSpanId?: string;
  name: string;
  service: string;
  startOffsetMs: number;
  durationMs: number;
  isCriticalPath: boolean;
  status: 'success' | 'error';
  attributes?: Record<string, any>;
  children: WaterfallSpanNode[];
}

export interface WaterfallTraceView {
  traceId: string;
  rootSpanName: string;
  totalDurationMs: number;
  spanCount: number;
  criticalPathDurationMs: number;
  tree: WaterfallSpanNode[];
}

export interface DispatchNotificationPayload {
  alertId: string;
  severity: AlertSeverity;
  title: string;
  summary: string;
  channel: AlertChannel;
  dispatchedAt: string;
  formattedMessage: string;
}
