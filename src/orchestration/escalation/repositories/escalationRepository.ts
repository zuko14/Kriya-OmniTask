import { db, DatabaseClient } from '../../../storage/db.js';
import {
  StructuredFailureRecord,
  EscalationTraceRecord,
  EscalationTraceStep,
} from '../types/escalationTypes.js';
import { logger } from '../../../core/logger/logger.js';

interface RawFailureRecordRow {
  id: string;
  tenant_id: string;
  task_id: string;
  correlation_id: string;
  agent_id: string;
  agent_slug: string;
  failure_class: string;
  stage: string;
  error_message: string;
  attempts_count: number;
  inputs_hash: string;
  tool_responses_json: string;
  confidence: number;
  recoverable: number;
  risk_tier: string;
  is_idempotent: number;
  remediation_status: string;
  escalation_level: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
}

interface RawTraceRow {
  id: string;
  tenant_id: string;
  task_id: string;
  correlation_id: string;
  current_level: string;
  status: string;
  total_attempts: number;
  total_duration_ms: number;
  total_cost_usd: number;
  steps_json: string;
  attention_item_id: string | null;
  created_at: string;
  updated_at: string;
}

export class EscalationRepository {
  private client: DatabaseClient;

  constructor(client?: DatabaseClient) {
    this.client = client || db.getClient();
  }

  /**
   * Records a structured failure emitted by an agent.
   */
  public async saveFailureRecord(record: StructuredFailureRecord): Promise<StructuredFailureRecord> {
    const id = record.id || `fail_${record.taskId}_${Date.now()}`;
    const agentSlug = record.agentSlug || record.agentId;
    const stage = record.stage || 'execution';
    const attemptsCount = record.attemptsCount || 1;
    const inputsHash = record.inputsHash || 'hash_default';
    const confidence = record.confidence !== undefined ? record.confidence : 1.0;
    const recoverable = record.recoverable !== undefined ? (record.recoverable ? 1 : 0) : 1;
    const isIdempotent = record.isIdempotent ? 1 : 0;
    const remediationStatus = record.remediationStatus || 'pending';
    const escalationLevel = record.escalationLevel || 'specialist';
    const now = new Date().toISOString();
    const createdAt = record.createdAt || now;
    const updatedAt = record.updatedAt || now;

    await this.client.execute(
      `INSERT INTO failure_records (
        id, tenant_id, task_id, correlation_id, agent_id, agent_slug,
        failure_class, stage, error_message, attempts_count, inputs_hash,
        tool_responses_json, confidence, recoverable, risk_tier, is_idempotent,
        remediation_status, escalation_level, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        attempts_count = excluded.attempts_count,
        remediation_status = excluded.remediation_status,
        escalation_level = excluded.escalation_level,
        updated_at = excluded.updated_at`,
      [
        id,
        record.tenantId,
        record.taskId,
        record.correlationId,
        record.agentId,
        agentSlug,
        record.failureClass,
        stage,
        record.errorMessage,
        attemptsCount,
        inputsHash,
        JSON.stringify(record.toolResponses || {}),
        confidence,
        recoverable,
        record.riskTier,
        isIdempotent,
        remediationStatus,
        escalationLevel,
        JSON.stringify(record.metadata || {}),
        createdAt,
        updatedAt,
      ]
    );

    record.id = id;
    record.agentSlug = agentSlug;
    record.stage = stage;
    record.createdAt = createdAt;
    record.updatedAt = updatedAt;

    return record;
  }

  /**
   * Retrieves a failure record by ID.
   */
  public async getFailureRecord(id: string): Promise<StructuredFailureRecord | null> {
    const row = await this.client.queryOne<RawFailureRecordRow>(
      'SELECT * FROM failure_records WHERE id = ?',
      [id]
    );
    if (!row) return null;
    return this.mapRowToFailureRecord(row);
  }

  /**
   * Retrieves all failure records for a tenant.
   */
  public async listFailureRecords(tenantId: string, limit = 50): Promise<StructuredFailureRecord[]> {
    const rows = await this.client.query<RawFailureRecordRow>(
      'SELECT * FROM failure_records WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?',
      [tenantId, limit]
    );
    return rows.map((r) => this.mapRowToFailureRecord(r));
  }

  /**
   * Retrieves or initializes an escalation trace for a given task.
   */
  public async getOrCreateTrace(
    tenantId: string,
    taskId: string,
    correlationId: string,
    initialLevel: StructuredFailureRecord['escalationLevel'] = 'specialist'
  ): Promise<EscalationTraceRecord> {
    const existing = await this.client.queryOne<RawTraceRow>(
      'SELECT * FROM escalation_traces WHERE tenant_id = ? AND task_id = ?',
      [tenantId, taskId]
    );

    if (existing) {
      return this.mapRowToTraceRecord(existing);
    }

    const now = new Date().toISOString();
    const traceId = `trace_${taskId}_${Date.now()}`;
    const initialTrace: EscalationTraceRecord = {
      id: traceId,
      tenantId,
      taskId,
      correlationId,
      currentLevel: initialLevel,
      status: 'in_progress',
      totalAttempts: 0,
      totalDurationMs: 0,
      totalCostUsd: 0.0,
      steps: [],
      attentionItemId: null,
      createdAt: now,
      updatedAt: now,
    };

    await this.client.execute(
      `INSERT INTO escalation_traces (
        id, tenant_id, task_id, correlation_id, current_level, status,
        total_attempts, total_duration_ms, total_cost_usd, steps_json,
        attention_item_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        initialTrace.id,
        initialTrace.tenantId,
        initialTrace.taskId,
        initialTrace.correlationId,
        initialTrace.currentLevel,
        initialTrace.status,
        initialTrace.totalAttempts,
        initialTrace.totalDurationMs,
        initialTrace.totalCostUsd,
        JSON.stringify(initialTrace.steps),
        initialTrace.attentionItemId,
        initialTrace.createdAt,
        initialTrace.updatedAt,
      ]
    );

    return initialTrace;
  }

  /**
   * Appends a step to an existing escalation trace and updates aggregated metrics.
   * §5: The whole chain is one audit trace, rendered as one view.
   */
  public async appendTraceStep(
    tenantId: string,
    taskId: string,
    step: Omit<EscalationTraceStep, 'stepNumber'>,
    updates?: {
      currentLevel?: EscalationTraceRecord['currentLevel'];
      status?: EscalationTraceRecord['status'];
      attentionItemId?: string | null;
    }
  ): Promise<EscalationTraceRecord> {
    const trace = await this.getOrCreateTrace(tenantId, taskId, step.evidence?.correlationId as string || 'corr_unknown');
    const stepNumber = trace.steps.length + 1;
    const fullStep: EscalationTraceStep = {
      ...step,
      stepNumber,
    };

    const updatedSteps = [...trace.steps, fullStep];
    const totalDuration = trace.totalDurationMs + (step.durationMs || 0);
    const totalCost = trace.totalCostUsd + (step.costUsd || 0);
    const totalAttempts = trace.totalAttempts + 1;
    const newLevel = updates?.currentLevel || step.level;
    const newStatus = updates?.status || trace.status;
    const attentionItemId = updates?.attentionItemId !== undefined ? updates.attentionItemId : trace.attentionItemId;
    const now = new Date().toISOString();

    await this.client.execute(
      `UPDATE escalation_traces SET
        current_level = ?,
        status = ?,
        total_attempts = ?,
        total_duration_ms = ?,
        total_cost_usd = ?,
        steps_json = ?,
        attention_item_id = ?,
        updated_at = ?
      WHERE id = ?`,
      [
        newLevel,
        newStatus,
        totalAttempts,
        totalDuration,
        totalCost,
        JSON.stringify(updatedSteps),
        attentionItemId,
        now,
        trace.id,
      ]
    );

    return {
      ...trace,
      currentLevel: newLevel,
      status: newStatus,
      totalAttempts,
      totalDurationMs: totalDuration,
      totalCostUsd: totalCost,
      steps: updatedSteps,
      attentionItemId,
      updatedAt: now,
    };
  }

  /**
   * Retrieves an escalation trace by task ID.
   */
  public async getTraceByTaskId(taskId: string, tenantId?: string): Promise<EscalationTraceRecord | null> {
    const sql = tenantId
      ? 'SELECT * FROM escalation_traces WHERE tenant_id = ? AND task_id = ?'
      : 'SELECT * FROM escalation_traces WHERE task_id = ?';
    const params = tenantId ? [tenantId, taskId] : [taskId];
    const row = await this.client.queryOne<RawTraceRow>(sql, params);
    if (!row) return null;
    return this.mapRowToTraceRecord(row);
  }

  private mapRowToFailureRecord(row: RawFailureRecordRow): StructuredFailureRecord {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      taskId: row.task_id,
      correlationId: row.correlation_id,
      agentId: row.agent_id,
      agentSlug: row.agent_slug,
      failureClass: row.failure_class as any,
      stage: row.stage,
      errorMessage: row.error_message,
      attemptsCount: row.attempts_count,
      inputsHash: row.inputs_hash,
      toolResponses: JSON.parse(row.tool_responses_json || '{}'),
      confidence: row.confidence,
      recoverable: row.recoverable === 1,
      riskTier: row.risk_tier as any,
      isIdempotent: row.is_idempotent === 1,
      remediationStatus: row.remediation_status as any,
      escalationLevel: row.escalation_level as any,
      metadata: JSON.parse(row.metadata_json || '{}'),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapRowToTraceRecord(row: RawTraceRow): EscalationTraceRecord {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      taskId: row.task_id,
      correlationId: row.correlation_id,
      currentLevel: row.current_level as any,
      status: row.status as any,
      totalAttempts: row.total_attempts,
      totalDurationMs: row.total_duration_ms,
      totalCostUsd: row.total_cost_usd,
      steps: JSON.parse(row.steps_json || '[]'),
      attentionItemId: row.attention_item_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
