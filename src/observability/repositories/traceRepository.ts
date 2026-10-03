/**
 * Kriya AI — Traces & Spans Relational Repository
 * Persistence for distributed agent interaction traces and execution telemetry (§14, §16 of CLAUDE.md).
 */

import { BaseRepository } from '../../storage/repositories/baseRepository.js';
import { DatabaseClient } from '../../storage/db.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import {
  ExecutionTraceRecord,
  ExecutionSpanRecord,
  TraceStatus,
  SpanStepType,
  SpanStatus,
  ObservabilityMetricsOverview,
} from '../types/observabilityTypes.js';
import { CryptoUtils } from '../../core/utils/crypto.js';
import { PiiScrubber } from '../../retrieval/external/scrubber/piiScrubber.js';

export class TraceRepository extends BaseRepository<ExecutionTraceRecord> {
  protected readonly tableName = 'execution_traces';

  constructor(client?: DatabaseClient) {
    super(client);
  }

  public getClient(): DatabaseClient {
    return this.client;
  }

  protected override getTenantId(): string {
    const ctx = TenantContextManager.get();
    return ctx?.tenantId || 'default';
  }

  public override async findById(id: string, tenantId?: string): Promise<ExecutionTraceRecord | null> {
    const targetTenant = tenantId || this.getTenantId();
    const sql = `SELECT * FROM ${this.tableName} WHERE id = ? AND tenant_id = ?;`;
    return this.client.queryOne<ExecutionTraceRecord>(sql, [id, targetTenant]);
  }

  /**
   * Starts a new distributed execution trace.
   */
  public async createTrace(params: {
    id?: string;
    correlationId: string;
    rootAgentId: string;
    customerId?: string;
    channel?: string;
    tenantId?: string;
  }): Promise<ExecutionTraceRecord> {
    const tenantId = params.tenantId || this.getTenantId();
    const id = params.id || CryptoUtils.generateId();
    const existing = await this.findById(id, tenantId);
    if (existing) return existing;

    const now = new Date().toISOString();

    const record: ExecutionTraceRecord = {
      id,
      tenant_id: tenantId,
      organization_id: 'default',
      correlation_id: params.correlationId,
      root_agent_id: params.rootAgentId,
      customer_id: params.customerId,
      channel: params.channel || 'api',
      status: 'running',
      total_latency_ms: 0,
      total_tokens_input: 0,
      total_tokens_output: 0,
      total_cost_usd: 0.0,
      grounding_score: 1.0,
      drift_detected: false,
      drift_reasons_json: '[]',
      started_at: now,
      created_at: now,
      updated_at: now,
    };

    await this.client.execute(
      `INSERT INTO execution_traces (
        id, tenant_id, organization_id, correlation_id, root_agent_id,
        customer_id, channel, status, total_latency_ms, total_tokens_input,
        total_tokens_output, total_cost_usd, grounding_score, drift_detected,
        drift_reasons_json, started_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        record.id,
        record.tenant_id,
        record.organization_id,
        record.correlation_id,
        record.root_agent_id,
        record.customer_id || null,
        record.channel,
        record.status,
        record.total_latency_ms,
        record.total_tokens_input,
        record.total_tokens_output,
        record.total_cost_usd,
        record.grounding_score,
        record.drift_detected ? 1 : 0,
        record.drift_reasons_json,
        record.started_at,
      ]
    );

    return record;
  }

  /**
   * Adds an execution span to a trace.
   */
  public async addSpan(params: {
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
    const tenantId = params.tenantId || this.getTenantId();
    const id = CryptoUtils.generateId();
    const now = new Date().toISOString();

    const sanitizedInput = params.inputSummary ? PiiScrubber.redact(params.inputSummary) : undefined;
    const sanitizedOutput = params.outputSummary ? PiiScrubber.redact(params.outputSummary) : undefined;
    const sanitizedAttributes = PiiScrubber.redactObject(params.attributes || {});

    const record: ExecutionSpanRecord = {
      id,
      trace_id: params.traceId,
      tenant_id: tenantId,
      parent_span_id: params.parentSpanId,
      span_name: params.spanName,
      agent_id: params.agentId,
      step_type: params.stepType,
      model_id: params.modelId,
      tool_name: params.toolName,
      status: params.status || 'completed',
      latency_ms: params.latencyMs,
      tokens_input: params.tokensInput || 0,
      tokens_output: params.tokensOutput || 0,
      cost_usd: params.costUsd || 0.0,
      input_summary: sanitizedInput,
      output_summary: sanitizedOutput,
      attributes_json: JSON.stringify(sanitizedAttributes),
      started_at: now,
      ended_at: now,
      created_at: now,
      updated_at: now,
    };

    await this.client.execute(
      `INSERT INTO execution_spans (
        id, trace_id, tenant_id, parent_span_id, span_name, agent_id,
        step_type, model_id, tool_name, status, latency_ms, tokens_input,
        tokens_output, cost_usd, input_summary, output_summary, attributes_json,
        started_at, ended_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        record.id,
        record.trace_id,
        record.tenant_id,
        record.parent_span_id || null,
        record.span_name,
        record.agent_id,
        record.step_type,
        record.model_id || null,
        record.tool_name || null,
        record.status,
        record.latency_ms,
        record.tokens_input,
        record.tokens_output,
        record.cost_usd,
        record.input_summary || null,
        record.output_summary || null,
        record.attributes_json,
        record.started_at,
        record.ended_at,
      ]
    );

    return record;
  }

  /**
   * Alias for addSpan to support standard OpenTelemetry span recording interface.
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
    return this.addSpan(params);
  }

  /**
   * Finalizes and updates trace summary rollup.
   */
  public async finalizeTrace(
    traceId: string,
    params: {
      status: TraceStatus;
      totalLatencyMs: number;
      totalTokensInput: number;
      totalTokensOutput: number;
      totalCostUsd: number;
      groundingScore: number;
      driftDetected: boolean;
      driftReasons: string[];
    }
  ): Promise<ExecutionTraceRecord> {
    const tenantId = this.getTenantId();
    const now = new Date().toISOString();

    await this.client.execute(
      `UPDATE execution_traces SET
        status = ?,
        total_latency_ms = ?,
        total_tokens_input = ?,
        total_tokens_output = ?,
        total_cost_usd = ?,
        grounding_score = ?,
        drift_detected = ?,
        drift_reasons_json = ?,
        completed_at = ?
       WHERE id = ? AND tenant_id = ?;`,
      [
        params.status,
        params.totalLatencyMs,
        params.totalTokensInput,
        params.totalTokensOutput,
        params.totalCostUsd,
        params.groundingScore,
        params.driftDetected ? 1 : 0,
        JSON.stringify(params.driftReasons),
        now,
        traceId,
        tenantId,
      ]
    );

    return (await this.findById(traceId))!;
  }

  /**
   * Retrieves all spans belonging to a trace.
   */
  public async listSpans(traceId: string, tenantId?: string): Promise<ExecutionSpanRecord[]> {
    const targetTenant = tenantId || this.getTenantId();
    return this.client.query<ExecutionSpanRecord>(
      'SELECT * FROM execution_spans WHERE tenant_id = ? AND trace_id = ? ORDER BY started_at ASC;',
      [targetTenant, traceId]
    );
  }

  /**
   * Finds a trace by either primary ID or correlationId (e.g. workflow runId).
   */
  public async findTraceByCorrelationOrId(idOrCorrelationId: string, tenantId?: string): Promise<ExecutionTraceRecord | null> {
    const targetTenant = tenantId || this.getTenantId();
    const rows = await this.client.query<ExecutionTraceRecord>(
      'SELECT * FROM execution_traces WHERE (id = ? OR correlation_id = ?) AND tenant_id = ? ORDER BY started_at DESC LIMIT 1;',
      [idOrCorrelationId, idOrCorrelationId, targetTenant]
    );
    return rows.length ? rows[0] : null;
  }

  /**
   * Retrieves all spans for a trace resolved by either trace ID or correlationId.
   */
  public async listSpansByTraceOrCorrelation(idOrCorrelationId: string, tenantId?: string): Promise<ExecutionSpanRecord[]> {
    const targetTenant = tenantId || this.getTenantId();
    const trace = await this.findTraceByCorrelationOrId(idOrCorrelationId, targetTenant);
    const traceId = trace ? trace.id : idOrCorrelationId;
    return this.listSpans(traceId, targetTenant);
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
    const tenantId = filter.tenantId || this.getTenantId();
    let sql = 'SELECT * FROM execution_spans WHERE tenant_id = ?';
    const params: unknown[] = [tenantId];

    if (filter.traceId) {
      sql += ' AND trace_id = ?';
      params.push(filter.traceId);
    }
    if (filter.parentSpanId) {
      sql += ' AND parent_span_id = ?';
      params.push(filter.parentSpanId);
    }
    if (filter.agentId) {
      sql += ' AND agent_id = ?';
      params.push(filter.agentId);
    }
    if (filter.stepType) {
      sql += ' AND step_type = ?';
      params.push(filter.stepType);
    }
    if (filter.status) {
      sql += ' AND status = ?';
      params.push(filter.status);
    }

    sql += ' ORDER BY started_at DESC LIMIT ?;';
    params.push(filter.limit || 50);

    return this.client.query<ExecutionSpanRecord>(sql, params);
  }

  /**
   * Lists traces for a tenant with optional filtering.
   */
  public async listTraces(filter?: {
    agentId?: string;
    status?: TraceStatus;
    driftOnly?: boolean;
    limit?: number;
  }): Promise<ExecutionTraceRecord[]> {
    const tenantId = this.getTenantId();
    let sql = 'SELECT * FROM execution_traces WHERE tenant_id = ?';
    const params: unknown[] = [tenantId];

    if (filter?.agentId) {
      sql += ' AND root_agent_id = ?';
      params.push(filter.agentId);
    }
    if (filter?.status) {
      sql += ' AND status = ?';
      params.push(filter.status);
    }
    if (filter?.driftOnly) {
      sql += ' AND drift_detected = 1';
    }

    sql += ' ORDER BY started_at DESC LIMIT ?;';
    params.push(filter?.limit || 50);

    return this.client.query<ExecutionTraceRecord>(sql, params);
  }

  /**
   * Aggregates telemetry overview metrics for the tenant.
   */
  public async getMetricsOverview(): Promise<ObservabilityMetricsOverview> {
    const tenantId = this.getTenantId();
    const traces = await this.client.query<ExecutionTraceRecord>(
      'SELECT * FROM execution_traces WHERE tenant_id = ?;',
      [tenantId]
    );

    if (traces.length === 0) {
      return {
        totalTraces: 0,
        completedTraces: 0,
        failedTraces: 0,
        escalatedTraces: 0,
        avgLatencyMs: 0,
        totalTokens: 0,
        totalCostUsd: 0,
        avgGroundingScore: null,
        driftRatePct: 0,
      };
    }

    const totalTraces = traces.length;
    const completedTraces = traces.filter((t) => t.status === 'completed').length;
    const failedTraces = traces.filter((t) => t.status === 'failed').length;
    const escalatedTraces = traces.filter((t) => t.status === 'escalated').length;
    const totalLatency = traces.reduce((acc, t) => acc + (t.total_latency_ms || 0), 0);
    const totalTokens = traces.reduce(
      (acc, t) => acc + (t.total_tokens_input || 0) + (t.total_tokens_output || 0),
      0
    );
    const totalCostUsd = traces.reduce((acc, t) => acc + (t.total_cost_usd || 0), 0);
    const totalGrounding = traces.reduce((acc, t) => acc + (t.grounding_score || 1.0), 0);
    const driftCount = traces.filter((t) => t.drift_detected === 1 || t.drift_detected === true).length;

    return {
      totalTraces,
      completedTraces,
      failedTraces,
      escalatedTraces,
      avgLatencyMs: Math.round(totalLatency / totalTraces),
      totalTokens,
      totalCostUsd: Math.round(totalCostUsd * 1000) / 1000,
      avgGroundingScore: Math.round((totalGrounding / totalTraces) * 100) / 100,
      driftRatePct: Math.round((driftCount / totalTraces) * 1000) / 10,
    };
  }
}
