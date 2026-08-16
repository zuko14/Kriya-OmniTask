/**
 * Xylarc AI — Deployment & Release Engineering Type Definitions
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
