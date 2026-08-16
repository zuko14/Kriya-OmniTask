/**
 * Xylarc AI — Agent Observability, Tracing & Drift Detection Type Definitions
 * Typed contracts for OpenTelemetry-style distributed spans, drift detection, and telemetry (§14, §16 of CLAUDE.md).
 */

import { z } from 'zod';
import { BaseEntity } from '../../storage/repositories/baseRepository.js';

export const TraceStatusEnum = z.enum(['running', 'completed', 'failed', 'escalated']);
export type TraceStatus = z.infer<typeof TraceStatusEnum>;

export const SpanStepTypeEnum = z.enum([
  'model_inference',
  'tool_execution',
  'retrieval',
  'policy_check',
  'verification',
  'orchestration',
]);
export type SpanStepType = z.infer<typeof SpanStepTypeEnum>;

export const SpanStatusEnum = z.enum(['completed', 'error']);
export type SpanStatus = z.infer<typeof SpanStatusEnum>;

export interface ExecutionTraceRecord extends BaseEntity {
  organization_id: string;
  correlation_id: string;
  root_agent_id: string;
  customer_id?: string;
  channel: string;
  status: TraceStatus;
  total_latency_ms: number;
  total_tokens_input: number;
  total_tokens_output: number;
  total_cost_usd: number;
  grounding_score: number;
  drift_detected: boolean | number;
  drift_reasons_json: string;
  started_at: string;
  completed_at?: string;
}

export interface ExecutionSpanRecord extends BaseEntity {
  trace_id: string;
  parent_span_id?: string;
  span_name: string;
  agent_id: string;
  step_type: SpanStepType;
  model_id?: string;
  tool_name?: string;
  status: SpanStatus;
  latency_ms: number;
  tokens_input: number;
  tokens_output: number;
  cost_usd: number;
  input_summary?: string;
  output_summary?: string;
  attributes_json: string;
  started_at: string;
  ended_at: string;
}

export interface TraceWaterfallSpan {
  id: string;
  parentSpanId?: string;
  spanName: string;
  agentId: string;
  stepType: SpanStepType;
  modelId?: string;
  toolName?: string;
  status: SpanStatus;
  latencyMs: number;
  tokensInput: number;
  tokensOutput: number;
  costUsd: number;
  inputSummary?: string;
  outputSummary?: string;
  attributes: Record<string, unknown>;
  startedAt: string;
  endedAt: string;
  children: TraceWaterfallSpan[];
}

export interface TraceWaterfallView {
  trace: ExecutionTraceRecord;
  rootSpans: TraceWaterfallSpan[];
  totalSpans: number;
  driftReasons: string[];
}

export interface DriftDetectionResult {
  driftDetected: boolean;
  groundingScore: number;
  reasons: string[];
  toolLoopCount?: number;
}

export interface ObservabilityMetricsOverview {
  totalTraces: number;
  completedTraces: number;
  failedTraces: number;
  escalatedTraces: number;
  avgLatencyMs: number;
  totalTokens: number;
  totalCostUsd: number;
  avgGroundingScore: number;
  driftRatePct: number;
}

export const ListTracesQuerySchema = z.object({
  agentId: z.string().optional(),
  status: TraceStatusEnum.optional(),
  driftOnly: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
