/**
 * Xylarc AI — Production Infrastructure Types & Contracts
 * Definitions for worker queues, connection pool metrics, scheduled jobs, and secret audits.
 */

import { z } from 'zod';

export type JobQueueName = 'high' | 'default' | 'low' | 'batch';
export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'dead_letter';

export const AsyncJobSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  queueName: z.enum(['high', 'default', 'low', 'batch']).default('default'),
  jobType: z.string(),
  payload: z.record(z.string(), z.any()),
  priority: z.number().int().min(1).max(100).default(50),
  status: z.enum(['pending', 'running', 'completed', 'failed', 'dead_letter']).default('pending'),
  maxRetries: z.number().int().nonnegative().default(3),
  retryCount: z.number().int().nonnegative().default(0),
  runAt: z.string(),
  lockedByWorker: z.string().optional(),
  lockedUntil: z.string().optional(),
  errorMessage: z.string().optional(),
  result: z.record(z.string(), z.any()).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AsyncJob = z.infer<typeof AsyncJobSchema>;

export const ScheduledJobSchema = z.object({
  id: z.string(),
  name: z.string(),
  cronExpression: z.string(),
  jobType: z.string(),
  isActive: z.boolean().default(true),
  lastRunAt: z.string().optional(),
  nextRunAt: z.string().optional(),
  lastStatus: z.enum(['success', 'failure', 'skipped']).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ScheduledJob = z.infer<typeof ScheduledJobSchema>;

export interface ConnectionPoolStats {
  totalConnections: number;
  activeConnections: number;
  idleConnections: number;
  maxConnections: number;
  waitingRequests: number;
  utilizationPct: number;
  status: 'healthy' | 'warning' | 'exhausted';
  timestamp: string;
}

export interface SecretAuditItem {
  keyName: string;
  location: string;
  entropyScore: number;
  isMasked: boolean;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  vulnerability: string;
  recommendation: string;
}

export interface SecretAuditReport {
  id: string;
  scanType: 'config_env' | 'database_credentials' | 'agent_tokens';
  secretsScannedCount: number;
  vulnerabilitiesFoundCount: number;
  findings: SecretAuditItem[];
  scannedAt: string;
}
