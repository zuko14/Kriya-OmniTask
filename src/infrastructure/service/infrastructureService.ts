/**
 * Kriya AI — Production Infrastructure Service
 * Orchestrates worker queues, connection pool metrics, scheduled jobs, and secret audits.
 */

import { CryptoUtils } from '../../core/utils/crypto.js';
import { InfrastructureRepository } from '../repositories/infrastructureRepository.js';
import { WorkerQueueManager } from '../queue/workerQueueManager.js';
import { ConnectionPoolManager } from '../pool/connectionPoolManager.js';
import { SecretAuditEngine } from '../secrets/secretAuditEngine.js';
import { DurableJobQueue } from '../queue/durableJobQueue.js';
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
  private durableQueue: DurableJobQueue;

  constructor(private repo: InfrastructureRepository) {
    this.poolManager = new ConnectionPoolManager(25);
    this.durableQueue = new DurableJobQueue(this.repo);
  }

  public getDurableQueue(): DurableJobQueue {
    return this.durableQueue;
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
      correlationId?: string;
      idempotencyKey?: string;
      timezone?: string;
      quietHoursPolicy?: 'none' | 'skip' | 'postpone';
    }
  ): Promise<AsyncJob> {
    return this.durableQueue.enqueue({
      tenantId,
      jobType,
      payload,
      queueName: options?.queueName,
      priority: options?.priority,
      runAt: options?.runAt,
      maxRetries: options?.maxRetries,
      correlationId: options?.correlationId,
      idempotencyKey: options?.idempotencyKey,
      timezone: options?.timezone,
      quietHoursPolicy: options?.quietHoursPolicy,
    });
  }

  /**
   * Worker task to atomically claim the next available job using FOR UPDATE SKIP LOCKED.
   */
  public async claimNextJob(
    workerId: string,
    queueNames: JobQueueName[] = ['high', 'default', 'low', 'batch'],
    lockDurationSeconds = 60
  ): Promise<AsyncJob | null> {
    return this.durableQueue.claimJob(workerId, { queueNames, lockDurationSeconds });
  }

  /**
   * Completes a running job with result payload.
   */
  public async completeJob(jobId: string, result: Record<string, any>): Promise<void> {
    await this.durableQueue.completeJob(jobId, result);
  }

  /**
   * Fails a running job, evaluating retry backoff or transition to dead_letter.
   */
  public async failJob(jobId: string, errorMessage: string): Promise<AsyncJob['status']> {
    const res = await this.durableQueue.failJob(jobId, errorMessage);
    return res.newStatus;
  }

  public async deadLetterJob(jobId: string, reason: string): Promise<void> {
    await this.durableQueue.deadLetterJob(jobId, reason);
  }

  public async retryDeadLetterJob(jobId: string): Promise<AsyncJob> {
    return this.durableQueue.retryDeadLetterJob(jobId);
  }

  public async recoverStaleJobs(staleTimeoutMs = 300000): Promise<number> {
    return this.durableQueue.recoverStaleJobs(staleTimeoutMs);
  }

  public async getQueueMetrics(tenantId?: string): Promise<Record<string, Record<string, number>>> {
    return this.durableQueue.getMetrics(tenantId);
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
