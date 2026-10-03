/**
 * Kriya AI — Verification Job Service
 * Orchestrates async read-back verification polling, verification execution, and mismatch escalation (§14 of CLAUDE.md, docs/kriya WP-4.6, WP-3.4).
 */

import { z } from 'zod';
import { DatabaseClient } from '../../storage/db.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import {
  VerificationJobRecord,
  CreateVerificationJobInput,
  CreateVerificationJobSchema,
} from '../types/attentionTypes.js';
import { VerificationJobRepository } from '../repositories/verificationJobRepository.js';
import { AttentionService } from './attentionService.js';
import { ToolRegistryService, RegisteredTool, ToolExecutionContext } from '../../tools/registry/toolRegistry.js';
import { CredentialVault } from '../../tools/vault/credentialVault.js';
import { NotFoundError } from '../../core/errors/errors.js';
import { logger } from '../../core/logger/logger.js';
import { TraceRepository } from '../../observability/repositories/traceRepository.js';
import { SemanticAttributes } from '../../observability/types/observabilityTypes.js';

export class VerificationJobService {
  private repo: VerificationJobRepository;
  private attention: AttentionService;
  private registry: ToolRegistryService;
  private traceRepo: TraceRepository;

  constructor(
    private readonly client?: DatabaseClient,
    registry?: ToolRegistryService,
    attention?: AttentionService,
    repo?: VerificationJobRepository,
    traceRepo?: TraceRepository
  ) {
    this.repo = repo || new VerificationJobRepository(client);
    this.attention = attention || new AttentionService(client);
    this.registry = registry || new ToolRegistryService();
    this.traceRepo = traceRepo || new TraceRepository(client);
  }

  /**
   * Enqueues an async verification job.
   */
  public async createJob(input: CreateVerificationJobInput): Promise<VerificationJobRecord> {
    return this.repo.createJob(input);
  }

  /**
   * Polls pending jobs due for verification.
   */
  public async pollPending(now = new Date(), limit = 20): Promise<VerificationJobRecord[]> {
    return this.repo.findPendingJobs(now, limit);
  }

  /**
   * Executes read-back verification for a specific job.
   */
  public async processJob(jobId: string, now = new Date()): Promise<VerificationJobRecord> {
    const job = await this.repo.findById(jobId);
    if (!job) throw new NotFoundError(`Verification job '${jobId}' not found.`);

    if (job.status !== 'pending') {
      return job;
    }

    const tenantId = TenantContextManager.getTenantId();
    let actionInput: Record<string, unknown> = {};
    let actionOutput: Record<string, unknown> = {};

    try {
      actionInput = JSON.parse(job.action_input_json || '{}');
      actionOutput = JSON.parse(job.action_output_json || '{}');
    } catch (err) {
      const errorMsg = `Corrupted job payload JSON: ${(err as Error).message}`;
      await this.repo.markMismatch(job.id, {}, errorMsg);
      await this.escalateFailure(job, 'security_anomaly', `Action verification payload parse error: ${errorMsg}`);
      return (await this.repo.findById(jobId))!;
    }

    const tool = this.registry.getTool(job.tool_slug);
    if (!tool || !tool.verify) {
      const errorMsg = `Tool '${job.tool_slug}' has no read-back verify() method configured.`;
      await this.repo.markMismatch(job.id, {}, errorMsg);
      await this.escalateFailure(job, 'security_anomaly', errorMsg);
      return (await this.repo.findById(jobId))!;
    }

    const ctx: ToolExecutionContext = {
      tenantId,
      agentId: 'specialist.verification',
      correlationId: job.run_id,
      idempotencyKey: job.idempotency_key,
      vault: new CredentialVault(),
    };

    try {
      const verification = await tool.verify(actionInput, actionOutput, ctx);

      if (job.run_id) {
        try {
          const trace = await this.traceRepo.findTraceByCorrelationOrId(job.run_id);
          if (trace) {
            await this.traceRepo.addSpan({
              traceId: trace.id,
              spanName: `verification:${job.tool_slug}`,
              agentId: 'specialist.verification',
              stepType: 'verification',
              status: verification.state === 'verified' ? 'completed' : 'error',
              latencyMs: 15,
              inputSummary: `Read-back verification for ${job.tool_slug} on job ${job.id}`,
              outputSummary: `Verification state: ${verification.state}`,
              attributes: {
                [SemanticAttributes.VERIFICATION_JOB_ID]: job.id,
                [SemanticAttributes.VERIFICATION_STATE]: verification.state,
                'verification.system': tool.definition.name || job.tool_slug,
                'verification.passed': verification.state === 'verified',
                'verification.details': verification.observed,
              },
            });
          }
        } catch (traceErr) {
          logger.warn(`VerificationJobService: could not record verification span for job ${job.id}`, { traceErr });
        }
      }

      if (verification.state === 'verified') {
        const updated = await this.repo.markVerified(job.id, verification.observed ?? {});
        logger.info(`[VERIFICATION SUCCESS] Job '${job.id}' verified for tool '${job.tool_slug}'`);
        return updated;
      }

      if (verification.state === 'mismatch') {
        const errorMsg = 'External system state contradicts recorded action output.';
        const updated = await this.repo.markMismatch(job.id, verification.observed ?? {}, errorMsg);
        await this.escalateFailure(job, 'security_anomaly', `Action verification mismatch: ${errorMsg}`);
        return updated;
      }

      // Verification state is 'pending'
      const deadline = new Date(job.deadline_at);
      const isExpired = now.getTime() >= deadline.getTime() || job.attempts + 1 >= job.max_attempts;

      if (isExpired) {
        const errorMsg = `Verification deadline expired (${job.attempts + 1} attempts made).`;
        const updated = await this.repo.markExpired(job.id, errorMsg);
        await this.escalateFailure(job, 'workflow_suspended', errorMsg);
        return updated;
      }

      // Schedule next check with linear backoff (interval * (attempts + 1))
      const backoffSeconds = 30 * (job.attempts + 1);
      const nextCheckAt = new Date(now.getTime() + backoffSeconds * 1000).toISOString();
      return this.repo.recordFailedAttempt(job.id, nextCheckAt, 'External system status still pending.');
    } catch (err) {
      const errorMsg = `Verification execution threw exception: ${(err as Error).message}`;
      logger.error(`[VERIFICATION ERROR] Job '${job.id}' error: ${errorMsg}`);

      const deadline = new Date(job.deadline_at);
      const isExpired = now.getTime() >= deadline.getTime() || job.attempts + 1 >= job.max_attempts;

      if (isExpired) {
        const updated = await this.repo.markExpired(job.id, errorMsg);
        await this.escalateFailure(job, 'workflow_suspended', errorMsg);
        return updated;
      }

      const nextCheckAt = new Date(now.getTime() + 60 * 1000).toISOString();
      return this.repo.recordFailedAttempt(job.id, nextCheckAt, errorMsg);
    }
  }

  /**
   * Processes a batch of due pending verification jobs.
   */
  public async processPendingBatch(now = new Date(), limit = 20): Promise<VerificationJobRecord[]> {
    const pending = await this.pollPending(now, limit);
    const results: VerificationJobRecord[] = [];
    for (const job of pending) {
      const res = await this.processJob(job.id, now);
      results.push(res);
    }
    return results;
  }

  /**
   * Evaluates the verification health of a run.
   */
  public async getRunVerificationStatus(runId: string): Promise<{
    allVerified: boolean;
    pendingCount: number;
    mismatchCount: number;
    expiredCount: number;
    jobs: VerificationJobRecord[];
  }> {
    const jobs = await this.repo.findByRunId(runId);
    const pendingCount = jobs.filter((j) => j.status === 'pending').length;
    const mismatchCount = jobs.filter((j) => j.status === 'mismatch').length;
    const expiredCount = jobs.filter((j) => j.status === 'expired').length;
    const allVerified = jobs.length > 0 && jobs.every((j) => j.status === 'verified');

    return {
      allVerified,
      pendingCount,
      mismatchCount,
      expiredCount,
      jobs,
    };
  }

  /**
   * Escalate verification failure (mismatch or expired) to human attention center.
   */
  private async escalateFailure(
    job: VerificationJobRecord,
    category: 'security_anomaly' | 'workflow_suspended',
    description: string
  ): Promise<void> {
    await this.attention.escalateOnce({
      correlationId: `verification:${job.id}`,
      traceId: job.run_id,
      channel: 'internal',
      sourceAgentId: 'specialist.verification',
      title: `Verification Failed for tool '${job.tool_slug}'`,
      description,
      reasonCategory: category,
      priority: 'P1_HIGH',
      contextData: {
        jobId: job.id,
        runId: job.run_id,
        toolSlug: job.tool_slug,
        idempotencyKey: job.idempotency_key,
        attempts: job.attempts,
        deadlineAt: job.deadline_at,
      },
      recommendedAction: 'Inspect external system of record and re-verify or manually reconcile transaction.',
    });
  }
}

/**
 * Factory for Verification specialist tools.
 */
export function verificationTools(
  serviceFactory: () => VerificationJobService = () => new VerificationJobService()
): RegisteredTool[] {
  return [
    {
      definition: {
        slug: 'verification_create_job',
        name: 'Verification Create Job',
        description: 'Enqueues an asynchronous read-back verification job for an external action.',
        category: 'custom',
        riskTier: 'LOW',
        requiresApproval: false,
        inputSchema: {
          runId: 'string',
          toolSlug: 'string',
          actionInput: 'object',
          actionOutput: 'object',
          idempotencyKey: 'string',
          maxAttempts: 'number (optional, default 5)',
          deadlineMinutes: 'number (optional, default 60)',
        },
        outputSchema: { job: 'VerificationJobRecord' },
        isSystem: true,
      },
      inputValidator: CreateVerificationJobSchema,
      handler: async (input) => {
        const service = serviceFactory();
        const job = await service.createJob(input as any);
        return { job: job as unknown as Record<string, unknown> };
      },
    },
    {
      definition: {
        slug: 'verification_poll_jobs',
        name: 'Verification Poll Jobs',
        description: 'Polls pending verification jobs that are due for read-back verification.',
        category: 'custom',
        riskTier: 'LOW',
        requiresApproval: false,
        inputSchema: { limit: 'number (optional, default 20)' },
        outputSchema: { jobs: 'VerificationJobRecord[]' },
        isSystem: true,
      },
      inputValidator: z.object({ limit: z.number().int().min(1).max(100).default(20) }),
      handler: async (input) => {
        const service = serviceFactory();
        const jobs = await service.pollPending(new Date(), (input.limit as number) || 20);
        return { jobs: jobs as unknown as Record<string, unknown> };
      },
    },
    {
      definition: {
        slug: 'verification_run_job',
        name: 'Verification Run Job',
        description: 'Executes read-back verification for a specific verification job.',
        category: 'custom',
        riskTier: 'LOW',
        requiresApproval: false,
        inputSchema: { jobId: 'string' },
        outputSchema: { job: 'VerificationJobRecord' },
        isSystem: true,
      },
      inputValidator: z.object({ jobId: z.string().min(1) }),
      handler: async (input) => {
        const service = serviceFactory();
        const job = await service.processJob(input.jobId as string);
        return { job: job as unknown as Record<string, unknown> };
      },
    },
    {
      definition: {
        slug: 'verification_check_run',
        name: 'Verification Check Run',
        description: 'Returns the status and health of all verification jobs for a run.',
        category: 'custom',
        riskTier: 'LOW',
        requiresApproval: false,
        inputSchema: { runId: 'string' },
        outputSchema: {
          allVerified: 'boolean',
          pendingCount: 'number',
          mismatchCount: 'number',
          expiredCount: 'number',
          jobs: 'VerificationJobRecord[]',
        },
        isSystem: true,
      },
      inputValidator: z.object({ runId: z.string().min(1) }),
      handler: async (input) => {
        const service = serviceFactory();
        const status = await service.getRunVerificationStatus(input.runId as string);
        return status as unknown as Record<string, unknown>;
      },
    },
  ];
}
