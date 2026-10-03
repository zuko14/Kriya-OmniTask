/**
 * Kriya Omnitask — Four-Tier Context & Token Architecture Types (§8, §23)
 * Authoritative type definitions and Zod validation schemas for context assembly,
 * memory tiers, proactive compaction, token budget ladders, and per-language tracking.
 */

import { z } from 'zod';

// ============================================================================
// Tier 1: Structured Session State Schemas (§8.2)
// ============================================================================

export const SessionEntitySchema = z.object({
  key: z.string(),
  value: z.unknown(),
  confidence: z.number().min(0).max(1).default(1.0),
  extractedAt: z.string().datetime(),
  sourceTurnIndex: z.number().int().nonnegative().optional(),
});
export type SessionEntity = z.infer<typeof SessionEntitySchema>;

export const SessionDecisionSchema = z.object({
  id: z.string(),
  decision: z.string(),
  rationale: z.string().optional(),
  agreedBy: z.enum(['customer', 'agent', 'system', 'human_operator']),
  decidedAt: z.string().datetime(),
  turnIndex: z.number().int().nonnegative().optional(),
});
export type SessionDecision = z.infer<typeof SessionDecisionSchema>;

export const SessionCommitmentSchema = z.object({
  id: z.string(),
  commitment: z.string(),
  committedParty: z.enum(['agent', 'customer', 'business']),
  targetTime: z.string().optional(),
  status: z.enum(['pending', 'fulfilled', 'cancelled', 'breached']).default('pending'),
  createdAt: z.string().datetime(),
  turnIndex: z.number().int().nonnegative().optional(),
});
export type SessionCommitment = z.infer<typeof SessionCommitmentSchema>;

export const SessionOpenItemSchema = z.object({
  id: z.string(),
  questionOrNeed: z.string(),
  assignedTo: z.enum(['customer', 'agent', 'supervisor', 'human_operator']),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('MEDIUM'),
  status: z.enum(['open', 'in_progress', 'resolved']).default('open'),
  createdAt: z.string().datetime(),
});
export type SessionOpenItem = z.infer<typeof SessionOpenItemSchema>;

export const Tier1SessionStateSchema = z.object({
  sessionId: z.string(),
  tenantId: z.string(),
  entities: z.record(z.string(), z.unknown()).default({}),
  decisions: z.array(SessionDecisionSchema).default([]),
  commitments: z.array(SessionCommitmentSchema).default([]),
  openItems: z.array(SessionOpenItemSchema).default([]),
  version: z.number().int().positive().default(1),
  extractedAt: z.string().datetime(),
});
export type Tier1SessionState = z.infer<typeof Tier1SessionStateSchema>;

// ============================================================================
// Tier 0: Working Context & Layered Assembly (§8.2, §8.3)
// ============================================================================

export interface ConversationTurn {
  id: string;
  tenantId: string;
  sessionId: string;
  turnIndex: number;
  speaker: 'customer' | 'agent' | 'system' | 'supervisor';
  language: string;
  content: string;
  structuredPayload?: Record<string, unknown>;
  tokensPrompt: number;
  tokensCompletion: number;
  isCompacted: boolean;
  createdAt: string;
}

export interface RetrievedFact {
  fact: string;
  source: string;
  trustTier?: 'A' | 'B' | 'C' | 'D';
  retrievedAt: string;
}

export interface ExternalDataBlock {
  sourceUrl?: string;
  provider?: string;
  content: string;
  trustTier: 'C' | 'D';
  retrievedAt: string;
  isSanitized: boolean;
}

export interface LayeredContextAssembly {
  // Layer 1: System frame (cached, stable)
  layer1SystemFrame: string;
  // Layer 2: Tenant frame (cached, stable per tenant - DNA vocabulary & policies)
  layer2TenantFrame: string;
  // Layer 3: Task frame (current task & requirements)
  layer3TaskFrame: string;
  // Layer 4: Retrieved facts (Tier 1 & 2 facts with sources)
  layer4RetrievedFacts: RetrievedFact[];
  // Layer 5: External data block (untrusted, fenced, labeled)
  layer5ExternalData?: ExternalDataBlock;
  // Layer 6: Recent turns (verbatim, most recent first, within budget)
  layer6RecentTurns: ConversationTurn[];
  // Layer 7: Rolling summary (compacted older turns)
  layer7RollingSummary?: string;

  // Token metadata & Assembly diagnostics
  totalAssembledTokens: number;
  prefixHash: string; // SHA-256 hash of Layer 1 + Layer 2
  isPrefixCached: boolean;
  droppedLayers: number[]; // E.g., [7] if rolling summary was dropped due to budget pressure
  truncatedLayers: number[]; // E.g., [6] if recent turns were truncated
  formattedPrompt: string;
}

// ============================================================================
// Proactive Compaction & Extraction (§8.4)
// ============================================================================

export interface CompactionRequest {
  sessionId: string;
  force?: boolean;
}

export interface CompactionResult {
  sessionId: string;
  success: boolean;
  status: 'compacted' | 'aborted_escalated' | 'no_compaction_needed';
  initialTokens: number;
  compactedTokens: number;
  tokensSaved: number;
  extractedEntitiesCount: number;
  extractedDecisionsCount: number;
  extractedCommitmentsCount: number;
  extractedOpenItemsCount: number;
  turnsCompactedCount: number;
  rollingSummary: string;
  escalationReason?: string;
  compactedAt: string;
}

// ============================================================================
// Token Budget Ladder (§8.5, §23)
// ============================================================================

export type BudgetLadderStage = 'normal' | 'warn' | 'optimize' | 'restrict' | 'stop';

export interface TokenBudgetEvaluation {
  tenantId: string;
  sessionId?: string;
  allocatedBudgetTokens: number;
  currentConsumedTokens: number;
  utilizationPct: number;
  stage: BudgetLadderStage;
  action: 'proceed' | 'warn_compact' | 'optimize_drop_layer7' | 'restrict_critical_only' | 'circuit_break_stop';
  message: string;
}

export interface TokenBudgetPolicy {
  id: string;
  tenantId: string;
  taskTokenBudget: number;
  sessionTokenBudget: number;
  compactionThresholdPct: number; // 60.0% - 70.0%
  warnThresholdPct: number; // 70.0%
  optimizeThresholdPct: number; // 85.0%
  restrictThresholdPct: number; // 95.0%
  stopThresholdPct: number; // 100.0%
}

// ============================================================================
// Language Cost Tracking (§8.6, §23)
// ============================================================================

export const INDIC_TOKEN_MULTIPLIERS: Record<string, number> = {
  en: 1.0,
  hi: 2.4, // Hindi
  te: 3.1, // Telugu
  ta: 3.2, // Tamil
  kn: 3.0, // Kannada
  bn: 2.8, // Bengali
  mr: 2.6, // Marathi
  gu: 2.7, // Gujarati
  ml: 3.3, // Malayalam
  pa: 2.9, // Punjabi
  or: 3.1, // Odia
};

export const USD_TO_INR_RATE = 87.5; // Standard platform conversion rate

export interface LanguageCostRecord {
  id: string;
  tenantId: string;
  sessionId: string;
  language: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  tokenEfficiencyMultiplier: number;
  costUsd: number;
  costInr: number;
  createdAt: string;
  updatedAt: string;
}
