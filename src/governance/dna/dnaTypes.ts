/**
 * Kriya Omnitask — Business DNA & Roster Manifest Type Contracts (§3, §4, §23)
 * Implements type-adaptive configuration, agent roster moulding, and versioned manifest tracking.
 */

import { z } from 'zod';

// ============================================================================
// 1. Entity Vocabulary Schema (§3)
// ============================================================================

export const EntityVocabularySchema = z.object({
  customer: z.string().min(1).default('Customer'),
  customer_plural: z.string().min(1).default('Customers'),
  item: z.string().min(1).default('Item'),
  item_plural: z.string().min(1).default('Items'),
  transaction: z.string().min(1).default('Transaction'),
  transaction_plural: z.string().min(1).default('Transactions'),
  appointment: z.string().min(1).default('Appointment'),
  agent_term: z.string().min(1).default('Agent'),
  custom_labels: z.record(z.string()).default({}),
});

export type EntityVocabulary = z.infer<typeof EntityVocabularySchema>;

// ============================================================================
// 2. Lifecycle Model Schema (§3)
// ============================================================================

export const LifecycleModelSchema = z.object({
  stages: z.array(z.string().min(1)).min(1),
  initial_stage: z.string().min(1),
  terminal_stages: z.array(z.string().min(1)).default([]),
});

export type LifecycleModel = z.infer<typeof LifecycleModelSchema>;

// ============================================================================
// 3. DNA Agent Specification (§4)
// ============================================================================

export const DnaAgentSpecSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  name: z.string().min(1),
  role: z.string().min(1),
  description: z.string().default(''),
  min_model_tier: z.enum(['T1', 'T2', 'T3', 'T4']).default('T2'),
  ceiling_autonomy: z.enum(['L1', 'L2', 'L3', 'L4']).default('L2'),
  skills: z.array(z.string()).default([]),
  tools: z.array(z.string()).default([]),
  forbidden_actions: z.array(z.string()).default([]),
  escalation_defaults: z.array(z.string()).default([]),
  is_optional: z.boolean().default(false),
  is_active: z.boolean().default(true),
});

export type DnaAgentSpec = z.infer<typeof DnaAgentSpecSchema>;

// ============================================================================
// 4. Default KPI Definition (§3)
// ============================================================================

export const KpiDefinitionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  unit: z.string().default(''),
  format: z.enum(['currency', 'percent', 'number', 'duration', 'text']).default('number'),
});

export type KpiDefinition = z.infer<typeof KpiDefinitionSchema>;

// ============================================================================
// 5. External Retrieval Policy (§3, §10)
// ============================================================================

export const ExternalRetrievalPolicySchema = z.object({
  allowed: z.boolean().default(false),
  allowed_domains: z.array(z.string()).default([]),
});

export type ExternalRetrievalPolicy = z.infer<typeof ExternalRetrievalPolicySchema>;

// ============================================================================
// 6. Complete Business DNA Profile Schema (§3)
// ============================================================================

export const DnaProfileSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1).default('1.0.0'),
  business_type: z.string().min(1),
  display_name: z.string().min(1),
  description: z.string().optional(),
  lifecycle_model: LifecycleModelSchema,
  entity_vocabulary: EntityVocabularySchema,
  capabilities: z.array(z.string()).default([]),
  required_agents: z.array(DnaAgentSpecSchema).default([]),
  optional_agents: z.array(DnaAgentSpecSchema).default([]),
  forbidden_actions: z.array(z.string()).default([]),
  compliance_profile: z.record(z.any()).default({}),
  default_kpis: z.array(KpiDefinitionSchema).default([]),
  knowledge_schema: z.array(z.string()).default([]),
  escalation_defaults: z.array(z.string()).default([]),
  skill_grants: z.array(z.string()).default([]),
  external_retrieval_policy: ExternalRetrievalPolicySchema.default({ allowed: false, allowed_domains: [] }),
  min_tier_requirements: z.record(z.enum(['T1', 'T2', 'T3', 'T4'])).default({}),
  is_active: z.boolean().default(true),
  created_at: z.string(),
  updated_at: z.string(),
});

export type DnaProfile = z.infer<typeof DnaProfileSchema>;

// ============================================================================
// 7. Versioned Tenant Roster Manifest (§4)
// ============================================================================

export const TenantRosterManifestSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().min(1),
  version: z.number().int().positive(),
  dna_profile_id: z.string().min(1),
  dna_profile_version: z.string().min(1),
  entity_vocabulary: EntityVocabularySchema,
  capabilities: z.array(z.string()),
  lifecycle_stages: z.array(z.string()),
  agents: z.array(DnaAgentSpecSchema),
  checksum: z.string().min(1), // SHA-256 hash of manifest payload
  status: z.enum(['active', 'superseded', 'rolled_back']).default('active'),
  created_by: z.string().min(1),
  created_at: z.string(),
  rolled_back_from_version: z.number().int().positive().nullable().optional(),
});

export type TenantRosterManifest = z.infer<typeof TenantRosterManifestSchema>;

// ============================================================================
// 8. Requests & API Schemas
// ============================================================================

export const SwitchDnaRequestSchema = z.object({
  dnaProfileId: z.string().min(1),
  reason: z.string().min(5, 'Reason must be at least 5 characters'),
  optionalAgentIds: z.array(z.string()).optional(),
  autonomyCeiling: z.enum(['L1', 'L2', 'L3', 'L4']).optional(),
});

export type SwitchDnaRequest = z.infer<typeof SwitchDnaRequestSchema>;

export const RollbackRosterManifestRequestSchema = z.object({
  targetVersion: z.number().int().positive(),
  reason: z.string().min(5, 'Reason must be at least 5 characters'),
});

export type RollbackRosterManifestRequest = z.infer<typeof RollbackRosterManifestRequestSchema>;

export const ResolvedTenantDnaSchema = z.object({
  tenantId: z.string(),
  activeManifest: TenantRosterManifestSchema,
  dnaProfile: DnaProfileSchema,
  vocabulary: EntityVocabularySchema,
  capabilities: z.array(z.string()),
  lifecycleStages: z.array(z.string()),
  agents: z.array(DnaAgentSpecSchema),
  kpis: z.array(KpiDefinitionSchema),
});

export type ResolvedTenantDna = z.infer<typeof ResolvedTenantDnaSchema>;
