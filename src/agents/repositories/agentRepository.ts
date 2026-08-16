/**
 * Xylarc AI — Agent & Lifecycle Event Repositories
 * Manages tenant-isolated agent registrations, state transition audits, and execution logs.
 */

import { BaseRepository } from '../../storage/repositories/baseRepository.js';
import { DatabaseClient } from '../../storage/db.js';
import { CryptoUtils } from '../../core/utils/crypto.js';
import {
  AgentRecord,
  AgentLifecycleEventRecord,
  AgentExecutionRecord,
  AgentCategory,
  Department,
  AgentLifecycleState,
  AgentTransitionAction,
} from '../types/agentTypes.js';

export class AgentRepository extends BaseRepository<AgentRecord> {
  protected readonly tableName = 'agents';

  constructor(client?: DatabaseClient) {
    super(client);
  }

  public async findBySlug(slug: string): Promise<AgentRecord | null> {
    const tenantId = this.getTenantId();
    return this.client.queryOne<AgentRecord>(
      'SELECT * FROM agents WHERE slug = ? AND tenant_id = ?;',
      [slug, tenantId]
    );
  }

  public async listAgents(filters?: {
    category?: AgentCategory;
    department?: Department;
    status?: AgentLifecycleState;
  }): Promise<AgentRecord[]> {
    const tenantId = this.getTenantId();
    let sql = 'SELECT * FROM agents WHERE tenant_id = ?';
    const params: unknown[] = [tenantId];

    if (filters?.category) {
      sql += ' AND category = ?';
      params.push(filters.category);
    }
    if (filters?.department) {
      sql += ' AND department = ?';
      params.push(filters.department);
    }
    if (filters?.status) {
      sql += ' AND status = ?';
      params.push(filters.status);
    }

    sql += ' ORDER BY created_at DESC;';
    return this.client.query<AgentRecord>(sql, params);
  }

  public async updateStatus(id: string, status: AgentLifecycleState): Promise<AgentRecord> {
    await this.update(id, { status });
    return (await this.findById(id))!;
  }
}

export class AgentLifecycleEventRepository extends BaseRepository<AgentLifecycleEventRecord> {
  protected readonly tableName = 'agent_lifecycle_events';

  constructor(client?: DatabaseClient) {
    super(client);
  }

  public async logTransition(params: {
    agentId: string;
    fromState: AgentLifecycleState;
    toState: AgentLifecycleState;
    transition: AgentTransitionAction;
    reason: string;
    actorType: 'human_operator' | 'agent' | 'system' | 'circuit_breaker';
    actorId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<AgentLifecycleEventRecord> {
    const tenantId = this.getTenantId();
    const id = CryptoUtils.generateId();
    const now = new Date().toISOString();
    const metadata_json = JSON.stringify(params.metadata || {});

    await this.client.execute(
      `INSERT INTO agent_lifecycle_events (id, tenant_id, agent_id, from_state, to_state, transition, reason, actor_type, actor_id, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        id,
        tenantId,
        params.agentId,
        params.fromState,
        params.toState,
        params.transition,
        params.reason,
        params.actorType,
        params.actorId || null,
        metadata_json,
        now,
        now,
      ]
    );

    return (await this.findById(id))!;
  }

  public async getHistory(agentId: string): Promise<AgentLifecycleEventRecord[]> {
    const tenantId = this.getTenantId();
    return this.client.query<AgentLifecycleEventRecord>(
      'SELECT * FROM agent_lifecycle_events WHERE agent_id = ? AND tenant_id = ? ORDER BY created_at DESC;',
      [agentId, tenantId]
    );
  }
}

export class AgentExecutionRepository extends BaseRepository<AgentExecutionRecord> {
  protected readonly tableName = 'agent_executions';

  constructor(client?: DatabaseClient) {
    super(client);
  }

  public async recordExecutionStart(params: {
    agentId: string;
    correlationId: string;
    taskId: string;
    input: Record<string, unknown>;
  }): Promise<AgentExecutionRecord> {
    const tenantId = this.getTenantId();
    const id = CryptoUtils.generateId();
    const now = new Date().toISOString();

    await this.client.execute(
      `INSERT INTO agent_executions (id, tenant_id, agent_id, correlation_id, task_id, input_json, status, cost_usd, duration_ms, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'running', 0.0, 0, ?, ?);`,
      [id, tenantId, params.agentId, params.correlationId, params.taskId, JSON.stringify(params.input), now, now]
    );

    return (await this.findById(id))!;
  }

  public async recordExecutionComplete(params: {
    executionId: string;
    status: 'completed' | 'failed' | 'escalated';
    output?: Record<string, unknown>;
    confidenceScore?: number;
    costUsd?: number;
    durationMs?: number;
    errorMessage?: string;
  }): Promise<AgentExecutionRecord> {
    await this.update(params.executionId, {
      status: params.status,
      output_json: params.output ? JSON.stringify(params.output) : undefined,
      confidence_score: params.confidenceScore,
      cost_usd: params.costUsd || 0.0,
      duration_ms: params.durationMs || 0,
      error_message: params.errorMessage,
    });

    return (await this.findById(params.executionId))!;
  }
}
