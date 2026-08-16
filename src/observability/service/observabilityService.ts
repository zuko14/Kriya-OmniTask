/**
 * Xylarc AI — Agent Observability & Tracing Controller Service
 * High-level orchestration for distributed traces, waterfall construction, and drift evaluation (§14, §16 of CLAUDE.md).
 */

import {
  ExecutionTraceRecord,
  ExecutionSpanRecord,
  TraceWaterfallView,
  TraceStatus,
  SpanStepType,
  SpanStatus,
  ObservabilityMetricsOverview,
} from '../types/observabilityTypes.js';
import { TraceRepository } from '../repositories/traceRepository.js';
import { AgentTracer } from '../tracing/agentTracer.js';
import { DriftDetector } from '../drift/driftDetector.js';
import { NotFoundError } from '../../core/errors/errors.js';
import { logger } from '../../core/logger/logger.js';

export class ObservabilityService {
  private traceRepo: TraceRepository;

  constructor(traceRepo?: TraceRepository) {
    this.traceRepo = traceRepo || new TraceRepository();
  }

  /**
   * Starts a new distributed execution trace.
   */
  public async startTrace(params: {
    correlationId: string;
    rootAgentId: string;
    customerId?: string;
    channel?: string;
  }): Promise<ExecutionTraceRecord> {
    return this.traceRepo.createTrace(params);
  }

  /**
   * Records an execution span with automated token cost calculation.
   */
  public async recordSpan(params: {
    traceId: string;
    parentSpanId?: string;
    spanName: string;
    agentId: string;
    stepType: SpanStepType;
    modelId?: string;
    toolName?: string;
    status?: SpanStatus;
    latencyMs: number;
    tokensInput?: number;
    tokensOutput?: number;
    inputSummary?: string;
    outputSummary?: string;
    attributes?: Record<string, unknown>;
  }): Promise<ExecutionSpanRecord> {
    const costUsd = AgentTracer.calculateCostUsd(
      params.tokensInput || 0,
      params.tokensOutput || 0,
      params.modelId
    );

    return this.traceRepo.addSpan({
      ...params,
      costUsd,
    });
  }

  /**
   * Completes a trace, calculates aggregate tokens/latency/costs, evaluates drift, and records final outcome.
   */
  public async completeTrace(
    traceId: string,
    params: {
      status?: TraceStatus;
      modelFinalOutput?: string;
      retrievedEvidence?: string[];
    }
  ): Promise<ExecutionTraceRecord> {
    const trace = await this.traceRepo.findById(traceId);
    if (!trace) throw new NotFoundError(`Execution trace '${traceId}' not found.`);

    const spans = await this.traceRepo.listSpans(traceId);

    const totalLatencyMs = spans.reduce((sum, s) => sum + s.latency_ms, 0);
    const totalTokensInput = spans.reduce((sum, s) => sum + s.tokens_input, 0);
    const totalTokensOutput = spans.reduce((sum, s) => sum + s.tokens_output, 0);
    const totalCostUsd = spans.reduce((sum, s) => sum + s.cost_usd, 0);

    const groundingScore = DriftDetector.evaluateGrounding(
      params.modelFinalOutput || '',
      params.retrievedEvidence || []
    );

    const driftResult = DriftDetector.detectDrift({
      spans,
      totalTokens: totalTokensInput + totalTokensOutput,
      totalLatencyMs,
      groundingScore,
    });

    const status: TraceStatus = params.status || (driftResult.driftDetected ? 'escalated' : 'completed');

    const finalized = await this.traceRepo.finalizeTrace(traceId, {
      status,
      totalLatencyMs,
      totalTokensInput,
      totalTokensOutput,
      totalCostUsd: Math.round(totalCostUsd * 100000) / 100000,
      groundingScore,
      driftDetected: driftResult.driftDetected,
      driftReasons: driftResult.reasons,
    });

    if (driftResult.driftDetected) {
      logger.warn(`Agent drift detected on trace '${traceId}': ${driftResult.reasons.join(', ')}`);
    }

    return finalized;
  }

  /**
   * Builds and returns a hierarchical waterfall view for an execution trace.
   */
  public async getTraceWaterfall(traceId: string): Promise<TraceWaterfallView> {
    const trace = await this.traceRepo.findById(traceId);
    if (!trace) throw new NotFoundError(`Execution trace '${traceId}' not found.`);

    const spans = await this.traceRepo.listSpans(traceId);
    return AgentTracer.buildWaterfall(trace, spans);
  }

  /**
   * Lists traces matching query filters.
   */
  public async listTraces(filter?: {
    agentId?: string;
    status?: TraceStatus;
    driftOnly?: boolean;
    limit?: number;
  }): Promise<ExecutionTraceRecord[]> {
    return this.traceRepo.listTraces(filter);
  }

  /**
   * Retrieves aggregated observability and telemetry overview.
   */
  public async getMetricsOverview(): Promise<ObservabilityMetricsOverview> {
    return this.traceRepo.getMetricsOverview();
  }
}
