/**
 * Xylarc AI — Enterprise Governance Types & Contracts
 * Organization hierarchy, granular ABAC, SSO/OIDC integration, and data retention policies.
 */

import { z } from 'zod';
import type { DataClassification } from '../../model/resilience/types/modelResilienceTypes.js';

export const OrgUnitTypeSchema = z.enum(['division', 'department', 'team', 'squad']);
export type OrgUnitType = z.infer<typeof OrgUnitTypeSchema>;

export const SsoProviderTypeSchema = z.enum([
  'okta',
  'azure_ad',
  'google_workspace',
  'generic_oidc',
  'saml2',
]);
export type SsoProviderType = z.infer<typeof SsoProviderTypeSchema>;

export const DataClassificationSchema = z.enum([
  'public',
  'internal',
  'confidential',
  'restricted',
]);
export type { DataClassification };

export const TargetResourceTypeSchema = z.enum([
  'audit_logs',
  'agent_conversations',
  'cost_records',
  'transcripts',
  'workflow_executions',
]);
export type TargetResourceType = z.infer<typeof TargetResourceTypeSchema>;

export const PurgeActionSchema = z.enum(['hard_delete', 'anonymize', 'archive_cold_storage']);
export type PurgeAction = z.infer<typeof PurgeActionSchema>;

// Org Unit Schema
export const CreateOrgUnitRequestSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1),
  unitType: OrgUnitTypeSchema,
  parentUnitId: z.string().optional(),
  leadUserId: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type CreateOrgUnitRequest = z.infer<typeof CreateOrgUnitRequestSchema>;

export interface OrganizationUnit {
  id: string;
  tenantId: string;
  parentUnitId?: string;
  name: string;
  code: string;
  unitType: OrgUnitType;
  leadUserId?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  children?: OrganizationUnit[];
}

// Enterprise SSO Config Schema
export const UpsertSsoConfigRequestSchema = z.object({
  providerType: SsoProviderTypeSchema,
  issuerUrl: z.string().url(),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  claimsMapping: z.record(z.string(), z.string()).default({}), // e.g. { "Admins": "admin", "Finance": "finance_manager" }
  enforceSso: z.boolean().default(false),
  isActive: z.boolean().default(true),
});
export type UpsertSsoConfigRequest = z.infer<typeof UpsertSsoConfigRequestSchema>;

export interface EnterpriseSsoConfig {
  id: string;
  tenantId: string;
  providerType: SsoProviderType;
  issuerUrl: string;
  clientId: string;
  claimsMapping: Record<string, string>;
  enforceSso: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// Sso Token Exchange
export const SsoExchangeRequestSchema = z.object({
  providerType: SsoProviderTypeSchema,
  idTokenOrAssertion: z.string().min(1),
  mockClaims: z
    .object({
      email: z.string().email(),
      sub: z.string().min(1),
      groups: z.array(z.string()).default([]),
      name: z.string().optional(),
    })
    .optional(),
});
export type SsoExchangeRequest = z.infer<typeof SsoExchangeRequestSchema>;

// ABAC Dynamic Evaluation
export interface AbacSubject {
  userId: string;
  roles: string[];
  unitId?: string;
  clearanceLevel?: DataClassification;
}

export interface AbacResource {
  resourceType: string;
  resourceId: string;
  unitId?: string;
  classification: DataClassification;
  ownerUserId?: string;
}

export const AbacEvaluationRequestSchema = z.object({
  subject: z.object({
    userId: z.string().min(1),
    roles: z.array(z.string()),
    unitId: z.string().optional(),
    clearanceLevel: DataClassificationSchema.default('internal'),
  }),
  resource: z.object({
    resourceType: z.string().min(1),
    resourceId: z.string().min(1),
    unitId: z.string().optional(),
    classification: DataClassificationSchema,
    ownerUserId: z.string().optional(),
  }),
  action: z.enum(['read', 'write', 'execute', 'delete', 'export']),
});

export interface AbacEvaluationRequest {
  subject: AbacSubject;
  resource: AbacResource;
  action: 'read' | 'write' | 'execute' | 'delete' | 'export';
}

export interface AbacEvaluationResult {
  decision: 'allow' | 'deny';
  reason: string;
  evaluatedAt: string;
}

// Data Retention Policy Schema
export const UpsertRetentionPolicyRequestSchema = z.object({
  dataClassification: DataClassificationSchema,
  targetResourceType: TargetResourceTypeSchema,
  retentionDays: z.number().int().positive(),
  purgeAction: PurgeActionSchema.default('hard_delete'),
  isActive: z.boolean().default(true),
});
export type UpsertRetentionPolicyRequest = z.infer<typeof UpsertRetentionPolicyRequestSchema>;

export interface DataRetentionPolicy {
  id: string;
  tenantId: string;
  dataClassification: DataClassification;
  targetResourceType: TargetResourceType;
  retentionDays: number;
  purgeAction: PurgeAction;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GovernancePurgeAudit {
  id: string;
  tenantId: string;
  policyId: string;
  targetResourceType: TargetResourceType;
  recordsEvaluated: number;
  recordsPurged: number;
  status: 'completed' | 'failed';
  executedAt: string;
}
