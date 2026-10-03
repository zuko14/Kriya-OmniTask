/**
 * Kriya AI — Zero-Trust Security Compliance Scanner
 * Automated compliance validation across audit ledgers, role boundaries, and secret vaults (§14, §20 of CLAUDE.md).
 */

import {
  SecurityComplianceReport,
  SecurityScanFinding,
  SecurityAuditLedgerRecord,
  SecretRotationRecord,
} from '../types/securityHardeningTypes.js';
import { CryptoAuditLedger } from '../ledger/cryptoAuditLedger.js';
import { SecretRotationEngine } from '../rotation/secretRotationEngine.js';

export class ZeroTrustScanner {
  /**
   * Runs a zero-trust compliance scan over the tenant's security infrastructure.
   */
  public static scan(params: {
    auditRecords: SecurityAuditLedgerRecord[];
    secrets: SecretRotationRecord[];
    userRoles: string[];
  }): SecurityComplianceReport {
    const findings: SecurityScanFinding[] = [];
    let totalChecks = 0;
    let passedChecks = 0;

    // 1. Audit Ledger Cryptographic Integrity Check
    totalChecks++;
    const auditReport = CryptoAuditLedger.verifyChain(params.auditRecords);
    if (!auditReport.isValid) {
      findings.push({
        severity: 'CRITICAL',
        category: 'tamper_detected',
        description: `Audit ledger integrity failure at sequence #${auditReport.brokenHashAtSequence}: ${auditReport.details.join('; ')}`,
        remediation: 'Investigate potential unauthorized audit log tampering or database sequence corruption.',
      });
    } else {
      passedChecks++;
    }

    // 2. Secret Vault Grace Period Expiration Check
    totalChecks++;
    let unrevokedExpiredCount = 0;
    for (const secret of params.secrets) {
      if (secret.status === 'grace_period' && SecretRotationEngine.isExpired(secret.expires_at)) {
        unrevokedExpiredCount++;
      }
    }

    if (unrevokedExpiredCount > 0) {
      findings.push({
        severity: 'HIGH',
        category: 'secret_leakage',
        description: `Found ${unrevokedExpiredCount} secret(s) in grace_period past their expiration deadline.`,
        remediation: 'Trigger automated revocation on expired grace-period secrets.',
      });
    } else {
      passedChecks++;
    }

    // 3. RBAC Privilege Escalation Check
    totalChecks++;
    const invalidRoles = params.userRoles.filter(
      (r) => !['owner', 'admin', 'operations_manager', 'sales_manager', 'support_manager', 'analyst', 'finance', 'security_admin', 'compliance_officer', 'agent_operator', 'read_only', 'system'].includes(r)
    );

    if (invalidRoles.length > 0) {
      findings.push({
        severity: 'CRITICAL',
        category: 'privilege_escalation',
        description: `Unauthorized or unrecognized RBAC roles detected: [${invalidRoles.join(', ')}].`,
        remediation: 'Prune unrecognized role assignments and enforce strict RBAC role whitelist.',
      });
    } else {
      passedChecks++;
    }

    const status = findings.length === 0 ? 'COMPLIANT' : 'VULNERABILITY_DETECTED';

    return {
      status,
      totalChecks,
      passedChecks,
      findings,
      scanTimestamp: new Date().toISOString(),
    };
  }
}
