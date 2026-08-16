/**
 * Xylarc AI — Production Infrastructure Service
 * Orchestrates worker queues, connection pool metrics, scheduled jobs, and secret audits.
 */

import { CryptoUtils } from '../../core/utils/crypto.js';
import { InfrastructureRepository } from '../repositories/infrastructureRepository.js';
import { WorkerQueueManager } from '../queue/workerQueueManager.js';
import { ConnectionPoolManager } from '../pool/connectionPoolManager.js';
import { SecretAuditEngine } from '../secrets/secretAuditEngine.js';
import {
  AsyncJob,
  ScheduledJob,
  ConnectionPoolStats,
  SecretAuditReport,
  JobQueueName,
} from '../types/infrastructureTypes.js';
import { NotFoundError, ValidationError } from '../../core/errors/errors.js';
import { logger } from '../../core/logger/logger.js';

export class InfrastructureService {
  private poolManager: ConnectionPoolManager;

  constructor(private repo: InfrastructureRepository) {
    this.poolManager = new ConnectionPoolManager(25);
  }

  /**
   * Enqueues an asynchronous background job into the persistent worker queue.
   */
  public async enqueueJob(
    tenantId: string,
    jobType: string,
    payload: Record<string, any>,
    options?: {
      queueName?: JobQueueName;
      priority?: number;
      runAt?: string;
      maxRetries?: number;
    }
  ): Promise<AsyncJob> {
    const now = new Date().toISOString();
    const job: AsyncJob = {
      id: `job_${CryptoUtils.generateId()}`,
      tenantId,
      queueName: options?.queueName || 'default',
      jobType,
      payload,
      priority: options?.priority ?? 50,
      status: 'pending',
      maxRetries: options?.maxRetries ?? 3,
      retryCount: 0,
      runAt: options?.runAt || now,
      createdAt: now,
      updatedAt: now,
    };

    await this.repo.saveJob(job);
    logger.info(`Enqueued job ${job.id} (${job.jobType}) on queue '${job.queueName}' with priority ${job.priority}`);
    return job;
  }

  /**
   * Worker task to atomically claim the next available job.
   */
  public async claimNextJob(
    workerId: string,
    queueNames: JobQueueName[] = ['high', 'default', 'low', 'batch']
  ): Promise<AsyncJob | null> {
    return this.repo.claimNextPendingJob(queueNames, workerId);
  }

  /**
   * Completes a running job with result payload.
   */
  public async completeJob(jobId: string, result: Record<string, any>): Promise<void> {
    await this.repo.updateJobStatus(jobId, 'completed', result);
    logger.info(`Completed job ${jobId} successfully`);
  }

  /**
   * Fails a running job, evaluating retry backoff or transition to dead_letter.
   */
  public async failJob(jobId: string, errorMessage: string): Promise<AsyncJob['status']> {
    const job = await this.repo.getJobById(jobId);
    if (!job) {
      throw new NotFoundError(`Job ${jobId} not found`);
    }

    const failureEval = WorkerQueueManager.evaluateJobFailure(job, errorMessage);
    await this.repo.updateJobStatus(
      jobId,
      failureEval.newStatus,
      undefined,
      failureEval.errorMessage,
      failureEval.nextRunAt
    );

    logger.warn(`Failed job ${jobId}: transitioned to status '${failureEval.newStatus}' (retry ${failureEval.retryCount})`);
    return failureEval.newStatus;
  }

  public async getJob(jobId: string, tenantId?: string): Promise<AsyncJob | null> {
    return this.repo.getJobById(jobId, tenantId);
  }

  public async listJobs(tenantId: string, limit = 50): Promise<AsyncJob[]> {
    return this.repo.listJobs(tenantId, limit);
  }

  /**
   * Connection pool diagnostics.
   */
  public getConnectionPoolStats(): ConnectionPoolStats {
    return this.poolManager.getStats();
  }

  public getPoolManager(): ConnectionPoolManager {
    return this.poolManager;
  }

  /**
   * Triggers an automated secret inventory and Shannon entropy scan.
   */
  public async runSecretAudit(
    envSnapshot?: Record<string, string | undefined>
  ): Promise<SecretAuditReport> {
    const targetEnv = envSnapshot || process.env;
    const reportId = `sec_audit_${CryptoUtils.generateId()}`;
    const report = SecretAuditEngine.auditEnvironmentSecrets(targetEnv, reportId);

    await this.repo.saveSecretAuditReport(report);
    logger.info(`Ran secret inventory audit ${reportId}: Scanned ${report.secretsScannedCount}, Found ${report.vulnerabilitiesFoundCount} vulnerabilities`);
    return report;
  }

  public async getLatestSecretAuditReport(): Promise<SecretAuditReport | null> {
    return this.repo.getLatestSecretAuditReport();
  }

  /**
   * Scheduled job management.
   */
  public async registerScheduledJob(
    name: string,
    cronExpression: string,
    jobType: string,
    metadata?: Record<string, any>
  ): Promise<ScheduledJob> {
    const now = new Date().toISOString();
    const job: ScheduledJob = {
      id: `sched_${CryptoUtils.generateId()}`,
      name,
      cronExpression,
      jobType,
      isActive: true,
      nextRunAt: new Date(Date.now() + 3600 * 1000).toISOString(),
      metadata,
      createdAt: now,
      updatedAt: now,
    };

    await this.repo.saveScheduledJob(job);
    return job;
  }

  public async listScheduledJobs(): Promise<ScheduledJob[]> {
    return this.repo.listScheduledJobs();
  }
}
