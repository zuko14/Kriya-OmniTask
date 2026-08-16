/**
 * Xylarc AI — OpenTelemetry-Style Distributed Execution Tracer
 * Builds hierarchical waterfall spans, computes token cost attribution, and formats trace views (§14, §16 of CLAUDE.md).
 */

import {
  ExecutionTraceRecord,
  ExecutionSpanRecord,
  TraceWaterfallSpan,
  TraceWaterfallView,
} from '../types/observabilityTypes.js';

export class AgentTracer {
  /**
   * Calculates token cost attribution in USD based on input and output token counts.
   */
  public static calculateCostUsd(tokensInput: number, tokensOutput: number, modelId?: string): number {
    // Pricing model baseline (e.g. standard tier: $0.15/1M input, $0.60/1M output)
    let inputCostPerToken = 0.00000015;
    let outputCostPerToken = 0.00000060;

    if (modelId?.includes('pro') || modelId?.includes('gpt-4')) {
      inputCostPerToken = 0.0000025;
      outputCostPerToken = 0.0000100;
    }

    const cost = tokensInput * inputCostPerToken + tokensOutput * outputCostPerToken;
    return Math.round(cost * 100000) / 100000;
  }

  /**
   * Constructs a hierarchical waterfall view from a flat array of database span records.
   */
  public static buildWaterfall(
    trace: ExecutionTraceRecord,
    spans: ExecutionSpanRecord[]
  ): TraceWaterfallView {
    const spanMap = new Map<string, TraceWaterfallSpan>();
    const rootSpans: TraceWaterfallSpan[] = [];

    // 1. Convert all flat records to waterfall nodes
    for (const s of spans) {
      let attributes = {};
      try {
        attributes = JSON.parse(s.attributes_json || '{}');
      } catch {}

      const node: TraceWaterfallSpan = {
        id: s.id,
        parentSpanId: s.parent_span_id,
        spanName: s.span_name,
        agentId: s.agent_id,
        stepType: s.step_type,
        modelId: s.model_id,
        toolName: s.tool_name,
        status: s.status,
        latencyMs: s.latency_ms,
        tokensInput: s.tokens_input,
        tokensOutput: s.tokens_output,
        costUsd: s.cost_usd,
        inputSummary: s.input_summary,
        outputSummary: s.output_summary,
        attributes,
        startedAt: s.started_at,
        endedAt: s.ended_at,
        children: [],
      };

      spanMap.set(node.id, node);
    }

    // 2. Nest children under parent spans
    for (const span of spanMap.values()) {
      if (span.parentSpanId && spanMap.has(span.parentSpanId)) {
        spanMap.get(span.parentSpanId)!.children.push(span);
      } else {
        rootSpans.push(span);
      }
    }

    let driftReasons: string[] = [];
    try {
      driftReasons = JSON.parse(trace.drift_reasons_json || '[]');
    } catch {}

    return {
      trace,
      rootSpans,
      totalSpans: spans.length,
      driftReasons,
    };
  }
}
