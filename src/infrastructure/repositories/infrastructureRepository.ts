/**
 * Xylarc AI — Production Infrastructure Repository
 * Database access layer for asynchronous worker queues, scheduled jobs, and secret audit reports.
 */

import { DatabaseClient } from '../../storage/db.js';
import { AsyncJob, ScheduledJob, SecretAuditReport, JobQueueName } from '../types/infrastructureTypes.js';

export class InfrastructureRepository {
  constructor(private client: DatabaseClient) {}

  public async saveJob(job: AsyncJob): Promise<void> {
    await this.client.execute(
      `INSERT INTO async_job_queue (
        id, tenant_id, queue_name, job_type, payload_json, priority, status,
        max_retries, retry_count, run_at, locked_by_worker, locked_until,
        error_message, result_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        retry_count = excluded.retry_count,
        run_at = excluded.run_at,
        locked_by_worker = excluded.locked_by_worker,
        locked_until = excluded.locked_until,
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
        job.lockedByWorker ?? null,
        job.lockedUntil ?? null,
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
    lockDurationSeconds = 60
  ): Promise<AsyncJob | null> {
    const now = new Date().toISOString();
    const placeholders = queueNames.map(() => '?').join(',');

    const rows = await this.client.query<any>(
      `SELECT * FROM async_job_queue
       WHERE queue_name IN (${placeholders})
         AND (status = 'pending' OR (status = 'running' AND locked_until < ?))
         AND run_at <= ?
       ORDER BY priority DESC, run_at ASC
       LIMIT 1;`,
      [...queueNames, now, now]
    );

    if (!rows.length) return null;

    const candidate = this.mapRowToJob(rows[0]);
    const lockedUntil = new Date(Date.now() + lockDurationSeconds * 1000).toISOString();

    await this.client.execute(
      `UPDATE async_job_queue
       SET status = 'running', locked_by_worker = ?, locked_until = ?, updated_at = ?
       WHERE id = ?;`,
      [workerId, lockedUntil, now, candidate.id]
    );

    candidate.status = 'running';
    candidate.lockedByWorker = workerId;
    candidate.lockedUntil = lockedUntil;
    return candidate;
  }

  public async updateJobStatus(
    id: string,
    status: AsyncJob['status'],
    result?: Record<string, any>,
    errorMessage?: string,
    nextRunAt?: string
  ): Promise<void> {
    const now = new Date().toISOString();
    await this.client.execute(
      `UPDATE async_job_queue
       SET status = ?, result_json = ?, error_message = ?, run_at = COALESCE(?, run_at),
           locked_by_worker = NULL, locked_until = NULL, updated_at = ?
       WHERE id = ?;`,
      [
        status,
        result ? JSON.stringify(result) : null,
        errorMessage ?? null,
        nextRunAt ?? null,
        now,
        id,
      ]
    );
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
      lockedByWorker: r.locked_by_worker ?? undefined,
      lockedUntil: r.locked_until ?? undefined,
      errorMessage: r.error_message ?? undefined,
      result: r.result_json ? JSON.parse(r.result_json) : undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }
}
