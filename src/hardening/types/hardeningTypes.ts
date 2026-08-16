/**
 * Xylarc AI — Production Hardening, Chaos & Red-Team Audit Type Definitions
 * Typed contracts for multi-tenant concurrency stress testing, chaos injection, red-team auditing, and production readiness certification.
 */

import { z } from 'zod';

export type ChaosFaultType = 'latency' | 'network_error' | 'db_pool_exhaustion' | 'rate_limit';
export type HardeningStatus = 'passed' | 'failed';
export type ReadinessCheckStatus = 'passed' | 'warning' | 'failed';
export type ProductionVerdict = 'PRODUCTION_READY' | 'CONDITIONAL_APPROVAL' | 'RELEASE_BLOCKED';

export interface StressRunRecord {
  id: string;
  runName: string;
  concurrencyLevel: number;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  throughputRps: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  crossTenantLeakageDetected: boolean;
  createdAt: string;
}

export interface ChaosExperimentRecord {
  id: string;
  experimentName: string;
  faultType: ChaosFaultType;
  injectedCount: number;
  survivedCount: number;
  recoveryTimeMs: number;
  status: HardeningStatus;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface RedTeamProbeResult {
  probeName: string;
  attackVector: string;
  blocked: boolean;
  payload: string;
  responseStatus: number;
  evidence: string;
}

export interface RedTeamAuditRecord {
  id: string;
  auditName: string;
  totalProbes: number;
  attacksBlocked: number;
  vulnerabilitiesFound: number;
  threatScore: number;
  status: HardeningStatus;
  findings: RedTeamProbeResult[];
  createdAt: string;
}

export interface ProductionReadinessCheck {
  id: string;
  checkCategory: string;
  checkName: string;
  status: ReadinessCheckStatus;
  evidence: string;
  evaluatedAt: string;
}

export interface ProductionReadinessCertificate {
  certificateId: string;
  systemVersion: string;
  overallVerdict: ProductionVerdict;
  readinessScorePct: number;
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  timestamp: string;
  checks: ProductionReadinessCheck[];
}

export const RunStressTestSchema = z.object({
  runName: z.string().min(1).default('Standard Multi-Tenant Stress Benchmark'),
  concurrency: z.number().int().min(1).max(200).default(20),
  requestsPerWorker: z.number().int().min(1).max(100).default(10),
  tenantCount: z.number().int().min(1).max(50).default(5),
});

export const RunChaosExperimentSchema = z.object({
  experimentName: z.string().min(1),
  faultType: z.enum(['latency', 'network_error', 'db_pool_exhaustion', 'rate_limit']),
  faultProbability: z.number().min(0.01).max(1.0).default(0.5),
  iterations: z.number().int().min(1).max(100).default(20),
});

export const RunRedTeamAuditSchema = z.object({
  auditName: z.string().min(1).default('Comprehensive Adversarial Red-Team Scan'),
});
