import { describe, it, expect } from 'vitest';
import { WorkerQueueManager } from '../../src/infrastructure/queue/workerQueueManager.js';
import { AsyncJob } from '../../src/infrastructure/types/infrastructureTypes.js';

describe('WorkerQueueManager Unit Tests', () => {
  it('should calculate exponential backoff with upper bounds', () => {
    const backoff1 = WorkerQueueManager.calculateBackoffSeconds(1);
    expect(backoff1).toBeGreaterThanOrEqual(10); // 2^1 * 5 = 10 + jitter
    expect(backoff1).toBeLessThanOrEqual(13);

    const backoff2 = WorkerQueueManager.calculateBackoffSeconds(2);
    expect(backoff2).toBeGreaterThanOrEqual(20); // 2^2 * 5 = 20 + jitter
    expect(backoff2).toBeLessThanOrEqual(23);
  });

  it('should transition to pending with nextRunAt on intermediate retry, and dead_letter on max retries', () => {
    const job: AsyncJob = {
      id: 'job_test_retry',
      tenantId: 'tenant_1',
      queueName: 'default',
      jobType: 'email_sync',
      payload: {},
      priority: 50,
      status: 'running',
      maxRetries: 3,
      retryCount: 1,
      runAt: '2026-03-01T12:00:00Z',
      createdAt: '2026-03-01T12:00:00Z',
      updatedAt: '2026-03-01T12:00:00Z',
    };

    // Attempt 2 (less than maxRetries 3) -> pending with nextRunAt
    const eval1 = WorkerQueueManager.evaluateJobFailure(job, 'SMTP 503 error');
    expect(eval1.newStatus).toBe('pending');
    expect(eval1.retryCount).toBe(2);
    expect(eval1.nextRunAt).toBeDefined();

    // Attempt 3 (reaches maxRetries 3) -> dead_letter
    job.retryCount = 2;
    const eval2 = WorkerQueueManager.evaluateJobFailure(job, 'SMTP connection timeout');
    expect(eval2.newStatus).toBe('dead_letter');
    expect(eval2.retryCount).toBe(3);
    expect(eval2.errorMessage).toContain('Max retries (3) exhausted');
  });

  it('should prioritize candidate jobs by priority descending and runAt ascending', () => {
    const jobs: AsyncJob[] = [
      {
        id: 'job_low',
        tenantId: 'tenant_1',
        queueName: 'default',
        jobType: 'report',
        payload: {},
        priority: 10,
        status: 'pending',
        maxRetries: 3,
        retryCount: 0,
        runAt: '2026-03-01T10:00:00Z',
        createdAt: '2026-03-01T10:00:00Z',
        updatedAt: '2026-03-01T10:00:00Z',
      },
      {
        id: 'job_high',
        tenantId: 'tenant_1',
        queueName: 'default',
        jobType: 'urgent_sms',
        payload: {},
        priority: 90,
        status: 'pending',
        maxRetries: 3,
        retryCount: 0,
        runAt: '2026-03-01T12:00:00Z',
        createdAt: '2026-03-01T12:00:00Z',
        updatedAt: '2026-03-01T12:00:00Z',
      },
    ];

    const sorted = WorkerQueueManager.prioritizeCandidateJobs(jobs);
    expect(sorted[0].id).toBe('job_high');
    expect(sorted[1].id).toBe('job_low');
  });
});
