/**
 * Kriya AI — Agent Observability & Tracing Controller Service
 * High-level orchestration for distributed traces, waterfall construction, and drift evaluation (§14, §16 of CLAUDE.md).
 */

import {
  ExecutionTraceRecord,
  ExecutionSpanRecord,
  TraceWaterfallView,
  TraceWaterfallSpan,
  TraceStatus,
  SpanStepType,
  SpanStatus,
  ObservabilityMetricsOverview,
  DecisionTraceTimeline,
  DecisionTraceTimelineNode,
} from '../types/observabilityTypes.js';
import { TraceRepository } from '../repositories/traceRepository.js';
import { AgentTracer } from '../tracing/agentTracer.js';
import { DriftDetector } from '../drift/driftDetector.js';
import { NotFoundError } from '../../core/errors/errors.js';
import { PiiScrubber } from '../../retrieval/external/scrubber/piiScrubber.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import { logger } from '../../core/logger/logger.js';

export class ObservabilityService {
  private traceRepo: TraceRepository;

  constructor(traceRepo?: TraceRepository) {
    this.traceRepo = traceRepo || new TraceRepository();
  }

  public getRepo(): TraceRepository {
    return this.traceRepo;
  }

  /**
   * Starts a new distributed execution trace.
   */
  public async startTrace(params: {
    id?: string;
    correlationId: string;
    rootAgentId: string;
    customerId?: string;
    channel?: string;
    tenantId?: string;
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
    costUsd?: number;
    inputSummary?: string;
    outputSummary?: string;
    attributes?: Record<string, unknown>;
    tenantId?: string;
  }): Promise<ExecutionSpanRecord> {
    const costUsd =
      params.costUsd !== undefined
        ? params.costUsd
        : AgentTracer.calculateCostUsd(
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

  /**
   * Constructs an ordered, PII-sanitized Decision Trace timeline for a workflow run or trace ID (WP-2.6).
   */
  public async getDecisionTrace(runIdOrTraceId: string, tenantId?: string): Promise<DecisionTraceTimeline> {
    const client = this.traceRepo.getClient();
    const effectiveTenantId = tenantId || TenantContextManager.get()?.tenantId;

    // Check if there is a graph_runs record with this ID
    const runRow = effectiveTenantId
      ? await client.queryOne<{
          id: string;
          tenant_id: string;
          graph_id: string;
          status: string;
          outcome?: string;
          step_count: number;
          graph_json: string;
          state_json: string;
          visits_json: string;
          created_at: string;
          updated_at: string;
        }>('SELECT * FROM graph_runs WHERE id = ? AND tenant_id = ?;', [runIdOrTraceId, effectiveTenantId])
      : await client.queryOne<{
          id: string;
          tenant_id: string;
          graph_id: string;
          status: string;
          outcome?: string;
          step_count: number;
          graph_json: string;
          state_json: string;
          visits_json: string;
          created_at: string;
          updated_at: string;
        }>('SELECT * FROM graph_runs WHERE id = ?;', [runIdOrTraceId]);

    if (runRow) {
      const targetTenant = effectiveTenantId || runRow.tenant_id;
      const checkpoints = await client.query<{
        id: string;
        step: number;
        node_id: string;
        node_kind: string;
        next_node_id: string | null;
        state_hash: string;
        state_json: string;
        duration_ms: number;
        created_at: string;
      }>('SELECT * FROM graph_checkpoints WHERE run_id = ? AND tenant_id = ? ORDER BY step ASC;', [runRow.id, targetTenant]);

      const trace = await this.traceRepo.findTraceByCorrelationOrId(runRow.id, targetTenant);
      const spans = trace ? await this.traceRepo.listSpans(trace.id, targetTenant) : [];

      const proofReceipts: Array<{ id: string; hash?: string; stateHash?: string }> = [];
      const verifications: Array<{ jobId: string; status: string; passed?: boolean }> = [];

      const nodes: DecisionTraceTimelineNode[] = [];
      let priorState: Record<string, unknown> = {};

      for (const cp of checkpoints) {
        let cpState: Record<string, unknown> = {};
        try {
          cpState = JSON.parse(cp.state_json);
        } catch {}

        // Compute state delta between steps
        const delta: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(cpState)) {
          if (JSON.stringify(priorState[k]) !== JSON.stringify(v)) {
            delta[k] = v;
          }
        }
        priorState = cpState;

        // Check for proof receipts in state
        if (cpState.receipt && typeof cpState.receipt === 'object') {
          const r = cpState.receipt as any;
          if (r.id && !proofReceipts.some((existing) => existing.id === r.id)) {
            proofReceipts.push({ id: r.id, hash: r.hash, stateHash: r.stateHash });
          }
        }

        // Check for verification states in state
        if (cpState.verification && typeof cpState.verification === 'object') {
          const v = cpState.verification as any;
          if (v.jobId && !verifications.some((existing) => existing.jobId === v.jobId)) {
            verifications.push({
              jobId: v.jobId,
              status: v.state || v.status || 'unknown',
              passed: v.state === 'verified' || v.passed === true,
            });
          }
        }

        // Match span by step or node_id
        const matchedSpan = spans.find((s) => {
          let attrs: any = {};
          try {
            attrs = JSON.parse(s.attributes_json);
          } catch {}
          return attrs['workflow.step'] === cp.step || s.span_name.endsWith(`:${cp.node_id}`);
        });

        let spanAttrs: Record<string, unknown> = {};
        if (matchedSpan) {
          try {
            spanAttrs = JSON.parse(matchedSpan.attributes_json);
          } catch {}
        }

        const isParked = runRow.status === 'parked' && cp.step === runRow.step_count;
        const isError = runRow.status === 'failed' && cp.step === runRow.step_count;
        const status = isParked ? 'parked' : isError ? 'error' : 'completed';

        nodes.push({
          nodeId: cp.node_id,
          nodeKind: cp.node_kind,
          visit: (spanAttrs['workflow.node.visit'] as number) || 1,
          step: cp.step,
          latencyMs: cp.duration_ms,
          tokensInput: matchedSpan?.tokens_input || 0,
          tokensOutput: matchedSpan?.tokens_output || 0,
          costUsd: matchedSpan?.cost_usd || 0,
          status,
          actionSummary: PiiScrubber.redact(`Step ${cp.step}: executed '${cp.node_id}' (${cp.node_kind})`),
          stateDelta: PiiScrubber.redactObject(delta),
          attributes: PiiScrubber.redactObject(spanAttrs),
          timestamp: cp.created_at,
          modelId: matchedSpan?.model_id,
          toolName: matchedSpan?.tool_name,
          proofReceiptId: (spanAttrs['proof.receipt_id'] as string) || (cpState.receipt as any)?.id,
          verificationState: (spanAttrs['verification.state'] as string) || (cpState.verification as any)?.state,
        });
      }

      const totalTokens = spans.reduce((sum, s) => sum + s.tokens_input + s.tokens_output, 0);
      const totalCostUsd = spans.reduce((sum, s) => sum + s.cost_usd, 0);
      const totalDurationMs = checkpoints.reduce((sum, cp) => sum + cp.duration_ms, 0);

      const waterfall = trace ? AgentTracer.buildWaterfall(trace, spans) : { rootSpans: [] as TraceWaterfallSpan[] };

      return {
        runId: runRow.id,
        graphId: runRow.graph_id,
        tenantId: runRow.tenant_id,
        status: runRow.status,
        outcome: runRow.outcome,
        startedAt: runRow.created_at,
        endedAt: runRow.updated_at,
        totalDurationMs,
        totalCostUsd: Math.round(totalCostUsd * 100000) / 100000,
        totalTokens,
        nodes,
        spans: waterfall.rootSpans,
        proofReceipts,
        verifications,
      };
    }

    // Fallback: look up direct execution trace
    const trace = await this.traceRepo.findTraceByCorrelationOrId(runIdOrTraceId, effectiveTenantId);
    if (!trace) {
      throw new NotFoundError(`Decision trace for run or trace ID '${runIdOrTraceId}' not found.`);
    }

    const spans = await this.traceRepo.listSpans(trace.id, effectiveTenantId);
    const waterfall = AgentTracer.buildWaterfall(trace, spans);

    const nodes: DecisionTraceTimelineNode[] = spans.map((s, idx) => {
      let attrs: any = {};
      try {
        attrs = JSON.parse(s.attributes_json);
      } catch {}
      return {
        nodeId: (attrs['workflow.node.id'] as string) || s.span_name,
        nodeKind: (attrs['workflow.node.kind'] as string) || s.step_type,
        visit: (attrs['workflow.node.visit'] as number) || 1,
        step: (attrs['workflow.step'] as number) || idx + 1,
        latencyMs: s.latency_ms,
        tokensInput: s.tokens_input,
        tokensOutput: s.tokens_output,
        costUsd: s.cost_usd,
        status: s.status === 'completed' ? 'completed' : 'error',
        actionSummary: s.output_summary || s.input_summary || s.span_name,
        attributes: PiiScrubber.redactObject(attrs),
        timestamp: s.started_at,
        modelId: s.model_id,
        toolName: s.tool_name,
      };
    });

    return {
      runId: trace.correlation_id,
      graphId: trace.root_agent_id,
      tenantId: trace.tenant_id,
      status: trace.status,
      startedAt: trace.started_at,
      endedAt: trace.completed_at,
      totalDurationMs: trace.total_latency_ms,
      totalCostUsd: trace.total_cost_usd,
      totalTokens: trace.total_tokens_input + trace.total_tokens_output,
      nodes,
      spans: waterfall.rootSpans,
      proofReceipts: [],
      verifications: [],
    };
  }

  /**
   * Searches and filters spans across traces for a tenant.
   */
  public async searchSpans(filter: {
    tenantId?: string;
    traceId?: string;
    parentSpanId?: string;
    agentId?: string;
    stepType?: SpanStepType;
    status?: SpanStatus;
    limit?: number;
  }): Promise<ExecutionSpanRecord[]> {
    return this.traceRepo.searchSpans(filter);
  }
}
