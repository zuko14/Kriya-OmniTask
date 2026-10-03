/**
 * Kriya AI — Dead Letter Queue (DLQ) Manager
 * Trapping unrecoverable job failures, retry eligibility tracking, and manual/automated remediation.
 */

import { DeadLetterJob, DeadLetterStatus } from '../types/reliabilityTypes.js';

export class DeadLetterQueueManager {
  /**
   * Asserts whether a failed job can be retried or should be routed to Dead-Letter storage.
   */
  public static evaluateRetry(
    currentRetryCount: number,
    maxRetries: number = 3
  ): { canRetry: boolean; nextRetryCount: number; nextStatus: DeadLetterStatus } {
    if (currentRetryCount < maxRetries) {
      return {
        canRetry: true,
        nextRetryCount: currentRetryCount + 1,
        nextStatus: 'retrying',
      };
    }

    return {
      canRetry: false,
      nextRetryCount: currentRetryCount,
      nextStatus: 'pending_review',
    };
  }

  /**
   * Sanitizes payload and error messages for DLQ persistence.
   */
  public static createJobRecord(params: {
    tenantId: string;
    organizationId?: string;
    jobType: string;
    payload: Record<string, unknown>;
    error: Error | string;
    maxRetries?: number;
  }): Omit<DeadLetterJob, 'id' | 'createdAt' | 'updatedAt'> {
    const failureReason = typeof params.error === 'string' ? params.error : params.error.message;
    const errorStack = typeof params.error === 'object' && params.error?.stack ? params.error.stack : null;

    return {
      tenantId: params.tenantId,
      organizationId: params.organizationId || 'default',
      jobType: params.jobType,
      payload: params.payload,
      failureReason,
      errorStack,
      retryCount: 0,
      maxRetries: params.maxRetries ?? 3,
      status: 'pending_review',
    };
  }
}
