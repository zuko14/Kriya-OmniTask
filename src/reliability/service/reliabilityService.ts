/**
 * Xylarc AI — Reliability Engineering Service
 * High-level orchestration of idempotency protection, circuit breakers, dead-letter recovery, and state transitions.
 */

import { ReliabilityRepository } from '../repositories/reliabilityRepository.js';
import { IdempotencyManager } from '../idempotency/idempotencyManager.js';
import { BulkheadCircuitBreaker } from '../circuit/bulkheadCircuitBreaker.js';
import { DeadLetterQueueManager } from '../dlq/deadLetterQueueManager.js';
import { StateRecoveryEngine } from '../recovery/stateRecoveryEngine.js';
import {
  IdempotentExecuteRequest,
  DeadLetterJob,
  DeadLetterStatus,
  DependencyHealth,
  OperationRecoveryCheckpoint,
  OperationLifecycleState,
} from '../types/reliabilityTypes.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import { NotFoundError } from '../../core/errors/errors.js';
import { logger } from '../../core/logger/logger.js';

export class ReliabilityService {
  private repo = new ReliabilityRepository();
  private circuitBreakers = new Map<string, BulkheadCircuitBreaker>();

  private getCircuitBreaker(dependencyName: string): BulkheadCircuitBreaker {
    let cb = this.circuitBreakers.get(dependencyName);
    if (!cb) {
      cb = new BulkheadCircuitBreaker(dependencyName);
      this.circuitBreakers.set(dependencyName, cb);
    }
    return cb;
  }

  /**
   * Executes an arbitrary action wrapped in end-to-end cryptographic idempotency.
   */
  public async executeIdempotent<T extends Record<string, unknown>>(
    request: IdempotentExecuteRequest,
    action: () => Promise<T>
  ): Promise<{ result: T; cached: boolean }> {
    const tenantId = TenantContextManager.getTenantId();
    const orgId = TenantContextManager.getRequired().organizationId || 'default';
    const requestHash = IdempotencyManager.computePayloadHash(request.payload);

    // 1. Check existing record
    const existing = await this.repo.findIdempotencyRecord(tenantId, request.idempotencyKey, request.resourceType);
    const evaluation = IdempotencyManager.evaluateExistingKey(existing, requestHash);

    if (!evaluation.canExecute && evaluation.cachedResponse) {
      logger.info('IdempotencyManager served cached result without re-execution:', {
        tenantId,
        idempotencyKey: request.idempotencyKey,
        resourceType: request.resourceType,
      });
      return { result: evaluation.cachedResponse as T, cached: true };
    }

    // 2. Register key as in_progress
    const ttlSeconds = request.ttlSeconds || 86400;
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

    await this.repo.saveIdempotencyRecord({
      tenantId,
      organizationId: orgId,
      idempotencyKey: request.idempotencyKey,
      resourceType: request.resourceType,
      requestHash,
      responsePayload: null,
      status: 'in_progress',
      expiresAt,
    });

    // 3. Execute payload action
    try {
      const result = await action();
      await this.repo.updateIdempotencyStatus(
        tenantId,
        request.idempotencyKey,
        request.resourceType,
        'completed',
        JSON.stringify(result)
      );
      return { result, cached: false };
    } catch (err: any) {
      await this.repo.updateIdempotencyStatus(
        tenantId,
        request.idempotencyKey,
        request.resourceType,
        'failed',
        null
      );
      throw err;
    }
  }

  /**
   * Records a dependency probe and adjusts circuit breaker state.
   */
  public async recordDependencyProbe(
    dependencyName: string,
    isSuccess: boolean,
    latencyMs: number
  ): Promise<DependencyHealth> {
    const tenantId = TenantContextManager.getTenantId();
    const cb = this.getCircuitBreaker(dependencyName);
    cb.recordResult(isSuccess, latencyMs);

    return this.repo.upsertDependencyHealth(
      tenantId,
      dependencyName,
      cb.getState(),
      cb.getConsecutiveFailures(),
      latencyMs
    );
  }

  public async listDependencyHealth(): Promise<DependencyHealth[]> {
    const tenantId = TenantContextManager.getTenantId();
    return this.repo.listDependencyHealth(tenantId);
  }

  /**
   * Enqueues an unrecoverable failure into the dead letter queue.
   */
  public async routeToDeadLetterQueue(params: {
    jobType: string;
    payload: Record<string, unknown>;
    error: Error | string;
    maxRetries?: number;
  }): Promise<DeadLetterJob> {
    const tenantId = TenantContextManager.getTenantId();
    const orgId = TenantContextManager.getRequired().organizationId || 'default';

    const jobRecord = DeadLetterQueueManager.createJobRecord({
      tenantId,
      organizationId: orgId,
      jobType: params.jobType,
      payload: params.payload,
      error: params.error,
      maxRetries: params.maxRetries,
    });

    return this.repo.saveDeadLetterJob(jobRecord);
  }

  public async listDeadLetterJobs(status?: DeadLetterStatus): Promise<DeadLetterJob[]> {
    const tenantId = TenantContextManager.getTenantId();
    return this.repo.listDeadLetterJobs(tenantId, status);
  }

  public async replayDeadLetterJob(id: string): Promise<{ success: boolean; status: DeadLetterStatus; message: string }> {
    const tenantId = TenantContextManager.getTenantId();
    const job = await this.repo.getDeadLetterJob(tenantId, id);
    if (!job) {
      throw new NotFoundError(`Dead letter job '${id}' not found`);
    }

    const evaluation = DeadLetterQueueManager.evaluateRetry(job.retryCount, job.maxRetries);
    if (!evaluation.canRetry) {
      return {
        success: false,
        status: job.status,
        message: `Maximum retries (${job.maxRetries}) exceeded. Job requires manual human intervention.`,
      };
    }

    await this.repo.updateDeadLetterJob(tenantId, id, evaluation.nextStatus, evaluation.nextRetryCount);
    return {
      success: true,
      status: evaluation.nextStatus,
      message: `Job '${id}' scheduled for retry attempt #${evaluation.nextRetryCount}.`,
    };
  }

  public async discardDeadLetterJob(id: string): Promise<void> {
    const tenantId = TenantContextManager.getTenantId();
    const job = await this.repo.getDeadLetterJob(tenantId, id);
    if (!job) {
      throw new NotFoundError(`Dead letter job '${id}' not found`);
    }
    await this.repo.updateDeadLetterJob(tenantId, id, 'discarded', job.retryCount);
  }

  /**
   * Records a lifecycle state checkpoint.
   */
  public async checkpointOperation(params: {
    operationId: string;
    operationType: string;
    lifecycleState: OperationLifecycleState;
    checkpointState: Record<string, unknown>;
    compensationAction?: Record<string, unknown> | null;
  }): Promise<OperationRecoveryCheckpoint> {
    const tenantId = TenantContextManager.getTenantId();
    const orgId = TenantContextManager.getRequired().organizationId || 'default';

    return this.repo.saveRecoveryCheckpoint({
      tenantId,
      organizationId: orgId,
      operationId: params.operationId,
      operationType: params.operationType,
      lifecycleState: params.lifecycleState,
      checkpointState: params.checkpointState,
      compensationAction: params.compensationAction || null,
    });
  }

  /**
   * Plans recovery from the latest operation checkpoint.
   */
  public async recoverOperation(operationId: string): Promise<{
    plan: ReturnType<typeof StateRecoveryEngine.planRecovery>;
    checkpoint: OperationRecoveryCheckpoint;
  }> {
    const tenantId = TenantContextManager.getTenantId();
    const checkpoint = await this.repo.getRecoveryCheckpoint(tenantId, operationId);
    if (!checkpoint) {
      throw new NotFoundError(`No checkpoint found for operation '${operationId}'`);
    }

    const plan = StateRecoveryEngine.planRecovery(checkpoint);
    return { plan, checkpoint };
  }
}
