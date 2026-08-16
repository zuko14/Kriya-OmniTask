import { describe, it, expect } from 'vitest';
import { ZeroTrustScanner } from '../../src/security/hardening/scanner/zeroTrustScanner.js';
import { SecurityAuditLedgerRecord, SecretRotationRecord } from '../../src/security/hardening/types/securityHardeningTypes.js';
import { CryptoAuditLedger } from '../../src/security/hardening/ledger/cryptoAuditLedger.js';

describe('Zero-Trust Compliance Scanner Unit Tests', () => {
  it('should return COMPLIANT when audit ledger, secrets, and roles are fully valid', () => {
    const p1 = { action: 'INIT' };
    const h1 = CryptoAuditLedger.computePayloadHash(p1);
    const curr1 = CryptoAuditLedger.computeCurrentHash({
      sequenceNumber: 1,
      eventType: 'INIT',
      actorId: 'system',
      actorRole: 'admin',
      targetResource: 'system',
      action: 'BOOTSTRAP',
      payloadHash: h1,
      previousHash: CryptoAuditLedger.GENESIS_HASH,
    });

    const auditRecords: SecurityAuditLedgerRecord[] = [
      {
        id: 'aud_1',
        tenant_id: 't_1',
        organization_id: 'default',
        sequence_number: 1,
        event_type: 'INIT',
        actor_id: 'system',
        actor_role: 'admin',
        target_resource: 'system',
        action: 'BOOTSTRAP',
        payload_hash: h1,
        previous_hash: CryptoAuditLedger.GENESIS_HASH,
        current_hash: curr1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    const secrets: SecretRotationRecord[] = [
      {
        id: 'sec_1',
        tenant_id: 't_1',
        organization_id: 'default',
        secret_name: 'TEST_SECRET',
        secret_version: 1,
        status: 'active',
        encrypted_secret_value: 'enc_val',
        rotated_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    const report = ZeroTrustScanner.scan({
      auditRecords,
      secrets,
      userRoles: ['admin', 'security_admin'],
    });

    expect(report.status).toBe('COMPLIANT');
    expect(report.findings.length).toBe(0);
    expect(report.passedChecks).toBe(3);
  });

  it('should flag privilege escalation when unauthorized roles are encountered', () => {
    const report = ZeroTrustScanner.scan({
      auditRecords: [],
      secrets: [],
      userRoles: ['admin', 'SUPER_ROOT_UNAUTHORIZED'],
    });

    expect(report.status).toBe('VULNERABILITY_DETECTED');
    expect(report.findings.some((f) => f.category === 'privilege_escalation')).toBe(true);
  });
});
