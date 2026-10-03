import { z } from 'zod';

export type CapabilityTier = 'T1' | 'T2' | 'T3' | 'T4';
export type CertificationStatus = 'certified' | 'uncertified' | 'expired' | 'stale' | 'failed';
export type DegradationStep = 'route_up' | 'decompose' | 'reduce_autonomy' | 'escalate';

export const CapabilityTierSchema = z.enum(['T1', 'T2', 'T3', 'T4']);
export const CertificationStatusSchema = z.enum(['certified', 'uncertified', 'expired', 'stale', 'failed']);
export const DegradationStepSchema = z.enum(['route_up', 'decompose', 'reduce_autonomy', 'escalate']);

export const ModelCertificationRecordSchema = z.object({
  id: z.string(),
  model_id: z.string(),
  model_version: z.string(),
  provider: z.string(),
  upstream_provider: z.string().default('direct'),
  tier: CapabilityTierSchema,
  language: z.string(),
  eval_suite_version: z.string().default('v1.0.0'),
  status: CertificationStatusSchema,
  pass_rate: z.number().min(0).max(1),
  latency_p95_ms: z.number().nonnegative(),
  cost_per_task_usd: z.number().nonnegative(),
  stage_results_json: z.string().default('{}'),
  certified_at: z.string().nullable().optional(),
  expires_at: z.string().nullable().optional(),
  certified_by: z.string().default('system_harness'),
  created_at: z.string(),
  updated_at: z.string(),
});

export type ModelCertificationRecord = z.infer<typeof ModelCertificationRecordSchema>;

export interface StageResult {
  stage: number;
  name: string;
  passed: boolean;
  score: number; // 0.0 to 1.0
  latencyMs: number;
  details: Record<string, unknown>;
  errorMessage?: string;
  /** 'not_run' = stage was not executed; it is reported, never counted as a pass. */
  status?: 'passed' | 'failed' | 'not_run';
}

export interface AlignmentCheckReportCard {
  checkId: string;
  modelId: string;
  modelVersion: string;
  provider: string;
  upstreamProvider: string;
  requestedTier: CapabilityTier;
  language: string;
  overallPassed: boolean;
  stages: Record<string, StageResult>;
  certifiedTiers: CapabilityTier[];
  certifiedLanguages: string[];
  costEstimateUsd: number;
  completedAt: string;
}

export interface AlignmentCheckRequest {
  modelId: string;
  modelVersion: string;
  provider: string;
  upstreamProvider?: string;
  tiers?: CapabilityTier[];
  languages?: string[];
  tenantId?: string;
  byoKey?: string;
}

export interface DegradationResolution {
  actionTaken: DegradationStep;
  originalTier: CapabilityTier;
  resolvedTier?: CapabilityTier;
  resolvedModelId?: string;
  subTasks?: Array<{ id: string; tier: CapabilityTier; description: string }>;
  autonomyReducedTo?: 'draft_for_approval';
  escalationAttentionItemId?: string;
  reason: string;
}
