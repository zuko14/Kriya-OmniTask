/**
 * Kriya AI — Security Hardening & Zero-Trust Audit Type Definitions
 * Typed contracts for chained cryptographic audit logs, key rotation, and zero-trust verification (§14, §20 of CLAUDE.md).
 */

import { z } from 'zod';
import { BaseEntity } from '../../../storage/repositories/baseRepository.js';

export const SecretStatusEnum = z.enum(['active', 'grace_period', 'revoked']);
export type SecretStatus = z.infer<typeof SecretStatusEnum>;

export interface SecurityAuditLedgerRecord extends BaseEntity {
  organization_id: string;
  sequence_number: number;
  event_type: string;
  actor_id: string;
  actor_role: string;
  target_resource: string;
  action: string;
  payload_hash: string;
  previous_hash: string;
  current_hash: string;
}

export interface SecretRotationRecord extends BaseEntity {
  organization_id: string;
  secret_name: string;
  secret_version: number;
  status: SecretStatus;
  encrypted_secret_value: string;
  rotated_at: string;
  expires_at?: string;
}

export interface AuditLedgerVerificationReport {
  isValid: boolean;
  totalEventsChecked: number;
  tamperedEventsCount: number;
  lastValidSequence: number;
  brokenHashAtSequence?: number;
  details: string[];
}

export interface SecretRotationResult {
  secretName: string;
  newVersion: number;
  status: SecretStatus;
  rotatedAt: string;
  expiresAt?: string;
  proofReceiptId?: string;
  receiptHash?: string;
}

export interface SecretHygieneReport {
  totalSecrets: number;
  activeSecrets: number;
  gracePeriodSecrets: number;
  expiredGraceSecretsRevoked: number;
  revokedSecrets: number;
  entropyCompliant: boolean;
  hygieneStatus: 'HEALTHY' | 'ACTION_REQUIRED';
  details: string[];
}

export interface SecurityScanFinding {
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  category: 'privilege_escalation' | 'cross_tenant_access' | 'secret_leakage' | 'tamper_detected' | 'injection_vulnerability';
  description: string;
  resourceId?: string;
  remediation: string;
}

export interface SecurityComplianceReport {
  status: 'COMPLIANT' | 'VULNERABILITY_DETECTED';
  totalChecks: number;
  passedChecks: number;
  findings: SecurityScanFinding[];
  scanTimestamp: string;
}

export const LogSecurityEventRequestSchema = z.object({
  eventType: z.string().min(1),
  actorId: z.string().min(1),
  actorRole: z.string().min(1),
  targetResource: z.string().min(1),
  action: z.string().min(1),
  payload: z.record(z.unknown()).default({}),
});
export type LogSecurityEventRequest = z.infer<typeof LogSecurityEventRequestSchema>;

export const RotateSecretRequestSchema = z.object({
  secretName: z.string().min(1),
  newSecretValue: z.string().min(8),
  gracePeriodSeconds: z.number().min(0).default(86400), // 24 hours default
});
export type RotateSecretRequest = z.infer<typeof RotateSecretRequestSchema>;

export const RunSecurityScanRequestSchema = z.object({
  scanTarget: z.enum(['audit_ledger', 'rbac_roles', 'secret_vault', 'full_suite']).default('full_suite'),
});
export type RunSecurityScanRequest = z.infer<typeof RunSecurityScanRequestSchema>;
