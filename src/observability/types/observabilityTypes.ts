/**
 * Kriya AI — Agent Observability, Tracing & Drift Detection Type Definitions
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
  avgGroundingScore: number | null;
  driftRatePct: number;
}

export const ListTracesQuerySchema = z.object({
  agentId: z.string().optional(),
  status: TraceStatusEnum.optional(),
  driftOnly: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

// ============================================================================
// OpenTelemetry-shaped Attributes for Kriya Workflow Nodes & Agent Steps
// ============================================================================
export const SemanticAttributes = {
  WORKFLOW_RUN_ID: 'workflow.run.id',
  WORKFLOW_GRAPH_ID: 'workflow.graph.id',
  WORKFLOW_NODE_ID: 'workflow.node.id',
  WORKFLOW_NODE_KIND: 'workflow.node.kind',
  WORKFLOW_NODE_VISIT: 'workflow.node.visit',
  WORKFLOW_STEP: 'workflow.step',
  WORKFLOW_ACTION_TIER: 'workflow.action_tier',
  GEN_AI_MODEL: 'gen_ai.response.model',
  GEN_AI_TOKENS_INPUT: 'gen_ai.usage.input_tokens',
  GEN_AI_TOKENS_OUTPUT: 'gen_ai.usage.output_tokens',
  GEN_AI_COST_USD: 'gen_ai.usage.cost_usd',
  EXECUTION_OUTCOME: 'execution.outcome',
  PROOF_RECEIPT_ID: 'proof.receipt_id',
  PROOF_RECEIPT_HASH: 'proof.receipt_hash',
  VERIFICATION_STATE: 'verification.state',
  VERIFICATION_JOB_ID: 'verification.job_id',
  HUMAN_ATTENTION_ITEM_ID: 'human.attention_item_id',
} as const;

export interface DecisionTraceTimelineNode {
  nodeId: string;
  nodeKind: string;
  visit: number;
  step: number;
  latencyMs: number;
  tokensInput: number;
  tokensOutput: number;
  costUsd: number;
  status: 'completed' | 'error' | 'parked';
  actionSummary: string;
  stateDelta?: Record<string, unknown>;
  attributes: Record<string, unknown>;
  timestamp: string;
  modelId?: string;
  toolName?: string;
  proofReceiptId?: string;
  verificationState?: string;
}

export interface DecisionTraceTimeline {
  runId: string;
  graphId: string;
  tenantId: string;
  status: string;
  outcome?: string;
  startedAt: string;
  endedAt?: string;
  totalDurationMs: number;
  totalCostUsd: number;
  totalTokens: number;
  nodes: DecisionTraceTimelineNode[];
  spans: TraceWaterfallSpan[];
  proofReceipts: Array<{ id: string; hash?: string; stateHash?: string }>;
  verifications: Array<{ jobId: string; status: string; passed?: boolean }>;
}
