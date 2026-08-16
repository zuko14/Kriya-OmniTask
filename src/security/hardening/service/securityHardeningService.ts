/**
 * Xylarc AI — Security Hardening & Zero-Trust Audit Service
 * High-level orchestration for audit ledger chaining, secret rotation, and zero-trust scans (§14, §20 of CLAUDE.md).
 */

import {
  LogSecurityEventRequest,
  RotateSecretRequest,
  SecurityAuditLedgerRecord,
  SecretRotationRecord,
  AuditLedgerVerificationReport,
  SecretRotationResult,
  SecurityComplianceReport,
} from '../types/securityHardeningTypes.js';
import { SecurityHardeningRepository } from '../repositories/securityHardeningRepository.js';
import { CryptoAuditLedger } from '../ledger/cryptoAuditLedger.js';
import { SecretRotationEngine } from '../rotation/secretRotationEngine.js';
import { ZeroTrustScanner } from '../scanner/zeroTrustScanner.js';
import { config } from '../../../core/config/config.js';

export class SecurityHardeningService {
  private repo: SecurityHardeningRepository;

  constructor(repo?: SecurityHardeningRepository) {
    this.repo = repo || new SecurityHardeningRepository();
  }

  /**
   * Appends an event to the cryptographically chained audit log.
   */
  public async logEvent(request: LogSecurityEventRequest): Promise<SecurityAuditLedgerRecord> {
    return this.repo.appendAuditEvent(request);
  }

  /**
   * Verifies the cryptographic integrity of the tenant's audit ledger.
   */
  public async verifyAuditLedger(): Promise<AuditLedgerVerificationReport> {
    const records = await this.repo.listAuditRecords();
    return CryptoAuditLedger.verifyChain(records);
  }

  /**
   * Rotates a secret or key with a specified grace period.
   */
  public async rotateSecret(request: RotateSecretRequest): Promise<SecretRotationResult> {
    const currentActive = await this.repo.getActiveSecret(request.secretName);

    const rotationPlan = SecretRotationEngine.planRotation({
      secretName: request.secretName,
      newSecretValue: request.newSecretValue,
      currentActiveRecord: currentActive,
      gracePeriodSeconds: request.gracePeriodSeconds,
      encryptionKey: config.get('ENCRYPTION_KEY'),
    });

    const newRecord = await this.repo.saveSecretRotation(rotationPlan);

    // Record this rotation event in the cryptographically chained audit ledger
    await this.logEvent({
      eventType: 'SECRET_ROTATION',
      actorId: 'system_security_engine',
      actorRole: 'security_admin',
      targetResource: `secret:${request.secretName}`,
      action: 'ROTATE',
      payload: {
        secretName: request.secretName,
        newVersion: newRecord.secret_version,
        gracePeriodSeconds: request.gracePeriodSeconds,
      },
    });

    return {
      secretName: newRecord.secret_name,
      newVersion: newRecord.secret_version,
      status: newRecord.status,
      rotatedAt: newRecord.rotated_at,
    };
  }

  /**
   * Lists secrets and version history.
   */
  public async listSecrets(secretName?: string): Promise<SecretRotationRecord[]> {
    return this.repo.listSecrets(secretName);
  }

  /**
   * Executes a zero-trust compliance scan over the tenant's security infrastructure.
   */
  public async runComplianceScan(userRoles: string[] = ['admin']): Promise<SecurityComplianceReport> {
    const auditRecords = await this.repo.listAuditRecords();
    const secrets = await this.repo.listSecrets();

    return ZeroTrustScanner.scan({
      auditRecords,
      secrets,
      userRoles,
    });
  }
}
