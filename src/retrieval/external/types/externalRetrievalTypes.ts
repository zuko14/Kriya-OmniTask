/**
 * Kriya Omnitask — Secured External Retrieval Contracts & Types
 * Specifications for Typed Information Needs, Trust Ladder, Egress Security,
 * and External Data Governance (§10.1, §10.2, §10.3, §10.4 of CLAUDE1.md).
 */

import { z } from 'zod';
import { RiskTier } from '../../../agents/types/agentTypes.js';

// ============================================================================
// 1. The Trust Ladder (§10.2)
// ============================================================================

export const TrustTierSchema = z.enum([
  'TIER_A', // System of record (ERP, CRM, calendar, DB) -> AUTHORITATIVE
  'TIER_B', // Tenant-owned knowledge (uploaded docs, SOPs) -> AUTHORITATIVE in scope
  'TIER_C', // Verified external (allowlisted, structured) -> SUPPORTING
  'TIER_D', // Open web search -> INDICATIVE ONLY
  'TIER_E', // Model recall -> NEVER a business fact
]);
export type TrustTier = z.infer<typeof TrustTierSchema>;

// ============================================================================
// 2. Typed Information Needs (§10.3)
// ============================================================================

export const TypedInformationNeedSchema = z.object({
  topic: z.string().min(1),
  objective: z.string().min(1),
  entityQuery: z.string().min(1),
  targetDomains: z.array(z.string()).optional().default([]),
  requiredFields: z.array(z.string()).optional().default([]),
  maxAgeHours: z.number().int().positive().optional().default(72),
  allowedTiers: z.array(TrustTierSchema).optional().default(['TIER_C', 'TIER_D']),
  callingAgentSlug: z.string().min(1),
  channel: z.string().optional().default('web'),
});
export type TypedInformationNeed = z.infer<typeof TypedInformationNeedSchema>;
export type TypedInformationNeedInput = z.input<typeof TypedInformationNeedSchema>;

// ============================================================================
// 3. Search Grants per Agent (§10.4)
// ============================================================================

export const SearchGrantRecordSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  agentSlug: z.string().min(1),
  enabled: z.boolean().default(false), // Off by default (§10.4)
  allowedDomains: z.array(z.string()).default([]),
  maxDailyQueries: z.number().int().positive().default(100),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SearchGrantRecord = z.infer<typeof SearchGrantRecordSchema>;

// ============================================================================
// 4. Egress Policy & Domain Reputation (§10.3, §10.4)
// ============================================================================

export interface DomainReputationRecord {
  domain: string;
  reputationScore: number;
  injectionAttemptsCount: number;
  lastViolationAt: string | null;
  isAutoDenylisted: boolean;
  denylistedAt: string | null;
  denylistReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EgressGatewayCheckResult {
  allowed: boolean;
  blockedReason?: string;
  domain: string;
  isAllowlisted: boolean;
  isDenylisted: boolean;
  reputationScore: number;
}

// ============================================================================
// 5. Sanitized Web Content & Isolation Wrapper (§10.3)
// ============================================================================

export interface SanitizedWebContent {
  sourceUrl: string;
  domain: string;
  title?: string;
  textContent: string;
  contentHash: string;
  injectionsDetected: string[];
  retrievedAt: string;
}

export interface ExternalFactRecord {
  id: string;
  tenantId: string;
  correlationId: string;
  agentSlug: string;
  topic: string;
  sourceUrl: string;
  domain: string;
  trustTier: TrustTier;
  retrievedAt: string;
  contentHash: string;
  freshnessTtlSeconds: number;
  isolatedContent: string; // Fenced with <<<UNTRUSTED_EXTERNAL_DATA...>>>
  extractedData: Record<string, unknown>;
  citation: string;
  expiresAt: string;
  securityFlags: string[];
}

// ============================================================================
// 6. Evidence Validation & Conflict Resolution (§10.2)
// ============================================================================

export interface ExternalEvidenceItem {
  id?: string;
  factText: string;
  trustTier: TrustTier;
  source: string;
  retrievedAt?: string;
}

export interface ActionJustificationResult {
  permitted: boolean;
  actionRiskTier: RiskTier;
  reason?: string;
  requiresHumanApproval: boolean;
  supportingTiersPresent: TrustTier[];
}

export interface SystemOfRecordConflictEvaluation {
  hasConflict: boolean;
  winningValue: unknown;
  rejectedValue: unknown;
  sourceOfTruth: 'system_of_record';
  attentionItemCreated: boolean;
  attentionItemId?: string;
  description: string;
}
