/**
 * Kriya AI — Workflow Repositories
 * Relational persistence for workflow definitions, DAG execution runs, and human approval requests (§13, §15 of CLAUDE.md).
 */

import { BaseRepository } from '../../storage/repositories/baseRepository.js';
import { DatabaseClient } from '../../storage/db.js';
import {
  WorkflowDefinitionRecord,
  WorkflowExecutionRecord,
  WorkflowApprovalRequestRecord,
  WorkflowDefinitionInput,
  ExecutionStatus,
  ApprovalStatus,
  StepExecutionResult,
} from '../types/workflowTypes.js';
import { CryptoUtils } from '../../core/utils/crypto.js';

export class WorkflowDefinitionRepository extends BaseRepository<WorkflowDefinitionRecord> {
  protected readonly tableName = 'workflow_definitions';

  constructor(client?: DatabaseClient) {
    super(client);
  }

  public async saveDefinition(input: WorkflowDefinitionInput): Promise<WorkflowDefinitionRecord> {
    const tenantId = this.getTenantId();
    const existing = await this.findBySlug(input.slug);
    const now = new Date().toISOString();

    if (existing) {
      const sql = `
        UPDATE workflow_definitions
        SET name = ?, description = ?, trigger_type = ?, dag_json = ?,
            is_active = ?, version = ?, updated_at = ?
        WHERE tenant_id = ? AND slug = ?
        RETURNING *;
      `;
      const rows = await this.client.query<WorkflowDefinitionRecord>(sql, [
        input.name,
        input.description,
        input.triggerType,
        JSON.stringify(input.dag),
        input.isActive !== false ? 1 : 0,
        input.version,
        now,
        tenantId,
        input.slug,
      ]);
      return rows[0];
    }

    return this.create({
      slug: input.slug,
      name: input.name,
      description: input.description,
      trigger_type: input.triggerType || 'manual',
      dag_json: JSON.stringify(input.dag),
      is_active: input.isActive !== false ? 1 : 0,
      version: input.version || '1.0.0',
    });
  }

  public async findBySlug(slug: string): Promise<WorkflowDefinitionRecord | null> {
    const tenantId = this.getTenantId();
    const sql = `SELECT * FROM workflow_definitions WHERE tenant_id = ? AND slug = ? LIMIT 1;`;
    const rows = await this.client.query<WorkflowDefinitionRecord>(sql, [tenantId, slug]);
    return rows[0] || null;
  }

  public async listActive(): Promise<WorkflowDefinitionRecord[]> {
    const tenantId = this.getTenantId();
    const sql = `SELECT * FROM workflow_definitions WHERE tenant_id = ? AND is_active = 1 ORDER BY name ASC;`;
    return this.client.query<WorkflowDefinitionRecord>(sql, [tenantId]);
  }

  public async deleteBySlug(slug: string): Promise<boolean> {
    const tenantId = this.getTenantId();
    const sql = `DELETE FROM workflow_definitions WHERE tenant_id = ? AND slug = ?;`;
    const res = await this.client.execute(sql, [tenantId, slug]);
    return res.changes > 0;
  }
}

export class WorkflowExecutionRepository extends BaseRepository<WorkflowExecutionRecord> {
  protected readonly tableName = 'workflow_executions';

  constructor(client?: DatabaseClient) {
    super(client);
  }

  public async createExecution(params: {
    workflowId: string;
    correlationId?: string;
    contextData: Record<string, unknown>;
  }): Promise<WorkflowExecutionRecord> {
    const now = new Date().toISOString();
    return this.create({
      workflow_id: params.workflowId,
      correlation_id: params.correlationId || CryptoUtils.generateCorrelationId(),
      status: 'pending',
      current_step_id: null,
      context_data_json: JSON.stringify(params.contextData),
      step_results_json: JSON.stringify({}),
      error_message: null,
      started_at: null,
      completed_at: null,
    });
  }

  public async updateExecutionProgress(params: {
    executionId: string;
    status: ExecutionStatus;
    currentStepId?: string | null;
    stepResults?: Record<string, StepExecutionResult>;
    errorMessage?: string | null;
    startedAt?: string | null;
    completedAt?: string | null;
  }): Promise<WorkflowExecutionRecord | null> {
    const tenantId = this.getTenantId();
    const existing = await this.findById(params.executionId);
    if (!existing) return null;

    const now = new Date().toISOString();
    const stepResultsJson = params.stepResults
      ? JSON.stringify(params.stepResults)
      : existing.step_results_json;

    const sql = `
      UPDATE workflow_executions
      SET status = ?, current_step_id = ?, step_results_json = ?, error_message = ?,
          started_at = COALESCE(?, started_at), completed_at = COALESCE(?, completed_at), updated_at = ?
      WHERE tenant_id = ? AND id = ?
      RETURNING *;
    `;

    const rows = await this.client.query<WorkflowExecutionRecord>(sql, [
      params.status,
      params.currentStepId !== undefined ? params.currentStepId : existing.current_step_id,
      stepResultsJson,
      params.errorMessage !== undefined ? params.errorMessage : existing.error_message,
      params.startedAt || null,
      params.completedAt || null,
      now,
      tenantId,
      params.executionId,
    ]);

    return rows[0] || null;
  }

  public async listRecent(limit: number = 50, statusFilter?: string): Promise<WorkflowExecutionRecord[]> {
    const tenantId = this.getTenantId();
    if (statusFilter) {
      const sql = `
        SELECT * FROM workflow_executions
        WHERE tenant_id = ? AND status = ?
        ORDER BY created_at DESC
        LIMIT ?;
      `;
      return this.client.query<WorkflowExecutionRecord>(sql, [tenantId, statusFilter, limit]);
    }

    const sql = `
      SELECT * FROM workflow_executions
      WHERE tenant_id = ?
      ORDER BY created_at DESC
      LIMIT ?;
    `;
    return this.client.query<WorkflowExecutionRecord>(sql, [tenantId, limit]);
  }
}

export class WorkflowApprovalRequestRepository extends BaseRepository<WorkflowApprovalRequestRecord> {
  protected readonly tableName = 'workflow_approval_requests';

  constructor(client?: DatabaseClient) {
    super(client);
  }

  public async createRequest(params: {
    executionId: string;
    stepId: string;
    requiredRole?: string;
    payload?: Record<string, unknown>;
  }): Promise<WorkflowApprovalRequestRecord> {
    return this.create({
      execution_id: params.executionId,
      step_id: params.stepId,
      status: 'pending',
      required_role: params.requiredRole || 'admin',
      step_payload_json: JSON.stringify(params.payload || {}),
      decision_by: null,
      decision_notes: null,
      decided_at: null,
    });
  }

  public async findPending(executionId: string, stepId: string): Promise<WorkflowApprovalRequestRecord | null> {
    const tenantId = this.getTenantId();
    const sql = `
      SELECT * FROM workflow_approval_requests
      WHERE tenant_id = ? AND execution_id = ? AND step_id = ? AND status = 'pending'
      LIMIT 1;
    `;
    const rows = await this.client.query<WorkflowApprovalRequestRecord>(sql, [tenantId, executionId, stepId]);
    return rows[0] || null;
  }

  public async listPending(limit: number = 50): Promise<WorkflowApprovalRequestRecord[]> {
    const tenantId = this.getTenantId();
    const sql = `
      SELECT * FROM workflow_approval_requests
      WHERE tenant_id = ? AND status = 'pending'
      ORDER BY created_at DESC
      LIMIT ?;
    `;
    return this.client.query<WorkflowApprovalRequestRecord>(sql, [tenantId, limit]);
  }

  public async recordDecision(params: {
    requestId: string;
    decision: ApprovalStatus;
    decisionBy: string;
    notes?: string;
  }): Promise<WorkflowApprovalRequestRecord | null> {
    const tenantId = this.getTenantId();
    const now = new Date().toISOString();
    const sql = `
      UPDATE workflow_approval_requests
      SET status = ?, decision_by = ?, decision_notes = ?, decided_at = ?, updated_at = ?
      WHERE tenant_id = ? AND id = ?
      RETURNING *;
    `;
    const rows = await this.client.query<WorkflowApprovalRequestRecord>(sql, [
      params.decision,
      params.decisionBy,
      params.notes || null,
      now,
      now,
      tenantId,
      params.requestId,
    ]);
    return rows[0] || null;
  }
}
