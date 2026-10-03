/**
 * Kriya AI — Asynchronous Worker Queue Manager
 * Priority-driven, multi-queue job dispatcher with exponential retry backoff and dead-letter handling.
 */

import { AsyncJob, JobQueueName } from '../types/infrastructureTypes.js';

export class WorkerQueueManager {
  /**
   * Calculates exponential backoff seconds for retries: 2^retryCount * 5s + jitter.
   */
  public static calculateBackoffSeconds(retryCount: number): number {
    const baseSeconds = Math.min(3600, Math.pow(2, retryCount) * 5); // Max 1 hour
    const jitter = Math.floor(Math.random() * 3);
    return baseSeconds + jitter;
  }

  /**
   * Determines if a job should be transitioned to dead_letter or scheduled for retry.
   */
  public static evaluateJobFailure(
    job: AsyncJob,
    errorMessage: string
  ): {
    newStatus: AsyncJob['status'];
    retryCount: number;
    nextRunAt?: string;
    errorMessage: string;
  } {
    const nextRetry = job.retryCount + 1;
    if (nextRetry >= job.maxRetries) {
      return {
        newStatus: 'dead_letter',
        retryCount: nextRetry,
        errorMessage: `Max retries (${job.maxRetries}) exhausted. Last error: ${errorMessage}`,
      };
    }

    const backoffSeconds = this.calculateBackoffSeconds(nextRetry);
    const nextRunAt = new Date(Date.now() + backoffSeconds * 1000).toISOString();

    return {
      newStatus: 'pending',
      retryCount: nextRetry,
      nextRunAt,
      errorMessage,
    };
  }

  /**
   * Sorts candidate jobs by priority (highest first) and scheduled execution time (earliest first).
   */
  public static prioritizeCandidateJobs(jobs: AsyncJob[]): AsyncJob[] {
    return [...jobs].sort((a, b) => {
      if (b.priority !== a.priority) {
        return b.priority - a.priority; // Higher priority first
      }
      return new Date(a.runAt).getTime() - new Date(b.runAt).getTime(); // Earlier runAt first
    });
  }
}
