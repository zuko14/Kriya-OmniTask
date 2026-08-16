/**
 * Xylarc AI — Reliability Engineering Types & Contracts
 * Strict enterprise lifecycle states, idempotency models, DLQ, and dependency resilience contracts.
 */

import { z } from 'zod';

export type OperationLifecycleState =
  | 'pending'
  | 'running'
  | 'verifying'
  | 'completed'
  | 'partially_completed'
  | 'failed'
  | 'retrying'
  | 'failed_permanently'
  | 'cancelled'
  | 'timed_out'
  | 'blocked'
  | 'requires_approval'
  | 'escalated';

export type IdempotencyStatus = 'in_progress' | 'completed' | 'failed';

export type DeadLetterStatus = 'pending_review' | 'retrying' | 'discarded' | 'resolved';

export type DependencyHealthState = 'healthy' | 'degraded' | 'unhealthy' | 'circuit_broken';

export interface IdempotencyRecord {
  id: string;
  tenantId: string;
  organizationId: string;
  idempotencyKey: string;
  resourceType: string;
  requestHash: string;
  responsePayload: string | null;
  status: IdempotencyStatus;
  createdAt: string;
  expiresAt: string;
}

export interface DeadLetterJob {
  id: string;
  tenantId: string;
  organizationId: string;
  jobType: string;
  payload: Record<string, unknown>;
  failureReason: string;
  errorStack?: string | null;
  retryCount: number;
  maxRetries: number;
  status: DeadLetterStatus;
  createdAt: string;
  updatedAt: string;
}

export interface DependencyHealth {
  id: string;
  tenantId: string;
  dependencyName: string;
  state: DependencyHealthState;
  consecutiveFailures: number;
  failureRate: number;
  latencyP95Ms: number;
  lastProbeAt: string;
  updatedAt: string;
}

export interface OperationRecoveryCheckpoint {
  id: string;
  tenantId: string;
  organizationId: string;
  operationId: string;
  operationType: string;
  lifecycleState: OperationLifecycleState;
  checkpointState: Record<string, unknown>;
  compensationAction?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export const IdempotentExecuteRequestSchema = z.object({
  idempotencyKey: z.string().min(1),
  resourceType: z.string().min(1),
  payload: z.record(z.unknown()),
  ttlSeconds: z.number().int().positive().default(86400),
});

export type IdempotentExecuteRequest = z.infer<typeof IdempotentExecuteRequestSchema>;

export const UpdateDependencyHealthRequestSchema = z.object({
  dependencyName: z.string().min(1),
  isSuccess: z.boolean(),
  latencyMs: z.number().nonnegative(),
});

export type UpdateDependencyHealthRequest = z.infer<typeof UpdateDependencyHealthRequestSchema>;
