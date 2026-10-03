/**
 * Kriya AI — Durable Job Worker Engine
 * Multi-queue concurrent worker with lease auto-heartbeats, graceful shutdown, and handler dispatching (docs/kriya WP-5.9).
 */

import { DurableJobQueue } from './durableJobQueue.js';
import { AsyncJob, JobQueueName } from '../types/infrastructureTypes.js';
import { CryptoUtils } from '../../core/utils/crypto.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import { logger } from '../../core/logger/logger.js';

export interface JobHandlerContext {
  workerId: string;
  signal: AbortSignal;
  heartbeat: () => Promise<boolean>;
}

export type JobHandler<T = any> = (
  job: AsyncJob,
  ctx: JobHandlerContext
) => Promise<Record<string, unknown> | void>;

export interface JobWorkerOptions {
  workerId?: string;
  concurrency?: number;
  queues?: JobQueueName[];
  pollIntervalMs?: number;
  lockDurationSeconds?: number;
  heartbeatIntervalMs?: number;
}

export class JobWorker {
  public readonly workerId: string;
  private readonly concurrency: number;
  private readonly queues: JobQueueName[];
  private readonly pollIntervalMs: number;
  private readonly lockDurationSeconds: number;
  private readonly heartbeatIntervalMs: number;

  private handlers = new Map<string, JobHandler>();
  private activeJobs = new Map<string, { job: AsyncJob; abortController: AbortController; timer: NodeJS.Timeout }>();
  private isRunning = false;
  private loopPromise?: Promise<void>;
  private loopAbortController?: AbortController;

  constructor(
    private readonly queue: DurableJobQueue,
    options: JobWorkerOptions = {}
  ) {
    this.workerId = options.workerId || `worker_${CryptoUtils.generateId().slice(0, 8)}`;
    this.concurrency = Math.max(1, options.concurrency ?? 5);
    this.queues = options.queues || ['high', 'default', 'low', 'batch'];
    this.pollIntervalMs = Math.max(50, options.pollIntervalMs ?? 250);
    this.lockDurationSeconds = Math.max(10, options.lockDurationSeconds ?? 60);
    this.heartbeatIntervalMs = Math.max(1000, options.heartbeatIntervalMs ?? 15000);
  }

  public registerHandler(jobType: string, handler: JobHandler): this {
    this.handlers.set(jobType, handler);
    return this;
  }

  public hasHandler(jobType: string): boolean {
    return this.handlers.has(jobType);
  }

  public getActiveCount(): number {
    return this.activeJobs.size;
  }

  public getIsRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Starts the background processing loop.
   */
  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.loopAbortController = new AbortController();
    this.loopPromise = this.runLoop(this.loopAbortController.signal);
    logger.info(`JobWorker [${this.workerId}] started with concurrency ${this.concurrency} on queues [${this.queues.join(', ')}]`);
  }

  /**
   * Gracefully stops the worker, waiting for in-flight jobs to conclude.
   */
  public async stop(gracePeriodMs = 5000): Promise<void> {
    if (!this.isRunning && this.activeJobs.size === 0) return;
    this.isRunning = false;
    this.loopAbortController?.abort();

    const start = Date.now();
    while (this.activeJobs.size > 0 && Date.now() - start < gracePeriodMs) {
      await new Promise((r) => setTimeout(r, 50));
    }

    // Abort any jobs still hanging
    for (const [jobId, item] of this.activeJobs.entries()) {
      item.abortController.abort();
      clearInterval(item.timer);
      this.activeJobs.delete(jobId);
    }

    if (this.loopPromise) {
      await this.loopPromise.catch(() => {});
    }

    logger.info(`JobWorker [${this.workerId}] stopped cleanly`);
  }

  public getActiveJobsCount(): number {
    return this.activeJobs.size;
  }

  /**
   * Runs a single job processing step.
   * Useful for deterministic testing and manual dispatch.
   */
  public async processNext(): Promise<{ processed: boolean; job?: AsyncJob; error?: Error }> {
    if (this.activeJobs.size >= this.concurrency) {
      return { processed: false };
    }

    const job = await this.queue.claimJob(this.workerId, {
      queueNames: this.queues,
      lockDurationSeconds: this.lockDurationSeconds,
    });

    if (!job) {
      return { processed: false };
    }

    try {
      await this.executeJob(job);
      return { processed: true, job };
    } catch (err) {
      return { processed: true, job, error: err instanceof Error ? err : new Error(String(err)) };
    }
  }

  private async runLoop(signal: AbortSignal): Promise<void> {
    while (!signal.aborted && this.isRunning) {
      try {
        if (this.activeJobs.size < this.concurrency) {
          const { processed } = await this.processNext();
          if (!processed) {
            // Idle backoff
            await new Promise((r) => setTimeout(r, this.pollIntervalMs));
          }
        } else {
          // At capacity, yield briefly
          await new Promise((r) => setTimeout(r, 50));
        }
      } catch (err) {
        logger.error(`JobWorker [${this.workerId}] loop error`, err);
        await new Promise((r) => setTimeout(r, this.pollIntervalMs));
      }
    }
  }

  private async executeJob(job: AsyncJob): Promise<void> {
    const handler = this.handlers.get(job.jobType);
    if (!handler) {
      const msg = `No handler registered for jobType '${job.jobType}'`;
      logger.error(`JobWorker [${this.workerId}] ${msg}`);
      await this.queue.failJob(job.id, msg);
      return;
    }

    const abortController = new AbortController();

    // Start auto-heartbeat timer
    const timer = setInterval(async () => {
      try {
        await this.queue.heartbeat(job.id, this.workerId, this.lockDurationSeconds);
      } catch (err) {
        logger.warn(`JobWorker [${this.workerId}] failed heartbeat for job '${job.id}'`, { error: String(err) });
      }
    }, this.heartbeatIntervalMs);

    this.activeJobs.set(job.id, { job, abortController, timer });
    const startedAt = Date.now();

    try {
      const ctx: JobHandlerContext = {
        workerId: this.workerId,
        signal: abortController.signal,
        heartbeat: () => this.queue.heartbeat(job.id, this.workerId, this.lockDurationSeconds),
      };

      const result = await TenantContextManager.withTenant(
        job.tenantId,
        'default',
        async () => handler(job, ctx)
      );

      clearInterval(timer);
      this.activeJobs.delete(job.id);
      const durationMs = Date.now() - startedAt;

      await this.queue.completeJob(job.id, result || {}, durationMs);
    } catch (err) {
      clearInterval(timer);
      this.activeJobs.delete(job.id);
      const durationMs = Date.now() - startedAt;

      logger.warn(`JobWorker [${this.workerId}] error processing job '${job.id}'`, { error: String(err) });
      await this.queue.failJob(job.id, err instanceof Error ? err : String(err), durationMs);
      throw err;
    }
  }
}
