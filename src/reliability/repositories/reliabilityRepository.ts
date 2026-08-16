/**
 * Xylarc AI — Reliability Engineering Relational Repository
 * Persistence for idempotency keys, dead-letter jobs, dependency health, and transaction checkpoints.
 */

import { BaseRepository } from '../../storage/repositories/baseRepository.js';
import { DatabaseClient } from '../../storage/db.js';
import {
  IdempotencyRecord,
  DeadLetterJob,
  DeadLetterStatus,
  DependencyHealth,
  DependencyHealthState,
  OperationRecoveryCheckpoint,
  OperationLifecycleState,
} from '../types/reliabilityTypes.js';
import { CryptoUtils } from '../../core/utils/crypto.js';

export class ReliabilityRepository extends BaseRepository<any> {
  protected readonly tableName = 'idempotency_keys';

  constructor(client?: DatabaseClient) {
    super(client);
  }

  public async findIdempotencyRecord(
    tenantId: string,
    idempotencyKey: string,
    resourceType: string
  ): Promise<IdempotencyRecord | null> {
    const rows = await this.client.query<any>(
      `SELECT id, tenant_id, organization_id, idempotency_key, resource_type,
              request_hash, response_payload, status, created_at, expires_at
       FROM idempotency_keys
       WHERE tenant_id = ? AND idempotency_key = ? AND resource_type = ?;`,
      [tenantId, idempotencyKey, resourceType]
    );

    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      id: row.id,
      tenantId: row.tenant_id,
      organizationId: row.organization_id,
      idempotencyKey: row.idempotency_key,
      resourceType: row.resource_type,
      requestHash: row.request_hash,
      responsePayload: row.response_payload || null,
      status: row.status,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    };
  }

  public async saveIdempotencyRecord(
    record: Omit<IdempotencyRecord, 'id' | 'createdAt'>
  ): Promise<IdempotencyRecord> {
    const id = `idem_${CryptoUtils.generateId()}`;
    const now = new Date().toISOString();

    await this.client.execute(
      `INSERT OR REPLACE INTO idempotency_keys
       (id, tenant_id, organization_id, idempotency_key, resource_type, request_hash, response_payload, status, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        id,
        record.tenantId,
        record.organizationId,
        record.idempotencyKey,
        record.resourceType,
        record.requestHash,
        record.responsePayload,
        record.status,
        now,
        record.expiresAt,
      ]
    );

    return {
      id,
      createdAt: now,
      ...record,
    };
  }

  public async updateIdempotencyStatus(
    tenantId: string,
    idempotencyKey: string,
    resourceType: string,
    status: 'in_progress' | 'completed' | 'failed',
    responsePayload?: string | null
  ): Promise<void> {
    await this.client.execute(
      `UPDATE idempotency_keys
       SET status = ?, response_payload = ?
       WHERE tenant_id = ? AND idempotency_key = ? AND resource_type = ?;`,
      [status, responsePayload || null, tenantId, idempotencyKey, resourceType]
    );
  }

  public async saveDeadLetterJob(
    job: Omit<DeadLetterJob, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<DeadLetterJob> {
    const id = `dlq_${CryptoUtils.generateId()}`;
    const now = new Date().toISOString();

    await this.client.execute(
      `INSERT INTO dead_letter_jobs
       (id, tenant_id, organization_id, job_type, payload, failure_reason, error_stack, retry_count, max_retries, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        id,
        job.tenantId,
        job.organizationId,
        job.jobType,
        JSON.stringify(job.payload),
        job.failureReason,
        job.errorStack || null,
        job.retryCount,
        job.maxRetries,
        job.status,
        now,
        now,
      ]
    );

    return {
      id,
      createdAt: now,
      updatedAt: now,
      ...job,
    };
  }

  public async listDeadLetterJobs(tenantId: string, status?: DeadLetterStatus): Promise<DeadLetterJob[]> {
    let query = `SELECT id, tenant_id, organization_id, job_type, payload, failure_reason, error_stack, retry_count, max_retries, status, created_at, updated_at
                 FROM dead_letter_jobs
                 WHERE tenant_id = ?`;
    const params: unknown[] = [tenantId];

    if (status) {
      query += ` AND status = ?`;
      params.push(status);
    }
    query += ` ORDER BY created_at DESC;`;

    const rows = await this.client.query<any>(query, params);
    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      organizationId: row.organization_id,
      jobType: row.job_type,
      payload: JSON.parse(row.payload),
      failureReason: row.failure_reason,
      errorStack: row.error_stack || null,
      retryCount: Number(row.retry_count),
      maxRetries: Number(row.max_retries),
      status: row.status as DeadLetterStatus,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  public async getDeadLetterJob(tenantId: string, id: string): Promise<DeadLetterJob | null> {
    const rows = await this.client.query<any>(
      `SELECT id, tenant_id, organization_id, job_type, payload, failure_reason, error_stack, retry_count, max_retries, status, created_at, updated_at
       FROM dead_letter_jobs
       WHERE tenant_id = ? AND id = ?;`,
      [tenantId, id]
    );

    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      id: row.id,
      tenantId: row.tenant_id,
      organizationId: row.organization_id,
      jobType: row.job_type,
      payload: JSON.parse(row.payload),
      failureReason: row.failure_reason,
      errorStack: row.error_stack || null,
      retryCount: Number(row.retry_count),
      maxRetries: Number(row.max_retries),
      status: row.status as DeadLetterStatus,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  public async updateDeadLetterJob(
    tenantId: string,
    id: string,
    status: DeadLetterStatus,
    retryCount: number
  ): Promise<void> {
    const now = new Date().toISOString();
    await this.client.execute(
      `UPDATE dead_letter_jobs
       SET status = ?, retry_count = ?, updated_at = ?
       WHERE tenant_id = ? AND id = ?;`,
      [status, retryCount, now, tenantId, id]
    );
  }

  public async upsertDependencyHealth(
    tenantId: string,
    dependencyName: string,
    state: DependencyHealthState,
    consecutiveFailures: number,
    latencyMs: number
  ): Promise<DependencyHealth> {
    const id = `dep_${CryptoUtils.generateId()}`;
    const now = new Date().toISOString();

    const existingRows = await this.client.query<any>(
      `SELECT id, consecutive_failures, failure_rate, latency_p95_ms
       FROM service_dependency_health
       WHERE tenant_id = ? AND dependency_name = ?;`,
      [tenantId, dependencyName]
    );

    if (existingRows.length > 0) {
      await this.client.execute(
        `UPDATE service_dependency_health
         SET state = ?, consecutive_failures = ?, latency_p95_ms = ?, last_probe_at = ?, updated_at = ?
         WHERE tenant_id = ? AND dependency_name = ?;`,
        [state, consecutiveFailures, latencyMs, now, now, tenantId, dependencyName]
      );
      return {
        id: existingRows[0].id,
        tenantId,
        dependencyName,
        state,
        consecutiveFailures,
        failureRate: Number(existingRows[0].failure_rate),
        latencyP95Ms: latencyMs,
        lastProbeAt: now,
        updatedAt: now,
      };
    } else {
      await this.client.execute(
        `INSERT INTO service_dependency_health
         (id, tenant_id, dependency_name, state, consecutive_failures, failure_rate, latency_p95_ms, last_probe_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        [id, tenantId, dependencyName, state, consecutiveFailures, 0.0, latencyMs, now, now]
      );
      return {
        id,
        tenantId,
        dependencyName,
        state,
        consecutiveFailures,
        failureRate: 0.0,
        latencyP95Ms: latencyMs,
        lastProbeAt: now,
        updatedAt: now,
      };
    }
  }

  public async listDependencyHealth(tenantId: string): Promise<DependencyHealth[]> {
    const rows = await this.client.query<any>(
      `SELECT id, tenant_id, dependency_name, state, consecutive_failures, failure_rate, latency_p95_ms, last_probe_at, updated_at
       FROM service_dependency_health
       WHERE tenant_id = ?
       ORDER BY dependency_name ASC;`,
      [tenantId]
    );

    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      dependencyName: row.dependency_name,
      state: row.state as DependencyHealthState,
      consecutiveFailures: Number(row.consecutive_failures),
      failureRate: Number(row.failure_rate),
      latencyP95Ms: Number(row.latency_p95_ms),
      lastProbeAt: row.last_probe_at,
      updatedAt: row.updated_at,
    }));
  }

  public async saveRecoveryCheckpoint(
    checkpoint: Omit<OperationRecoveryCheckpoint, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<OperationRecoveryCheckpoint> {
    const id = `rec_${CryptoUtils.generateId()}`;
    const now = new Date().toISOString();

    await this.client.execute(
      `INSERT INTO operation_recovery_log
       (id, tenant_id, organization_id, operation_id, operation_type, lifecycle_state, checkpoint_state_json, compensation_action_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        id,
        checkpoint.tenantId,
        checkpoint.organizationId,
        checkpoint.operationId,
        checkpoint.operationType,
        checkpoint.lifecycleState,
        JSON.stringify(checkpoint.checkpointState),
        checkpoint.compensationAction ? JSON.stringify(checkpoint.compensationAction) : null,
        now,
        now,
      ]
    );

    return {
      id,
      createdAt: now,
      updatedAt: now,
      ...checkpoint,
    };
  }

  public async getRecoveryCheckpoint(tenantId: string, operationId: string): Promise<OperationRecoveryCheckpoint | null> {
    const rows = await this.client.query<any>(
      `SELECT id, tenant_id, organization_id, operation_id, operation_type, lifecycle_state, checkpoint_state_json, compensation_action_json, created_at, updated_at
       FROM operation_recovery_log
       WHERE tenant_id = ? AND operation_id = ?
       ORDER BY created_at DESC
       LIMIT 1;`,
      [tenantId, operationId]
    );

    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      id: row.id,
      tenantId: row.tenant_id,
      organizationId: row.organization_id,
      operationId: row.operation_id,
      operationType: row.operation_type,
      lifecycleState: row.lifecycle_state as OperationLifecycleState,
      checkpointState: JSON.parse(row.checkpoint_state_json),
      compensationAction: row.compensation_action_json ? JSON.parse(row.compensation_action_json) : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
