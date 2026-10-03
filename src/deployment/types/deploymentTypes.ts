/**
 * Kriya AI — Deployment & Release Engineering Type Definitions
 * Typed contracts for CI/CD gates, Expand-Migrate-Contract schemas, canary rollouts, and feature flags.
 */

import { z } from 'zod';

export type DeploymentEnvironment = 'staging' | 'production' | 'canary';
export type DeploymentStatus = 'pending' | 'canary' | 'promoted' | 'rolled_back';
export type DeploymentGateVerdict = 'approved' | 'blocked' | 'conditional';
export type SchemaTransitionPhase = 'expand' | 'migrate' | 'contract';
export type SchemaTransitionStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface ReleaseDeployment {
  id: string;
  versionTag: string;
  environment: DeploymentEnvironment;
  status: DeploymentStatus;
  canaryWeightPct: number;
  gateVerdict: DeploymentGateVerdict;
  gateDetails: Record<string, unknown>;
  deployedBy: string;
  createdAt: string;
  promotedAt?: string;
  rolledBackAt?: string;
}

export interface FeatureFlag {
  id: string;
  flagKey: string;
  name: string;
  description?: string;
  isEnabled: boolean;
  allowedTenants: string[];
  allowedRoles: string[];
  rolloutPct: number;
  createdAt: string;
  updatedAt: string;
}

export interface FeatureFlagContext {
  tenantId?: string;
  userId?: string;
  roles?: string[];
}

export interface SchemaTransition {
  id: string;
  tableName: string;
  version: string;
  phase: SchemaTransitionPhase;
  status: SchemaTransitionStatus;
  details: Record<string, unknown>;
  createdAt: string;
  completedAt?: string;
}

export interface GateEvaluationInput {
  testPassRate: number; // 0.0 to 1.0 (e.g. 0.99 for 99%)
  semanticDriftScore: number; // 0.0 to 1.0 (e.g. 0.02 for 2%)
  criticalSecurityVulnerabilitiesCount: number;
  p95LatencyMs: number;
  p95LatencyBudgetMs: number;
}

export interface GateCheckResult {
  checkName: string;
  passed: boolean;
  message: string;
}

export interface GateEvaluationOutput {
  verdict: DeploymentGateVerdict;
  scorePct: number;
  checks: GateCheckResult[];
  notes: string[];
}

export const CreateDeploymentSchema = z.object({
  versionTag: z.string().min(1),
  environment: z.enum(['staging', 'production', 'canary']).default('production'),
  deployedBy: z.string().min(1),
});

export const UpdateCanaryWeightSchema = z.object({
  canaryWeightPct: z.number().int().min(0).max(100),
});

export const CreateFeatureFlagSchema = z.object({
  flagKey: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  isEnabled: z.boolean().default(false),
  allowedTenants: z.array(z.string()).default([]),
  allowedRoles: z.array(z.string()).default([]),
  rolloutPct: z.number().int().min(0).max(100).default(0),
});

export const TriggerSchemaTransitionSchema = z.object({
  tableName: z.string().min(1),
  version: z.string().min(1),
  phase: z.enum(['expand', 'migrate', 'contract']),
  details: z.record(z.unknown()).default({}),
});

// ============================================================================
// WP-8.5: API Versioning, Canary Routing, Rollback & Data Residency Types
// ============================================================================

export type ApiVersionStatus = 'active' | 'deprecated' | 'sunset';

export interface ApiVersionRegistration {
  id: string;
  apiVersion: string;
  status: ApiVersionStatus;
  minSupportedClientVersion: string;
  deprecatedAt?: string;
  sunsetAt?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CanaryRoutingConfig {
  id: string;
  deploymentId: string;
  trafficWeightPct: number;
  routingStrategy: 'tenant_hash' | 'user_hash' | 'random';
  evaluationIntervalSeconds: number;
  errorRateThresholdPct: number;
  p99LatencyThresholdMs: number;
  consecutiveHealthyEvaluations: number;
  consecutiveUnhealthyEvaluations: number;
  status: 'active' | 'paused' | 'completed' | 'rolled_back';
  createdAt: string;
  updatedAt: string;
}

export interface CanaryTelemetrySnapshot {
  id: string;
  deploymentId: string;
  sampleWindowSeconds: number;
  totalRequests: number;
  errorCount: number;
  errorRatePct: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  verdict: 'healthy' | 'warning' | 'critical';
  actionTaken: 'advance' | 'hold' | 'rollback';
  reason?: string;
  evaluatedAt: string;
}

export interface DeploymentRollbackEvent {
  id: string;
  deploymentId: string;
  rollbackType: 'automated_telemetry' | 'manual_operator' | 'circuit_breaker';
  triggerReason: string;
  previousWeightPct: number;
  targetWeightPct: number;
  proofReceiptId?: string;
  attentionItemId?: string;
  executedBy: string;
  createdAt: string;
}

export type ResidencyJurisdiction = 'IN_DPDP_2023' | 'EU_GDPR' | 'US_HIPAA' | 'GLOBAL';
export type HostingRegion = 'ap-south-1' | 'ap-south-2' | 'in-central1' | 'me-central2' | 'us-east-1';

export interface DataResidencyConfig {
  id: string;
  tenantId: string;
  jurisdiction: ResidencyJurisdiction;
  primaryRegion: HostingRegion;
  allowedRegions: string[];
  strictDataLocalization: boolean;
  crossBorderTransferPermitted: boolean;
  approvedLlmInferenceRegions: string[];
  createdAt: string;
  updatedAt: string;
}

export interface RollbackExecutionResult {
  deployment: ReleaseDeployment;
  rollbackEvent: DeploymentRollbackEvent;
  proofReceiptId?: string;
  attentionItemId?: string;
  success: boolean;
  message: string;
}

// Zod Schemas for Validation
export const RegisterApiVersionSchema = z.object({
  apiVersion: z.string().min(1),
  status: z.enum(['active', 'deprecated', 'sunset']).default('active'),
  minSupportedClientVersion: z.string().min(1),
  deprecatedAt: z.string().datetime().optional(),
  sunsetAt: z.string().datetime().optional(),
  notes: z.string().optional(),
});
export type RegisterApiVersionInput = z.infer<typeof RegisterApiVersionSchema>;

export const ConfigureCanaryRoutingSchema = z.object({
  deploymentId: z.string().min(1),
  trafficWeightPct: z.number().int().min(0).max(100).default(0),
  routingStrategy: z.enum(['tenant_hash', 'user_hash', 'random']).default('tenant_hash'),
  evaluationIntervalSeconds: z.number().int().positive().default(60),
  errorRateThresholdPct: z.number().positive().default(1.0),
  p99LatencyThresholdMs: z.number().int().positive().default(1500),
});
export type ConfigureCanaryRoutingInput = z.infer<typeof ConfigureCanaryRoutingSchema>;

export const IngestCanaryTelemetrySchema = z.object({
  deploymentId: z.string().min(1),
  sampleWindowSeconds: z.number().int().positive().default(60),
  totalRequests: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative(),
  p95LatencyMs: z.number().nonnegative(),
  p99LatencyMs: z.number().nonnegative(),
});
export type IngestCanaryTelemetryInput = z.infer<typeof IngestCanaryTelemetrySchema>;

export const ExecuteRollbackSchema = z.object({
  rollbackType: z.enum(['automated_telemetry', 'manual_operator', 'circuit_breaker']).default('manual_operator'),
  reason: z.string().min(5),
  executedBy: z.string().min(1),
});
export type ExecuteRollbackInput = z.infer<typeof ExecuteRollbackSchema>;

export const UpsertDataResidencySchema = z.object({
  jurisdiction: z.enum(['IN_DPDP_2023', 'EU_GDPR', 'US_HIPAA', 'GLOBAL']).default('IN_DPDP_2023'),
  primaryRegion: z.enum(['ap-south-1', 'ap-south-2', 'in-central1', 'me-central2', 'us-east-1']).default('ap-south-1'),
  allowedRegions: z.array(z.string()).min(1).default(['ap-south-1']),
  strictDataLocalization: z.boolean().default(true),
  crossBorderTransferPermitted: z.boolean().default(false),
  approvedLlmInferenceRegions: z.array(z.string()).min(1).default(['ap-south-1']),
});
export type UpsertDataResidencyInput = z.infer<typeof UpsertDataResidencySchema>;

export const ValidateResidencyRequestSchema = z.object({
  targetRegion: z.string().min(1),
  isLlmInference: z.boolean().default(false),
  crossBorderTransfer: z.boolean().default(false),
});
export type ValidateResidencyRequestInput = z.infer<typeof ValidateResidencyRequestSchema>;

