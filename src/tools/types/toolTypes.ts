/**
 * Kriya AI — Tool Gateway & Credential Vault Types & Schemas
 * Type-safe contracts for tool definitions, permissions, risk gating, and credential storage (§8.4, §15, §18 of CLAUDE.md).
 */

import { z } from 'zod';
import { RiskTierEnum, RiskTier } from '../../agents/types/agentTypes.js';

export const ToolCategoryEnum = z.enum([
  'crm',
  'calendar',
  'communication',
  'payment',
  'webhook',
  'custom',
]);
export type ToolCategory = z.infer<typeof ToolCategoryEnum>;

export const ToolExecutionStatusEnum = z.enum([
  'pending',
  'executing',
  'completed',
  'failed',
  'needs_approval',
]);
export type ToolExecutionStatus = z.infer<typeof ToolExecutionStatusEnum>;

// ============================================================================
// Tool Definition Contract (§18 of CLAUDE.md)
// ============================================================================

export const ToolDefinitionSchema = z.object({
  slug: z.string().min(2).max(64).regex(/^[a-z0-9_-]+$/),
  name: z.string().min(2).max(128),
  description: z.string().max(1024),
  category: ToolCategoryEnum,
  riskTier: RiskTierEnum.default('LOW'),
  requiresApproval: z.boolean().default(false),
  inputSchema: z.record(z.unknown()).default({}),
  outputSchema: z.record(z.unknown()).default({}),
  isSystem: z.boolean().default(true),
});
export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;

export interface ToolDefinitionRecord {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: ToolCategory;
  risk_tier: RiskTier;
  requires_approval: number;
  input_schema_json: string;
  output_schema_json: string;
  is_system: number;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Tenant Credential Vault Contract (§8.4 of CLAUDE.md)
// ============================================================================

export interface TenantCredentialRecord {
  id: string;
  tenant_id: string;
  service_slug: string;
  name: string;
  encrypted_data: string;
  iv: string;
  tag: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
}

export const StoreCredentialSchema = z.object({
  serviceSlug: z.string().min(2).max(64),
  name: z.string().min(2).max(128),
  secretData: z.record(z.unknown()), // Plaintext in memory, encrypted immediately into vault
  metadata: z.record(z.unknown()).default({}).optional(),
});
export type StoreCredential = z.infer<typeof StoreCredentialSchema>;
export type StoreCredentialInput = z.input<typeof StoreCredentialSchema>;

// ============================================================================
// Tool Permission & Execution Ledger (§18 of CLAUDE.md)
// ============================================================================

export interface ToolPermissionRecord {
  id: string;
  tenant_id: string;
  agent_id: string | null;
  tool_slug: string;
  is_enabled: number;
  daily_quota_limit: number;
  daily_invocation_count: number;
  last_invoked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ToolExecutionRecord {
  id: string;
  tenant_id: string;
  agent_id: string | null;
  tool_slug: string;
  idempotency_key: string | null;
  risk_tier: RiskTier;
  status: ToolExecutionStatus;
  input_json: string;
  output_json: string | null;
  error_message: string | null;
  duration_ms: number;
  caller_ip: string | null;
  correlation_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExecuteToolRequest {
  toolSlug: string;
  agentId?: string;
  input: Record<string, unknown>;
  idempotencyKey?: string;
  correlationId?: string;
  callerIp?: string;
  bypassApproval?: boolean; // Only platform admins or explicit human approval tokens
}

export interface ExecuteToolResponse {
  executionId: string;
  toolSlug: string;
  status: ToolExecutionStatus;
  result?: Record<string, unknown>;
  error?: string;
  durationMs: number;
  isIdempotentReplay: boolean;
  requiresHumanApproval: boolean;
}

export type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';
