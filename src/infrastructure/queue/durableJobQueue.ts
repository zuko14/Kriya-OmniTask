/**
 * Kriya AI — Durable Job Queue Engine
 * Transactional priority queue on Postgres (FOR UPDATE SKIP LOCKED) and SQLite with exponential retries, DLQ, and quiet hours governance (docs/kriya WP-5.9).
 */

import { DatabaseClient, db } from '../../storage/db.js';
import { InfrastructureRepository } from '../repositories/infrastructureRepository.js';
import { WorkerQueueManager } from './workerQueueManager.js';
import { QuietHoursGovernor } from './quietHoursGovernor.js';
import {
  AsyncJob,
  JobQueueName,
  JobStatus,
} from '../types/infrastructureTypes.js';
import { CryptoUtils } from '../../core/utils/crypto.js';
import { NotFoundError, TenantIsolationError } from '../../core/errors/errors.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import { logger } from '../../core/logger/logger.js';

export interface EnqueueJobInput<T = Record<string, unknown>> {
  tenantId?: string;
  jobType: string;
  payload: T;
  queueName?: JobQueueName;
  priority?: number; // 1-100, default: 50
  runAt?: string | Date;
  maxRetries?: number; // default: 3
  correlationId?: string;
  idempotencyKey?: string;
  timezone?: string; // e.g. 'Asia/Kolkata', default: 'UTC'
  quietHoursPolicy?: 'none' | 'skip' | 'postpone';
}

export interface ClaimJobOptions {
  queueNames?: JobQueueName[];
  lockDurationSeconds?: number;
  tenantId?: string;
}

export interface JobFailureResult {
  newStatus: JobStatus;
  retryCount: number;
  nextRunAt?: string;
  errorMessage: string;
}

export class DurableJobQueue {
  private repo: InfrastructureRepository;

  constructor(clientOrRepo?: DatabaseClient | InfrastructureRepository) {
    if (clientOrRepo && 'claimNextPendingJob' in clientOrRepo) {
      this.repo = clientOrRepo as InfrastructureRepository;
    } else {
      const client = (clientOrRepo as DatabaseClient) || db.getClient();
      this.repo = new InfrastructureRepository(client);
    }
  }

  public getRepo(): InfrastructureRepository {
    return this.repo;
  }

  /**
   * Enqueues a durable background job with optional idempotency and quiet hours governance.
   */
  public async enqueue<T = Record<string, unknown>>(input: EnqueueJobInput<T>): Promise<AsyncJob> {
    const tenantId = input.tenantId || TenantContextManager.get()?.tenantId;
    if (!tenantId) {
      throw new TenantIsolationError('Operation rejected: Missing tenant context in enqueue scope.');
    }
    const now = new Date();
    const nowIso = now.toISOString();

    // Idempotency check: if an active job already exists with this idempotency key, return it.
    if (input.idempotencyKey) {
      const existing = await this.repo.findActiveByIdempotencyKey(tenantId, input.idempotencyKey);
      if (existing) {
        logger.info(`DurableJobQueue: Reusing existing active job '${existing.id}' for idempotencyKey '${input.idempotencyKey}'`);
        return existing;
      }
    }

    let runAtDate = input.runAt instanceof Date ? input.runAt : input.runAt ? new Date(input.runAt) : now;
    const timezone = input.timezone || 'UTC';
    const quietHoursPolicy = input.quietHoursPolicy || 'none';

    // Quiet hours scheduling evaluation
    if (quietHoursPolicy === 'postpone') {
      const evalResult = QuietHoursGovernor.evaluate(runAtDate, { timezone });
      if (evalResult.isQuietHours && evalResult.nextAllowedRunAt) {
        logger.info(`DurableJobQueue: Job postponed to '${evalResult.nextAllowedRunAt}' due to quiet hours in timezone '${timezone}'`);
        runAtDate = new Date(evalResult.nextAllowedRunAt);
      }
    }

    const job: AsyncJob = {
      id: `job_${CryptoUtils.generateId()}`,
      tenantId,
      queueName: input.queueName || 'default',
      jobType: input.jobType,
      payload: (input.payload as Record<string, any>) || {},
      priority: Math.max(1, Math.min(100, input.priority ?? 50)),
      status: 'pending',
      maxRetries: Math.max(0, input.maxRetries ?? 3),
      retryCount: 0,
      runAt: runAtDate.toISOString(),
      correlationId: input.correlationId,
      idempotencyKey: input.idempotencyKey,
      timezone,
      quietHoursPolicy,
      executionDurationMs: 0,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    await this.repo.saveJob(job);
    logger.info(`DurableJobQueue: Enqueued job '${job.id}' (${job.jobType}) on queue '${job.queueName}' with priority ${job.priority}`);
    return job;
  }

  /**
   * Atomically claims the next pending job across priority and schedules using FOR UPDATE SKIP LOCKED.
   */
  public async claimJob(
    workerId: string,
    queueNamesOrOptions?: JobQueueName[] | ClaimJobOptions,
    lockDurationSeconds?: number,
    tenantId?: string
  ): Promise<AsyncJob | null> {
    let queueNames: JobQueueName[] = ['high', 'default', 'low', 'batch'];
    let lockDuration = 60;
    let targetTenantId: string | undefined = tenantId;

    if (Array.isArray(queueNamesOrOptions)) {
      queueNames = queueNamesOrOptions;
      if (lockDurationSeconds !== undefined) lockDuration = lockDurationSeconds;
    } else if (queueNamesOrOptions && typeof queueNamesOrOptions === 'object') {
      if (queueNamesOrOptions.queueNames) queueNames = queueNamesOrOptions.queueNames;
      if (queueNamesOrOptions.lockDurationSeconds !== undefined) lockDuration = queueNamesOrOptions.lockDurationSeconds;
      if (queueNamesOrOptions.tenantId) targetTenantId = queueNamesOrOptions.tenantId;
    }

    return this.repo.claimNextPendingJob(queueNames, workerId, lockDuration, targetTenantId);
  }

  /**
   * Heartbeat to renew worker lease and prevent premature stale lock reclaim.
   */
  public async heartbeat(jobId: string, workerId: string, extendDurationSeconds = 60): Promise<boolean> {
    return this.repo.extendJobLock(jobId, workerId, extendDurationSeconds);
  }

  /**
   * Marks a job as completed and records results.
   */
  public async completeJob(jobId: string, result?: Record<string, any>, durationMs?: number): Promise<void> {
    await this.repo.updateJobStatus(jobId, 'completed', result, undefined, undefined, {
      executionDurationMs: durationMs,
    });
    logger.info(`DurableJobQueue: Job '${jobId}' marked completed`);
  }

  /**
   * Fails a job, evaluating exponential retry backoff or transition to dead_letter.
   */
  public async failJob(jobId: string, error: Error | string, durationMs?: number): Promise<JobFailureResult> {
    const job = await this.repo.getJobById(jobId);
    if (!job) throw new NotFoundError(`Job '${jobId}' not found.`);

    const errorMessage = error instanceof Error ? error.message : String(error);
    const failureEval = WorkerQueueManager.evaluateJobFailure(job, errorMessage);

    await this.repo.updateJobStatus(
      jobId,
      failureEval.newStatus,
      undefined,
      failureEval.errorMessage,
      failureEval.nextRunAt,
      {
        retryCount: failureEval.retryCount,
        executionDurationMs: durationMs,
      }
    );

    logger.warn(`DurableJobQueue: Job '${jobId}' failed: new status '${failureEval.newStatus}' (retry ${failureEval.retryCount}/${job.maxRetries})`);

    return {
      newStatus: failureEval.newStatus,
      retryCount: failureEval.retryCount,
      nextRunAt: failureEval.nextRunAt,
      errorMessage: failureEval.errorMessage,
    };
  }

  /**
   * Moves a job directly to dead-letter queue.
   */
  public async deadLetterJob(jobId: string, reason: string, durationMs?: number): Promise<void> {
    await this.repo.updateJobStatus(jobId, 'dead_letter', undefined, reason, undefined, {
      executionDurationMs: durationMs,
    });
    logger.warn(`DurableJobQueue: Job '${jobId}' sent to dead letter queue: ${reason}`);
  }

  /**
   * Retries a dead-letter job by re-arming it to pending with fresh attempt count.
   */
  public async retryDeadLetterJob(jobId: string): Promise<AsyncJob> {
    const job = await this.repo.getJobById(jobId);
    if (!job) throw new NotFoundError(`Job '${jobId}' not found.`);
    if (job.status !== 'dead_letter') {
      throw new Error(`Job '${jobId}' is not in dead_letter status (current status: '${job.status}').`);
    }

    const now = new Date().toISOString();
    await this.repo.updateJobStatus(jobId, 'pending', undefined, undefined, now, {
      retryCount: 0,
    });

    return (await this.repo.getJobById(jobId))!;
  }

  /**
   * Recovers jobs stuck in 'running' whose worker lease has expired (e.g. process crashed).
   */
  public async recoverStaleJobs(staleTimeoutMs = 300000): Promise<number> {
    const recoveredCount = await this.repo.recoverStaleJobs(staleTimeoutMs);
    if (recoveredCount > 0) {
      logger.warn(`DurableJobQueue: Recovered ${recoveredCount} stale running jobs back to pending`);
    }
    return recoveredCount;
  }

  public async getJob(jobId: string, tenantId?: string): Promise<AsyncJob | null> {
    return this.repo.getJobById(jobId, tenantId);
  }

  public async listJobs(tenantId: string, limit = 50): Promise<AsyncJob[]> {
    return this.repo.listJobs(tenantId, limit);
  }

  public async getMetrics(tenantId?: string): Promise<Record<string, Record<string, number>>> {
    return this.repo.getQueueMetrics(tenantId);
  }
}
