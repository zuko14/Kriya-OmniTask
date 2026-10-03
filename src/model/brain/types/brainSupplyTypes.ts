import { z } from 'zod';
import { CapabilityTier } from '../../certification/certificationTypes.js';

export type BrainSupplyMode = 'byo' | 'managed';
export type SuitabilityState = 'RECOMMENDED' | 'SUPPORTED' | 'MARGINAL' | 'UNSUITABLE';
export type BrainStatus = 'certified' | 'stale' | 'unhealthy' | 'revoked' | 'unassigned';
export type BrainHealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'halted';
export type AlignmentRunStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export const BrainSupplyModeSchema = z.enum(['byo', 'managed']);
export const SuitabilityStateSchema = z.enum(['RECOMMENDED', 'SUPPORTED', 'MARGINAL', 'UNSUITABLE']);
export const BrainStatusSchema = z.enum(['certified', 'stale', 'unhealthy', 'revoked', 'unassigned']);
export const BrainHealthStatusSchema = z.enum(['healthy', 'degraded', 'unhealthy', 'halted']);

export interface TenantBrainConfig {
  tenantId: string;
  brainSupply: BrainSupplyMode;
  monthlyBudgetUsd: number;
  dailyBudgetUsd: number;
  currentMonthSpendUsd: number;
  currentDaySpendUsd: number;
  spendAnomalyThresholdMultiplier: number;
  status: 'active' | 'paused_anomaly' | 'budget_exhausted' | 'degraded';
  createdAt: string;
  updatedAt: string;
}

export interface TenantBrainRecord {
  id: string;
  tenantId: string;
  provider: string;
  modelId: string;
  modelVersion: string;
  credentialVaultServiceSlug?: string;
  keyLastFour: string;
  status: BrainStatus;
  healthStatus: BrainHealthStatus;
  certifiedTiers: CapabilityTier[];
  certifiedLanguages: string[];
  assignedAgents: string[];
  currentMonthSpendUsd: number;
  expiresAt?: string | null;
  lastCertifiedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogueModel {
  id: string;
  provider: string;
  modelId: string;
  displayName: string;
  contextWindow: number;
  indicativeCostPerMillionInr: number;
  structuredOutputSupport: boolean;
  toolCallingSupport: boolean;
  minContextWindowMet: boolean;
  regionCompliant: boolean;
  suitabilityState: SuitabilityState;
  namedLimitation?: string | null;
  failedHardRequirement?: string | null;
  isSelectable: boolean;
  advisoryNotice: string;
}

export interface BrainAlignmentStageEvent {
  runId: string;
  stage: number;
  name: string;
  status: 'running' | 'passed' | 'failed' | 'skipped';
  score: number;
  latencyMs: number;
  details: Record<string, unknown>;
  elapsedSeconds: number;
  /** Provider-reported spend so far (USD). */
  spentUsdSoFar: number;
  /** Spend so far in INR, only when USD_INR_RATE is configured. */
  estimatedSpendInr: number | null;
  timestamp: string;
}

export interface BrainAlignmentRunRecord {
  id: string;
  tenantId: string;
  modelId: string;
  modelVersion: string;
  provider: string;
  status: AlignmentRunStatus;
  currentStage: number;
  stages: Record<string, any>;
  estimatedCostUsd: number;
  actualCostUsd: number;
  reportCard?: any;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkforceCoverageAgentGap {
  agentSlug: string;
  agentName: string;
  requiredTier: CapabilityTier;
  requiredLanguages: string[];
  status: 'covered' | 'degraded' | 'uncovered';
  reason?: string;
  assignedModelId?: string;
}

export interface WorkforceCoverageReport {
  allCovered: boolean;
  totalAgentsCount: number;
  coveredAgentsCount: number;
  uncoveredAgentsCount: number;
  statusHeadline: string; // e.g. "Every agent in your workforce has a certified brain."
  isHealthy: boolean;
  gaps: WorkforceCoverageAgentGap[];
}

export interface BudgetLadderStatus {
  monthlyBudgetUsd: number;
  currentMonthSpendUsd: number;
  utilizationPercentage: number;
  dailyAverageSpendUsd: number;
  thresholdTier: 'normal' | 'warn_70' | 'shift_85' | 'restrict_95' | 'stop_100';
  actionTaken: 'proceed' | 'warning' | 'shift_cheaper' | 'critical_only' | 'stop_execution';
  anomalyWatchActive: boolean;
  anomalyDetected: boolean;
  attentionItemId?: string;
}

export interface WorkforceImpactSummary {
  canRun: string[];
  limited: Array<{ agentName: string; note: string }>;
  cannot: Array<{ agentName: string; requiredTier: CapabilityTier; fallbackPlan: string }>;
}

export interface ProposedBrainAssignment {
  brainId: string;
  modelId: string;
  eligibleAgents: string[];
  ineligibleAgents: string[];
  proposals: Array<{
    agentSlug: string;
    agentName: string;
    targetTier: CapabilityTier;
    action: 'assign' | 'retain_incumbent' | 'degrade';
  }>;
}
