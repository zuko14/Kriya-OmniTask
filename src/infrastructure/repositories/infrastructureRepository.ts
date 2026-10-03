/**
 * Kriya AI — Production Infrastructure Repository
 * Database access layer for asynchronous worker queues, scheduled jobs, and secret audit reports.
 */

import { DatabaseClient } from '../../storage/db.js';
import { AsyncJob, ScheduledJob, SecretAuditReport, JobQueueName } from '../types/infrastructureTypes.js';
import { ValidationError } from '../../core/errors/errors.js';

export class InfrastructureRepository {
  constructor(private client: DatabaseClient) {}

  public getClient(): DatabaseClient {
    return this.client;
  }

  public async saveJob(job: AsyncJob): Promise<void> {
    await this.client.execute(
      `INSERT INTO async_job_queue (
        id, tenant_id, queue_name, job_type, payload_json, priority, status,
        max_retries, retry_count, run_at, correlation_id, idempotency_key, timezone,
        quiet_hours_policy, locked_by_worker, locked_until, last_heartbeat_at,
        execution_duration_ms, error_message, result_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        retry_count = excluded.retry_count,
        run_at = excluded.run_at,
        locked_by_worker = excluded.locked_by_worker,
        locked_until = excluded.locked_until,
        last_heartbeat_at = excluded.last_heartbeat_at,
        execution_duration_ms = excluded.execution_duration_ms,
        error_message = excluded.error_message,
        result_json = excluded.result_json,
        updated_at = excluded.updated_at;`,
      [
        job.id,
        job.tenantId,
        job.queueName,
        job.jobType,
        JSON.stringify(job.payload),
        job.priority,
        job.status,
        job.maxRetries,
        job.retryCount,
        job.runAt,
        job.correlationId ?? null,
        job.idempotencyKey ?? null,
        job.timezone ?? 'UTC',
        job.quietHoursPolicy ?? 'none',
        job.lockedByWorker ?? null,
        job.lockedUntil ?? null,
        job.lastHeartbeatAt ?? null,
        job.executionDurationMs ?? 0,
        job.errorMessage ?? null,
        job.result ? JSON.stringify(job.result) : null,
        job.createdAt,
        job.updatedAt,
      ]
    );
  }

  public async getJobById(id: string, tenantId?: string): Promise<AsyncJob | null> {
    const query = tenantId
      ? 'SELECT * FROM async_job_queue WHERE id = ? AND tenant_id = ?;'
      : 'SELECT * FROM async_job_queue WHERE id = ?;';
    const params = tenantId ? [id, tenantId] : [id];

    const rows = await this.client.query<any>(query, params);
    if (!rows.length) return null;
    return this.mapRowToJob(rows[0]);
  }

  public async findActiveByIdempotencyKey(
    tenantId: string,
    idempotencyKey: string
  ): Promise<AsyncJob | null> {
    const rows = await this.client.query<any>(
      `SELECT * FROM async_job_queue
       WHERE tenant_id = ? AND idempotency_key = ? AND status IN ('pending', 'running')
       ORDER BY created_at DESC LIMIT 1;`,
      [tenantId, idempotencyKey]
    );
    if (!rows.length) return null;
    return this.mapRowToJob(rows[0]);
  }

  public async listJobs(tenantId: string, limit = 50): Promise<AsyncJob[]> {
    const rows = await this.client.query<any>(
      'SELECT * FROM async_job_queue WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?;',
      [tenantId, limit]
    );
    return rows.map((r: any) => this.mapRowToJob(r));
  }

  public async claimNextPendingJob(
    queueNames: JobQueueName[],
    workerId: string,
    lockDurationSeconds = 60,
    tenantId?: string
  ): Promise<AsyncJob | null> {
    const ALLOWED_QUEUES = new Set<string>(['high', 'default', 'low', 'batch']);
    for (const q of queueNames) {
      if (!ALLOWED_QUEUES.has(q)) {
        throw new ValidationError(`Invalid queue name '${q}'. Allowed: ${Array.from(ALLOWED_QUEUES).join(', ')}`);
      }
    }

    const now = new Date().toISOString();
    const placeholders = queueNames.map(() => '?').join(',');
    const lockedUntil = new Date(Date.now() + lockDurationSeconds * 1000).toISOString();

    const tenantCondition = tenantId ? 'AND tenant_id = ?' : '';
    const params = tenantId
      ? [...queueNames, tenantId, now, now]
      : [...queueNames, now, now];

    const queueOrderCases = queueNames.map((q, idx) => `WHEN '${q}' THEN ${idx}`).join(' ');
    const orderClause = queueNames.length > 1
      ? `CASE queue_name ${queueOrderCases} ELSE 99 END ASC, priority DESC, run_at ASC`
      : `priority DESC, run_at ASC`;

    return this.client.transaction(async (tx) => {
      const rows = await tx.query<any>(
        `SELECT * FROM async_job_queue
         WHERE queue_name IN (${placeholders})
           ${tenantCondition}
           AND (status = 'pending' OR (status = 'running' AND locked_until < ?))
           AND run_at <= ?
         ORDER BY ${orderClause}
         LIMIT 1
         FOR UPDATE SKIP LOCKED;`,
        params
      );

      if (!rows.length) return null;

      const candidate = this.mapRowToJob(rows[0]);

      await tx.execute(
        `UPDATE async_job_queue
         SET status = 'running', locked_by_worker = ?, locked_until = ?, last_heartbeat_at = ?, updated_at = ?
         WHERE id = ?;`,
        [workerId, lockedUntil, now, now, candidate.id]
      );

      candidate.status = 'running';
      candidate.lockedByWorker = workerId;
      candidate.lockedUntil = lockedUntil;
      candidate.lastHeartbeatAt = now;
      return candidate;
    });
  }

  public async extendJobLock(
    jobId: string,
    workerId: string,
    extendDurationSeconds = 60
  ): Promise<boolean> {
    const now = new Date().toISOString();
    const lockedUntil = new Date(Date.now() + extendDurationSeconds * 1000).toISOString();

    const res = await this.client.execute(
      `UPDATE async_job_queue
       SET locked_until = ?, last_heartbeat_at = ?, updated_at = ?
       WHERE id = ? AND locked_by_worker = ? AND status = 'running';`,
      [lockedUntil, now, now, jobId, workerId]
    );

    return res.changes > 0;
  }

  public async updateJobStatus(
    id: string,
    status: AsyncJob['status'],
    result?: Record<string, any>,
    errorMessage?: string,
    nextRunAt?: string,
    extra?: { retryCount?: number; executionDurationMs?: number }
  ): Promise<void> {
    const now = new Date().toISOString();
    await this.client.execute(
      `UPDATE async_job_queue
       SET status = ?,
           result_json = ?,
           error_message = ?,
           run_at = COALESCE(?, run_at),
           retry_count = COALESCE(?, retry_count),
           execution_duration_ms = COALESCE(?, execution_duration_ms),
           locked_by_worker = NULL,
           locked_until = NULL,
           updated_at = ?
       WHERE id = ?;`,
      [
        status,
        result ? JSON.stringify(result) : null,
        errorMessage ?? null,
        nextRunAt ?? null,
        extra?.retryCount !== undefined ? extra.retryCount : null,
        extra?.executionDurationMs !== undefined ? extra.executionDurationMs : null,
        now,
        id,
      ]
    );
  }

  public async recoverStaleJobs(staleTimeoutMs = 300000): Promise<number> {
    const now = new Date();
    const nowIso = now.toISOString();

    const res = await this.client.execute(
      `UPDATE async_job_queue
       SET status = 'pending',
           locked_by_worker = NULL,
           locked_until = NULL,
           updated_at = ?
       WHERE status = 'running'
         AND locked_until IS NOT NULL
         AND locked_until < ?;`,
      [nowIso, nowIso]
    );

    return res.changes;
  }

  public async getQueueMetrics(tenantId?: string): Promise<Record<string, Record<string, number>>> {
    const query = tenantId
      ? `SELECT queue_name, status, COUNT(*) as count FROM async_job_queue WHERE tenant_id = ? GROUP BY queue_name, status;`
      : `SELECT queue_name, status, COUNT(*) as count FROM async_job_queue GROUP BY queue_name, status;`;
    const params = tenantId ? [tenantId] : [];

    const rows = await this.client.query<{ queue_name: string; status: string; count: number }>(query, params);
    const metrics: Record<string, Record<string, number>> = {};

    for (const r of rows) {
      if (!metrics[r.queue_name]) {
        metrics[r.queue_name] = { pending: 0, running: 0, completed: 0, failed: 0, dead_letter: 0 };
      }
      metrics[r.queue_name][r.status] = Number(r.count);
    }

    return metrics;
  }

  public async saveScheduledJob(job: ScheduledJob): Promise<void> {
    await this.client.execute(
      `INSERT INTO scheduled_jobs (
        id, name, cron_expression, job_type, is_active, last_run_at, next_run_at, last_status, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        is_active = excluded.is_active,
        last_run_at = excluded.last_run_at,
        next_run_at = excluded.next_run_at,
        last_status = excluded.last_status,
        updated_at = excluded.updated_at;`,
      [
        job.id,
        job.name,
        job.cronExpression,
        job.jobType,
        job.isActive ? 1 : 0,
        job.lastRunAt ?? null,
        job.nextRunAt ?? null,
        job.lastStatus ?? null,
        job.metadata ? JSON.stringify(job.metadata) : null,
        job.createdAt,
        job.updatedAt,
      ]
    );
  }

  public async listScheduledJobs(): Promise<ScheduledJob[]> {
    const rows = await this.client.query<any>('SELECT * FROM scheduled_jobs ORDER BY name ASC;');
    return rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      cronExpression: r.cron_expression,
      jobType: r.job_type,
      isActive: Boolean(r.is_active),
      lastRunAt: r.last_run_at ?? undefined,
      nextRunAt: r.next_run_at ?? undefined,
      lastStatus: r.last_status ?? undefined,
      metadata: r.metadata_json ? JSON.parse(r.metadata_json) : undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  public async saveSecretAuditReport(report: SecretAuditReport): Promise<void> {
    await this.client.execute(
      `INSERT INTO secret_audit_records (
        id, scan_type, secrets_scanned_count, vulnerabilities_found_count, audit_report_json, scanned_at
      ) VALUES (?, ?, ?, ?, ?, ?);`,
      [
        report.id,
        report.scanType,
        report.secretsScannedCount,
        report.vulnerabilitiesFoundCount,
        JSON.stringify(report.findings),
        report.scannedAt,
      ]
    );
  }

  public async getLatestSecretAuditReport(): Promise<SecretAuditReport | null> {
    const rows = await this.client.query<any>(
      'SELECT * FROM secret_audit_records ORDER BY scanned_at DESC LIMIT 1;'
    );
    if (!rows.length) return null;
    const r = rows[0];
    return {
      id: r.id,
      scanType: r.scan_type,
      secretsScannedCount: Number(r.secrets_scanned_count),
      vulnerabilitiesFoundCount: Number(r.vulnerabilities_found_count),
      findings: JSON.parse(r.audit_report_json),
      scannedAt: r.scanned_at,
    };
  }

  private mapRowToJob(r: any): AsyncJob {
    return {
      id: r.id,
      tenantId: r.tenant_id,
      queueName: r.queue_name,
      jobType: r.job_type,
      payload: JSON.parse(r.payload_json),
      priority: Number(r.priority),
      status: r.status,
      maxRetries: Number(r.max_retries),
      retryCount: Number(r.retry_count),
      runAt: r.run_at,
      correlationId: r.correlation_id ?? undefined,
      idempotencyKey: r.idempotency_key ?? undefined,
      timezone: r.timezone ?? 'UTC',
      quietHoursPolicy: r.quiet_hours_policy ?? 'none',
      lockedByWorker: r.locked_by_worker ?? undefined,
      lockedUntil: r.locked_until ?? undefined,
      lastHeartbeatAt: r.last_heartbeat_at ?? undefined,
      executionDurationMs: Number(r.execution_duration_ms ?? 0),
      errorMessage: r.error_message ?? undefined,
      result: r.result_json ? JSON.parse(r.result_json) : undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }
}
