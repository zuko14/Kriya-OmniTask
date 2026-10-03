/**
 * Kriya AI — Production Durable Job Queue & Worker Engine Tests (WP-5.9)
 *
 * Verifies:
 * 1. Priority queues & FIFO ordering (high > default > low > batch, priority desc, runAt asc).
 * 2. Atomic lease locking & zero double-execution across concurrent workers.
 * 3. Worker heartbeat mechanism extending lease timeouts.
 * 4. Crash recovery: stale worker leases released back to 'pending' via recoverStaleJobs().
 * 5. Idempotent enqueue deduplication preventing duplicate job creation.
 * 6. Quiet hours governance with timezone-aware postponement.
 * 7. Failure retries with exponential backoff and transition to dead_letter queue (DLQ).
 * 8. DLQ inspection and manual retry restoration.
 * 9. JobWorker engine: handler dispatch, automatic lease heartbeat, concurrency limits, and graceful shutdown.
 * 10. Multi-tenant isolation in job queues and queue metrics.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SQLiteDatabaseClient, db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { TenantRepository } from '../../src/storage/repositories/tenantRepository.js';
import { TenantContextManager } from '../../src/core/context/tenantContext.js';
import { InfrastructureRepository } from '../../src/infrastructure/repositories/infrastructureRepository.js';
import { DurableJobQueue } from '../../src/infrastructure/queue/durableJobQueue.js';
import { JobWorker } from '../../src/infrastructure/queue/jobWorker.js';
import { QuietHoursGovernor } from '../../src/infrastructure/queue/quietHoursGovernor.js';

describe('WP-5.9: Durable Job Queue & Worker Engine', () => {
  let client: SQLiteDatabaseClient;
  let repo: InfrastructureRepository;
  let queue: DurableJobQueue;
  let tenantA: string;
  let tenantB: string;

  const inTenantA = <T>(fn: () => Promise<T>) =>
    TenantContextManager.withTenant(tenantA, 'org_a', fn, {
      userId: 'usr_ops_lead',
      roles: ['operations_lead', 'admin'],
    });

  const inTenantB = <T>(fn: () => Promise<T>) =>
    TenantContextManager.withTenant(tenantB, 'org_b', fn, {
      userId: 'usr_tenant_b',
      roles: ['operations_lead'],
    });

  beforeEach(async () => {
    client = new SQLiteDatabaseClient(':memory:');
    db.setClientForTesting(client);
    await new SchemaMigrator(client).applyMigrations();

    const tenantRepo = new TenantRepository(client);
    tenantA = (await tenantRepo.create({ name: 'Alpha Health', slug: 'alpha-health', plan_tier: 'enterprise', channel_plan: 'combined' })).id;
    tenantB = (await tenantRepo.create({ name: 'Beta Systems', slug: 'beta-systems', plan_tier: 'enterprise', channel_plan: 'combined' })).id;

    repo = new InfrastructureRepository(client);
    queue = new DurableJobQueue(repo);
  });

  afterEach(async () => {
    await client.close();
  });

  describe('1. Priority Queuing and Ordering', () => {
    it('claims jobs ordered by priority descending and runAt ascending', async () => {
      await inTenantA(async () => {
        // Enqueue jobs with varying priorities and runAt
        const now = Date.now();
        await queue.enqueue({
          jobType: 'low_task',
          payload: { order: 1 },
          priority: 10,
          runAt: new Date(now - 2000),
        });

        await queue.enqueue({
          jobType: 'high_urgent_task',
          payload: { order: 2 },
          priority: 95,
          runAt: new Date(now - 1000),
        });

        await queue.enqueue({
          jobType: 'high_earlier_task',
          payload: { order: 3 },
          priority: 95,
          runAt: new Date(now - 5000),
        });

        await queue.enqueue({
          jobType: 'normal_task',
          payload: { order: 4 },
          priority: 50,
          runAt: new Date(now - 3000),
        });

        // Claim sequentially
        const job1 = await queue.claimJob('worker_1', ['default']);
        expect(job1).not.toBeNull();
        expect(job1?.jobType).toBe('high_earlier_task'); // Highest priority, earlier runAt

        const job2 = await queue.claimJob('worker_1', ['default']);
        expect(job2?.jobType).toBe('high_urgent_task'); // Highest priority, later runAt

        const job3 = await queue.claimJob('worker_1', ['default']);
        expect(job3?.jobType).toBe('normal_task'); // Middle priority

        const job4 = await queue.claimJob('worker_1', ['default']);
        expect(job4?.jobType).toBe('low_task'); // Lowest priority

        const job5 = await queue.claimJob('worker_1', ['default']);
        expect(job5).toBeNull(); // All claimed
      });
    });

    it('claims jobs strictly honoring queue priority order (high before default before batch)', async () => {
      await inTenantA(async () => {
        await queue.enqueue({ jobType: 'batch_job', queueName: 'batch', payload: {} });
        await queue.enqueue({ jobType: 'high_job', queueName: 'high', payload: {} });
        await queue.enqueue({ jobType: 'default_job', queueName: 'default', payload: {} });

        // Worker polling ['high', 'default', 'batch']
        const job1 = await queue.claimJob('worker_1', ['high', 'default', 'batch']);
        expect(job1?.jobType).toBe('high_job');

        const job2 = await queue.claimJob('worker_1', ['high', 'default', 'batch']);
        expect(job2?.jobType).toBe('default_job');

        const job3 = await queue.claimJob('worker_1', ['high', 'default', 'batch']);
        expect(job3?.jobType).toBe('batch_job');
      });
    });

    it('does not claim future scheduled jobs until runAt arrives', async () => {
      await inTenantA(async () => {
        const futureTime = new Date(Date.now() + 60000); // 1 minute in future
        await queue.enqueue({
          jobType: 'future_job',
          payload: {},
          runAt: futureTime,
        });

        const claimed = await queue.claimJob('worker_1', ['default']);
        expect(claimed).toBeNull();
      });
    });
  });

  describe('2. Atomic Lease Locking & Concurrency Protection', () => {
    it('prevents multiple workers from claiming the same job', async () => {
      await inTenantA(async () => {
        const job = await queue.enqueue({ jobType: 'single_claim_test', payload: {} });

        const worker1Claim = await queue.claimJob('worker_1', ['default'], 60);
        expect(worker1Claim).not.toBeNull();
        expect(worker1Claim?.id).toBe(job.id);
        expect(worker1Claim?.lockedByWorker).toBe('worker_1');
        expect(worker1Claim?.status).toBe('running');

        // Worker 2 attempts to claim while worker 1 holds active lease
        const worker2Claim = await queue.claimJob('worker_2', ['default'], 60);
        expect(worker2Claim).toBeNull();
      });
    });

    it('records execution duration upon completion', async () => {
      await inTenantA(async () => {
        const job = await queue.enqueue({ jobType: 'timing_test', payload: {} });
        await queue.claimJob('worker_1', ['default']);

        await queue.completeJob(job.id, { processed: true }, 245);

        const updated = await repo.getJobById(job.id);
        expect(updated?.status).toBe('completed');
        expect(updated?.result).toEqual({ processed: true });
        expect(updated?.executionDurationMs).toBe(245);
        expect(updated?.lockedByWorker).toBeUndefined();
      });
    });
  });

  describe('3. Heartbeat Mechanism', () => {
    it('extends the lease duration and updates lastHeartbeatAt', async () => {
      await inTenantA(async () => {
        const job = await queue.enqueue({ jobType: 'heartbeat_test', payload: {} });
        const claimed = await queue.claimJob('worker_1', ['default'], 30);
        const originalLockedUntil = claimed?.lockedUntil;

        // Advance 2 seconds
        await new Promise((res) => setTimeout(res, 20));

        const heartbeatSuccess = await queue.heartbeat(job.id, 'worker_1', 60);
        expect(heartbeatSuccess).toBe(true);

        const refreshed = await repo.getJobById(job.id);
        expect(refreshed?.lastHeartbeatAt).toBeDefined();
        expect(new Date(refreshed!.lockedUntil!).getTime()).toBeGreaterThan(
          new Date(originalLockedUntil!).getTime()
        );
      });
    });

    it('rejects heartbeat if worker is not the current lease holder', async () => {
      await inTenantA(async () => {
        const job = await queue.enqueue({ jobType: 'heartbeat_imposter', payload: {} });
        await queue.claimJob('worker_1', ['default'], 30);

        const imposterHeartbeat = await queue.heartbeat(job.id, 'worker_imposter', 60);
        expect(imposterHeartbeat).toBe(false);
      });
    });
  });

  describe('4. Crash Recovery (Stale Job Recovery)', () => {
    it('recovers jobs whose lease has expired back to pending', async () => {
      await inTenantA(async () => {
        const job = await queue.enqueue({ jobType: 'crashed_worker_job', payload: {} });

        // Worker claims job with 1 second lease
        await queue.claimJob('worker_dead', ['default'], 1);

        // Manually update locked_until to past to simulate crashed worker timeout
        const past = new Date(Date.now() - 5000).toISOString();
        await client.execute(
          `UPDATE async_job_queue SET locked_until = ? WHERE id = ?;`,
          [past, job.id]
        );

        // Run recovery
        const recoveredCount = await queue.recoverStaleJobs();
        expect(recoveredCount).toBe(1);

        const afterRecovery = await repo.getJobById(job.id);
        expect(afterRecovery?.status).toBe('pending');
        expect(afterRecovery?.lockedByWorker).toBeUndefined();

        // New worker can now claim and successfully process it
        const newWorkerClaim = await queue.claimJob('worker_healthy', ['default'], 30);
        expect(newWorkerClaim?.id).toBe(job.id);
        expect(newWorkerClaim?.lockedByWorker).toBe('worker_healthy');
      });
    });
  });

  describe('5. Idempotent Enqueue Deduplication', () => {
    it('returns existing job when enqueued with identical idempotencyKey while pending', async () => {
      await inTenantA(async () => {
        const key = 'idem_payment_confirm_123';
        const job1 = await queue.enqueue({
          jobType: 'capture_payment',
          payload: { orderId: 'ord_123' },
          idempotencyKey: key,
        });

        // Re-enqueue identical request
        const job2 = await queue.enqueue({
          jobType: 'capture_payment',
          payload: { orderId: 'ord_123' },
          idempotencyKey: key,
        });

        expect(job2.id).toBe(job1.id);

        const countRes = await client.query<{ count: number }>(
          `SELECT COUNT(*) as count FROM async_job_queue WHERE idempotency_key = ?;`,
          [key]
        );
        expect(countRes[0].count).toBe(1);
      });
    });

    it('allows re-enqueueing with the same idempotencyKey once prior job is completed', async () => {
      await inTenantA(async () => {
        const key = 'idem_repeatable_task';
        const job1 = await queue.enqueue({
          jobType: 'task',
          payload: {},
          idempotencyKey: key,
        });

        await queue.claimJob('worker_1', ['default']);
        await queue.completeJob(job1.id, { ok: true });

        // Enqueue again after completion (e.g. next cycle)
        const job2 = await queue.enqueue({
          jobType: 'task',
          payload: {},
          idempotencyKey: key,
        });

        expect(job2.id).not.toBe(job1.id);
      });
    });
  });

  describe('6. Quiet Hours Governance', () => {
    it('evaluates quiet hours accurately in given timezone', () => {
      // 23:30 (11:30 PM) is inside quiet hours [21:00 - 09:00]
      const nightTime = new Date('2026-10-02T23:30:00Z');
      const evalNight = QuietHoursGovernor.evaluate(nightTime, { timezone: 'UTC' });
      expect(evalNight.isQuietHours).toBe(true);
      expect(evalNight.nextAllowedRunAt).toBeDefined();

      // 14:00 (2:00 PM) is outside quiet hours
      const dayTime = new Date('2026-10-02T14:00:00Z');
      const evalDay = QuietHoursGovernor.evaluate(dayTime, { timezone: 'UTC' });
      expect(evalDay.isQuietHours).toBe(false);
      expect(evalDay.nextAllowedRunAt).toBeUndefined();
    });

    it('postpones job runAt when quietHoursPolicy is "postpone"', async () => {
      await inTenantA(async () => {
        // Schedule for 23:00 UTC
        const lateNight = new Date('2026-10-02T23:00:00Z');
        const job = await queue.enqueue({
          jobType: 'patient_sms_reminder',
          payload: { text: 'Appointment reminder' },
          runAt: lateNight,
          quietHoursPolicy: 'postpone',
          timezone: 'UTC',
        });

        const scheduledTime = new Date(job.runAt);
        // Should be shifted to 09:00 UTC next morning (2026-10-03T09:00:00.000Z)
        expect(scheduledTime.getUTCHours()).toBe(9);
        expect(scheduledTime.getUTCDate()).toBe(3);
      });
    });

    it('does not postpone when quietHoursPolicy is "none"', async () => {
      await inTenantA(async () => {
        const lateNight = new Date('2026-10-02T23:00:00Z');
        const job = await queue.enqueue({
          jobType: 'system_log_rotate',
          payload: {},
          runAt: lateNight,
          quietHoursPolicy: 'none',
          timezone: 'UTC',
        });

        expect(new Date(job.runAt).toISOString()).toBe(lateNight.toISOString());
      });
    });
  });

  describe('7. Retries with Exponential Backoff & Dead Letter Queue (DLQ)', () => {
    it('retries with exponential backoff on failure before maxRetries', async () => {
      await inTenantA(async () => {
        const job = await queue.enqueue({
          jobType: 'webhook_notify',
          payload: { url: 'https://api.partner.com' },
          maxRetries: 3,
        });

        await queue.claimJob('worker_1', ['default']);

        // First failure -> retry 1
        await queue.failJob(job.id, 'Connection timeout (504)');

        const retry1 = await repo.getJobById(job.id);
        expect(retry1?.status).toBe('pending');
        expect(retry1?.retryCount).toBe(1);
        expect(retry1?.errorMessage).toContain('Connection timeout (504)');
        expect(new Date(retry1!.runAt).getTime()).toBeGreaterThan(Date.now());

        // Fast-forward runAt to now so it can be claimed for attempt 2
        await client.execute(
          `UPDATE async_job_queue SET run_at = ? WHERE id = ?;`,
          [new Date().toISOString(), job.id]
        );

        await queue.claimJob('worker_1', ['default']);
        // Second failure -> retry 2
        await queue.failJob(job.id, 'Connection reset by peer');

        const retry2 = await repo.getJobById(job.id);
        expect(retry2?.status).toBe('pending');
        expect(retry2?.retryCount).toBe(2);
      });
    });

    it('transitions to dead_letter queue upon exhausting maxRetries', async () => {
      await inTenantA(async () => {
        const job = await queue.enqueue({
          jobType: 'unreliable_service',
          payload: {},
          maxRetries: 2,
        });

        // Attempt 1
        await queue.claimJob('worker_1', ['default']);
        await queue.failJob(job.id, 'Attempt 1 failed');

        // Reset run_at to now
        await client.execute(
          `UPDATE async_job_queue SET run_at = ? WHERE id = ?;`,
          [new Date().toISOString(), job.id]
        );

        // Attempt 2 (reaches maxRetries 2)
        await queue.claimJob('worker_1', ['default']);
        await queue.failJob(job.id, 'Attempt 2 fatal failure');

        const deadJob = await repo.getJobById(job.id);
        expect(deadJob?.status).toBe('dead_letter');
        expect(deadJob?.retryCount).toBe(2);
        expect(deadJob?.errorMessage).toContain('Max retries (2) exhausted');
      });
    });
  });

  describe('8. Dead Letter Queue Operations', () => {
    it('supports explicit deadLetterJob and retryDeadLetterJob resuscitation', async () => {
      await inTenantA(async () => {
        const job = await queue.enqueue({ jobType: 'malformed_payload', payload: {} });
        await queue.claimJob('worker_1', ['default']);

        // Explicit DLQ routing (e.g. fatal validation failure)
        await queue.deadLetterJob(job.id, 'Invalid JSON schema in payload', 10);

        const inDlq = await repo.getJobById(job.id);
        expect(inDlq?.status).toBe('dead_letter');
        expect(inDlq?.errorMessage).toBe('Invalid JSON schema in payload');
        expect(inDlq?.executionDurationMs).toBe(10);

        // Operator reviews and resuscitates job from DLQ
        const retryResult = await queue.retryDeadLetterJob(job.id);
        expect(retryResult.status).toBe('pending');

        const revived = await repo.getJobById(job.id);
        expect(revived?.status).toBe('pending');
        expect(revived?.retryCount).toBe(0);
        expect(revived?.errorMessage).toBeUndefined();

        // Worker can now claim the revived job
        const claimed = await queue.claimJob('worker_1', ['default']);
        expect(claimed?.id).toBe(job.id);
      });
    });
  });

  describe('9. JobWorker Engine', () => {
    it('executes registered handlers, maintains lease heartbeats, and completes job', async () => {
      await inTenantA(async () => {
        let executedPayload: any = null;
        let handlerHeartbeatCalled = false;

        const worker = new JobWorker(queue, {
          workerId: 'test_worker_1',
          queues: ['high', 'default'],
          concurrency: 2,
          lockDurationSeconds: 10,
          heartbeatIntervalMs: 50,
        });

        worker.registerHandler('send_notification', async (job, ctx) => {
          executedPayload = job.payload;
          const hbOk = await ctx.heartbeat();
          if (hbOk) handlerHeartbeatCalled = true;
          return { sent: true, recipient: job.payload.email };
        });

        const job = await queue.enqueue({
          jobType: 'send_notification',
          payload: { email: 'alice@example.com' },
          queueName: 'high',
        });

        // Trigger single execution step
        const step = await worker.processNext();
        expect(step.processed).toBe(true);
        expect(step.job).toBeDefined();

        expect(executedPayload).toEqual({ email: 'alice@example.com' });
        expect(handlerHeartbeatCalled).toBe(true);

        const completedJob = await repo.getJobById(job.id);
        expect(completedJob?.status).toBe('completed');
        expect(completedJob?.result).toEqual({ sent: true, recipient: 'alice@example.com' });
        expect(completedJob?.executionDurationMs).toBeGreaterThanOrEqual(0);
      });
    });

    it('automatically fails and retries jobs when handler throws an error', async () => {
      await inTenantA(async () => {
        const worker = new JobWorker(queue, {
          workerId: 'test_worker_failing',
          queues: ['default'],
        });

        worker.registerHandler('throw_error', async () => {
          throw new Error('Database connection dropped during write');
        });

        const job = await queue.enqueue({
          jobType: 'throw_error',
          payload: {},
          maxRetries: 3,
        });

        const step = await worker.processNext();
        expect(step.processed).toBe(true);
        expect(step.error?.message).toContain('Database connection dropped');

        const failedJob = await repo.getJobById(job.id);
        expect(failedJob?.status).toBe('pending'); // Scheduled for retry
        expect(failedJob?.retryCount).toBe(1);
        expect(failedJob?.errorMessage).toContain('Database connection dropped');
      });
    });

    it('gracefully stops worker and respects active job cancellation', async () => {
      await inTenantA(async () => {
        const worker = new JobWorker(queue, {
          workerId: 'test_worker_stopping',
          queues: ['default'],
        });

        let aborted = false;
        worker.registerHandler('long_running', async (job, ctx) => {
          return new Promise((resolve) => {
            ctx.signal.addEventListener('abort', () => {
              aborted = true;
              resolve({ aborted: true });
            });
            setTimeout(() => resolve({ aborted: false }), 2000);
          });
        });

        await queue.enqueue({ jobType: 'long_running', payload: {} });

        // Start processing in background
        const procPromise = worker.processNext();

        // Give it time to enter the handler
        await new Promise((res) => setTimeout(res, 50));
        expect(worker.getActiveJobsCount()).toBe(1);

        // Trigger graceful shutdown
        await worker.stop(500);

        await procPromise;
        expect(aborted).toBe(true);
        expect(worker.getActiveJobsCount()).toBe(0);
      });
    });
  });

  describe('10. Multi-Tenant Queue Isolation & Metrics', () => {
    it('isolates job claiming between distinct tenants', async () => {
      // Tenant A enqueues job
      let jobAId = '';
      await inTenantA(async () => {
        const jobA = await queue.enqueue({ jobType: 'tenant_a_job', payload: { secret: 'alpha' } });
        jobAId = jobA.id;
      });

      // Tenant B enqueues job
      let jobBId = '';
      await inTenantB(async () => {
        const jobB = await queue.enqueue({ jobType: 'tenant_b_job', payload: { secret: 'beta' } });
        jobBId = jobB.id;
      });

      // Claim scoped to Tenant A -> cannot see Tenant B's job
      await inTenantA(async () => {
        const claimA = await queue.claimJob('worker_alpha', ['default'], 30, tenantA);
        expect(claimA?.id).toBe(jobAId);

        // No more jobs for Tenant A
        const claimAEmpty = await queue.claimJob('worker_alpha', ['default'], 30, tenantA);
        expect(claimAEmpty).toBeNull();
      });

      // Claim scoped to Tenant B -> gets Tenant B's job
      await inTenantB(async () => {
        const claimB = await queue.claimJob('worker_beta', ['default'], 30, tenantB);
        expect(claimB?.id).toBe(jobBId);
      });
    });

    it('reports segregated queue metrics per tenant', async () => {
      await inTenantA(async () => {
        await queue.enqueue({ jobType: 'task_1', queueName: 'default', payload: {} });
        await queue.enqueue({ jobType: 'task_2', queueName: 'high', payload: {} });
      });

      await inTenantB(async () => {
        await queue.enqueue({ jobType: 'task_3', queueName: 'default', payload: {} });
      });

      const metricsA = await queue.getMetrics(tenantA);
      expect(metricsA['default']?.['pending']).toBe(1);
      expect(metricsA['high']?.['pending']).toBe(1);

      const metricsB = await queue.getMetrics(tenantB);
      expect(metricsB['default']?.['pending']).toBe(1);
      expect(metricsB['high']).toBeUndefined();

      const globalMetrics = await queue.getMetrics();
      expect(globalMetrics['default']?.['pending']).toBe(2);
      expect(globalMetrics['high']?.['pending']).toBe(1);
    });
  });
});
