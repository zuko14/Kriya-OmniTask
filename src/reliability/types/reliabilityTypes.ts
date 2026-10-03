/**
 * Kriya AI — Reliability Engineering Types & Contracts
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

// --- WP-8.4: Reliability Drills, Failover Runbooks, and PITR Types ---

export type ReliabilityDrillFaultType =
  | 'network_drop_retry'
  | 'llm_rate_limit_fallback'
  | 'db_pool_exhaustion'
  | 'worker_queue_crash'
  | 'latency_spike';

export type ReliabilityDrillStatus = 'passed' | 'failed' | 'aborted';

export interface ReliabilityDrillRun {
  id: string;
  tenantId: string;
  drillName: string;
  faultType: ReliabilityDrillFaultType;
  environment: string;
  status: ReliabilityDrillStatus;
  injectedCount: number;
  survivedCount: number;
  recoveryTimeMs: number;
  details: Record<string, unknown>;
  createdAt: string;
}

export type PitrSnapshotType = 'full' | 'incremental' | 'wal_checkpoint';
export type PitrSnapshotStatus = 'completed' | 'corrupted' | 'pending';

export interface PitrSnapshot {
  id: string;
  tenantId: string;
  snapshotName: string;
  snapshotType: PitrSnapshotType;
  checksumSha256: string;
  recordCounts: Record<string, number>;
  metadata: Record<string, unknown>;
  dataPayload?: string | null;
  status: PitrSnapshotStatus;
  createdAt: string;
}

export type PitrRestoreStatus = 'completed' | 'verified' | 'failed' | 'in_progress';

export interface PitrRestoreOperation {
  id: string;
  tenantId: string;
  snapshotId: string;
  targetTimestamp: string;
  status: PitrRestoreStatus;
  restoredRecordsCount: number;
  verified: boolean;
  errorMessage?: string | null;
  executedAt: string;
  createdAt: string;
}

export interface FailoverStep {
  stepName: string;
  status: 'success' | 'failed';
  durationMs: number;
  details?: Record<string, unknown>;
}

export interface FailoverDrillResult {
  id: string;
  tenantId: string;
  drillName: string;
  primaryNodeId: string;
  promotedReplicaId: string;
  status: 'completed' | 'failed';
  failoverTimeMs: number;
  steps: FailoverStep[];
  createdAt: string;
}

export interface NodeHealthStatus {
  nodeId: string;
  role: 'primary' | 'read_replica' | 'standby';
  health: 'healthy' | 'degraded' | 'unreachable';
  replicationLagMs: number;
  lastHeartbeat: string;
}

export const RunReliabilityDrillRequestSchema = z.object({
  drillName: z.string().min(1),
  faultType: z.enum([
    'network_drop_retry',
    'llm_rate_limit_fallback',
    'db_pool_exhaustion',
    'worker_queue_crash',
    'latency_spike',
  ]),
  faultProbability: z.number().min(0).max(1).default(0.5),
  iterations: z.number().int().min(1).max(100).default(20),
});

export type RunReliabilityDrillRequest = z.input<typeof RunReliabilityDrillRequestSchema>;

export const CreatePitrSnapshotRequestSchema = z.object({
  snapshotName: z.string().min(1),
  snapshotType: z.enum(['full', 'incremental', 'wal_checkpoint']).default('full'),
  tables: z.array(z.string()).optional(),
});

export type CreatePitrSnapshotRequest = z.input<typeof CreatePitrSnapshotRequestSchema>;

export const RestorePitrRequestSchema = z.object({
  snapshotId: z.string().min(1),
  targetTimestamp: z.string().optional(),
  verifyIntegrityOnly: z.boolean().default(false),
});

export type RestorePitrRequest = z.input<typeof RestorePitrRequestSchema>;

export const SimulateFailoverRequestSchema = z.object({
  drillName: z.string().min(1).default('Automated Database Primary Failover Drill'),
  primaryNodeId: z.string().default('pg-node-primary-01'),
  targetReplicaId: z.string().default('pg-node-replica-01'),
  simulateReplicationLagMs: z.number().min(0).default(12),
});

export type SimulateFailoverRequest = z.input<typeof SimulateFailoverRequestSchema>;

