/**
 * Kriya AI — Verification Job Relational Repository
 * Persistence and state management for async read-back verification jobs (§14 of CLAUDE.md, docs/kriya WP-4.6, WP-3.4).
 */

import { BaseRepository } from '../../storage/repositories/baseRepository.js';
import { DatabaseClient } from '../../storage/db.js';
import {
  VerificationJobRecord,
  CreateVerificationJobInput,
  CreateVerificationJobSchema,
} from '../types/attentionTypes.js';
import { CryptoUtils } from '../../core/utils/crypto.js';
import { NotFoundError } from '../../core/errors/errors.js';

export class VerificationJobRepository extends BaseRepository<VerificationJobRecord> {
  protected readonly tableName = 'verification_jobs';

  constructor(client?: DatabaseClient) {
    super(client);
  }

  /**
   * Creates an asynchronous read-back verification job.
   * Idempotent per tenant & idempotency_key.
   */
  public async createJob(input: CreateVerificationJobInput): Promise<VerificationJobRecord> {
    const validated = CreateVerificationJobSchema.parse(input);
    const tenantId = this.getTenantId();

    // Check for existing job with same idempotency key
    const existing = await this.client.queryOne<VerificationJobRecord>(
      'SELECT * FROM verification_jobs WHERE tenant_id = ? AND idempotency_key = ? LIMIT 1;',
      [tenantId, validated.idempotencyKey]
    );
    if (existing) return existing;

    const id = CryptoUtils.generateId();
    const now = new Date();
    const nowIso = now.toISOString();
    const deadlineAt = new Date(now.getTime() + validated.deadlineMinutes * 60 * 1000).toISOString();
    const nextCheckAt = new Date(now.getTime() + validated.intervalSeconds * 1000).toISOString();

    const record: VerificationJobRecord = {
      id,
      tenant_id: tenantId,
      run_id: validated.runId,
      tool_slug: validated.toolSlug,
      action_input_json: JSON.stringify(validated.actionInput),
      action_output_json: JSON.stringify(validated.actionOutput),
      idempotency_key: validated.idempotencyKey,
      status: 'pending',
      attempts: 0,
      max_attempts: validated.maxAttempts,
      deadline_at: deadlineAt,
      next_check_at: nextCheckAt,
      observed_state_json: null,
      error_message: null,
      created_at: nowIso,
      updated_at: nowIso,
    };

    await this.client.execute(
      `INSERT INTO verification_jobs (
        id, tenant_id, run_id, tool_slug, action_input_json, action_output_json,
        idempotency_key, status, attempts, max_attempts, deadline_at, next_check_at,
        observed_state_json, error_message, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        record.id,
        record.tenant_id,
        record.run_id,
        record.tool_slug,
        record.action_input_json,
        record.action_output_json,
        record.idempotency_key,
        record.status,
        record.attempts,
        record.max_attempts,
        record.deadline_at,
        record.next_check_at,
        record.observed_state_json,
        record.error_message,
        record.created_at,
        record.updated_at,
      ]
    );

    return record;
  }

  /**
   * Retrieves pending jobs that are due for verification.
   */
  public async findPendingJobs(now = new Date(), limit = 20): Promise<VerificationJobRecord[]> {
    const tenantId = this.getTenantId();
    return this.client.query<VerificationJobRecord>(
      `SELECT * FROM verification_jobs
       WHERE tenant_id = ? AND status = 'pending' AND next_check_at <= ?
       ORDER BY next_check_at ASC LIMIT ?;`,
      [tenantId, now.toISOString(), limit]
    );
  }

  /**
   * Finds all verification jobs associated with a graph run.
   */
  public async findByRunId(runId: string): Promise<VerificationJobRecord[]> {
    const tenantId = this.getTenantId();
    return this.client.query<VerificationJobRecord>(
      'SELECT * FROM verification_jobs WHERE tenant_id = ? AND run_id = ? ORDER BY created_at ASC;',
      [tenantId, runId]
    );
  }

  /**
   * Marks a job verified after external confirmation.
   */
  public async markVerified(id: string, observed: Record<string, unknown>): Promise<VerificationJobRecord> {
    const tenantId = this.getTenantId();
    const now = new Date().toISOString();

    await this.client.execute(
      `UPDATE verification_jobs SET
        status = 'verified',
        attempts = attempts + 1,
        observed_state_json = ?,
        error_message = NULL,
        updated_at = ?
       WHERE id = ? AND tenant_id = ?;`,
      [JSON.stringify(observed), now, id, tenantId]
    );

    return (await this.findById(id))!;
  }

  /**
   * Marks a job mismatched when external state contradicts the expected action.
   */
  public async markMismatch(
    id: string,
    observed: Record<string, unknown>,
    errorMessage: string
  ): Promise<VerificationJobRecord> {
    const tenantId = this.getTenantId();
    const now = new Date().toISOString();

    await this.client.execute(
      `UPDATE verification_jobs SET
        status = 'mismatch',
        attempts = attempts + 1,
        observed_state_json = ?,
        error_message = ?,
        updated_at = ?
       WHERE id = ? AND tenant_id = ?;`,
      [JSON.stringify(observed), errorMessage, now, id, tenantId]
    );

    return (await this.findById(id))!;
  }

  /**
   * Marks a job expired when deadline exceeded or max attempts reached without verification.
   */
  public async markExpired(id: string, errorMessage: string): Promise<VerificationJobRecord> {
    const tenantId = this.getTenantId();
    const now = new Date().toISOString();

    await this.client.execute(
      `UPDATE verification_jobs SET
        status = 'expired',
        attempts = attempts + 1,
        error_message = ?,
        updated_at = ?
       WHERE id = ? AND tenant_id = ?;`,
      [errorMessage, now, id, tenantId]
    );

    return (await this.findById(id))!;
  }

  /**
   * Records a failed attempt and schedules the next check.
   */
  public async recordFailedAttempt(
    id: string,
    nextCheckAt: string,
    errorMessage: string
  ): Promise<VerificationJobRecord> {
    const tenantId = this.getTenantId();
    const now = new Date().toISOString();

    await this.client.execute(
      `UPDATE verification_jobs SET
        attempts = attempts + 1,
        next_check_at = ?,
        error_message = ?,
        updated_at = ?
       WHERE id = ? AND tenant_id = ?;`,
      [nextCheckAt, errorMessage, now, id, tenantId]
    );

    return (await this.findById(id))!;
  }

  /**
   * Lists verification jobs for the active tenant with optional status filtering and pagination.
   * Supports single status ('pending') or multi-status separated by pipe or comma ('pending|mismatch|expired').
   */
  public async listJobs(options?: {
    status?: string;
    runId?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ jobs: VerificationJobRecord[]; total: number; limit: number; offset: number; count: number }> {
    const tenantId = this.getTenantId();
    const limit = Math.max(1, Math.min(options?.limit ?? 50, 200));
    const offset = Math.max(0, options?.offset ?? 0);

    const conditions: string[] = ['tenant_id = ?'];
    const params: unknown[] = [tenantId];

    if (options?.status) {
      const statuses = options.status
        .split(/[,|]/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      if (statuses.length === 1) {
        conditions.push('status = ?');
        params.push(statuses[0]);
      } else if (statuses.length > 1) {
        conditions.push(`status IN (${statuses.map(() => '?').join(', ')})`);
        params.push(...statuses);
      }
    }

    if (options?.runId) {
      conditions.push('run_id = ?');
      params.push(options.runId);
    }

    const whereClause = conditions.join(' AND ');

    const countRow = await this.client.queryOne<{ cnt: number | string }>(
      `SELECT COUNT(*) as cnt FROM verification_jobs WHERE ${whereClause};`,
      params
    );
    const total = countRow ? Number(countRow.cnt) : 0;

    const jobs = await this.client.query<VerificationJobRecord>(
      `SELECT * FROM verification_jobs WHERE ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?;`,
      [...params, limit, offset]
    );

    return {
      jobs,
      total,
      limit,
      offset,
      count: jobs.length,
    };
  }
}
