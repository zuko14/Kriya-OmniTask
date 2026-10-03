/**
 * Kriya AI — India DPDP Act 2023 Domain Models & Schemas
 * Implements purpose-bound consent ledger, data principal rights requests (SAR),
 * automated retention purges, and breach notification governance.
 */

import { z } from 'zod';

// ==========================================
// 1. Consent Ledger (§6, §7 DPDP Act 2023)
// ==========================================

export type DpdpConsentStatus = 'granted' | 'withdrawn' | 'expired' | 'superseded';

export interface DpdpConsentRecord {
  id: string;
  tenant_id: string;
  customer_id: string;
  purpose: string;
  status: DpdpConsentStatus;
  notice_version: string;
  notice_hash: string;
  language: string;
  valid_until: string | null;
  proof_receipt_id: string | null;
  withdrawn_at: string | null;
  withdrawn_reason: string | null;
  created_at: string;
  updated_at: string;
}

export const GrantConsentInputSchema = z.object({
  customerId: z.string().min(1, 'Customer ID is required'),
  purpose: z.string().min(1, 'Consent purpose is required'),
  noticeVersion: z.string().default('v1.0'),
  noticeHash: z.string().optional(),
  noticeContent: z.string().optional(),
  language: z.string().default('en'),
  validUntil: z.string().optional().nullable(),
});

export type GrantConsentInput = z.input<typeof GrantConsentInputSchema>;

export const WithdrawConsentInputSchema = z.object({
  customerId: z.string().min(1, 'Customer ID is required'),
  purpose: z.string().optional(),
  consentId: z.string().optional(),
  reason: z.string().default('User requested withdrawal'),
});

export type WithdrawConsentInput = z.input<typeof WithdrawConsentInputSchema>;

// ==========================================
// 2. Data Principal Rights Requests (SAR §11 - §14)
// ==========================================

export type DpdpRequestType = 'access' | 'correction' | 'erasure' | 'grievance' | 'nominee';
export type DpdpRequestStatus = 'submitted' | 'in_review' | 'completed' | 'rejected';

export interface DpdpRightsRequestRecord {
  id: string;
  tenant_id: string;
  customer_id: string;
  request_type: DpdpRequestType;
  status: DpdpRequestStatus;
  payload_json: string;
  resolution_notes: string | null;
  erasure_tombstone_hash: string | null;
  proof_receipt_id: string | null;
  sla_expires_at: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export const SubmitRightsRequestInputSchema = z.object({
  customerId: z.string().min(1, 'Customer ID is required'),
  requestType: z.enum(['access', 'correction', 'erasure', 'grievance', 'nominee']),
  payload: z.record(z.unknown()).default({}),
  customSlaHours: z.number().positive().optional(),
});

export type SubmitRightsRequestInput = z.input<typeof SubmitRightsRequestInputSchema>;

export const ExecuteRightsRequestInputSchema = z.object({
  requestId: z.string().min(1, 'Request ID is required'),
  resolutionNotes: z.string().default('Processed pursuant to DPDP Act 2023'),
  correctionUpdates: z.record(z.unknown()).optional(),
  erasureReason: z.string().default('Data Principal Right to Erasure exercised'),
});

export type ExecuteRightsRequestInput = z.input<typeof ExecuteRightsRequestInputSchema>;

// ==========================================
// 3. Automated Data Retention & Purge (§8(7))
// ==========================================

export type DpdpPurgeAction = 'anonymize' | 'hard_delete';
export type DpdpRetentionJobStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface DpdpRetentionJobRecord {
  id: string;
  tenant_id: string;
  policy_id: string | null;
  target_resource_type: string;
  retention_days: number;
  cutoff_timestamp: string;
  records_scanned: number;
  records_purged: number;
  purge_action: DpdpPurgeAction;
  status: DpdpRetentionJobStatus;
  proof_receipt_id: string | null;
  executed_at: string;
  created_at: string;
}

export const ExecuteRetentionJobInputSchema = z.object({
  policyId: z.string().optional().nullable(),
  targetResourceType: z.string().min(1, 'Target resource type is required'),
  retentionDays: z.number().int().positive('Retention days must be positive'),
  purgeAction: z.enum(['anonymize', 'hard_delete']).default('anonymize'),
});

export type ExecuteRetentionJobInput = z.input<typeof ExecuteRetentionJobInputSchema>;

// ==========================================
// 4. Breach Notification Governance (§8(6))
// ==========================================

export type DpdpBreachSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type DpdpBreachType =
  | 'unauthorized_access'
  | 'accidental_exposure'
  | 'ransomware_loss'
  | 'credential_leakage';
export type DpdpBreachStatus = 'detected' | 'contained' | 'notified' | 'resolved';

export interface DpdpBreachIncidentRecord {
  id: string;
  tenant_id: string;
  incident_name: string;
  severity: DpdpBreachSeverity;
  breach_type: DpdpBreachType;
  status: DpdpBreachStatus;
  affected_principals_count: number;
  incident_summary: string;
  root_cause: string | null;
  remediation_steps: string | null;
  dpbi_notified_at: string | null;
  dpbi_reference_number: string | null;
  principals_notified_at: string | null;
  dpo_contact: string;
  created_at: string;
  updated_at: string;
}

export const ReportBreachIncidentInputSchema = z.object({
  incidentName: z.string().min(1, 'Incident name is required'),
  severity: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']),
  breachType: z.enum([
    'unauthorized_access',
    'accidental_exposure',
    'ransomware_loss',
    'credential_leakage',
  ]),
  affectedPrincipalsCount: z.number().int().nonnegative().default(0),
  incidentSummary: z.string().min(1, 'Incident summary is required'),
  rootCause: z.string().optional().nullable(),
  remediationSteps: z.string().optional().nullable(),
  dpoContact: z.string().email('Valid DPO email contact is required'),
});

export type ReportBreachIncidentInput = z.input<typeof ReportBreachIncidentInputSchema>;

export interface DpbiNotificationPackage {
  incidentId: string;
  incidentName: string;
  dpbiReferenceNumber: string;
  severity: DpdpBreachSeverity;
  breachType: DpdpBreachType;
  affectedPrincipalsCount: number;
  incidentSummary: string;
  rootCause: string;
  remediationSteps: string;
  dpoContact: string;
  intimationTimestamp: string;
  statutoryFramework: string;
  affectedPrincipalNotificationTemplate: {
    subject: string;
    bodyMarkdown: string;
  };
}
