import { describe, it, expect } from 'vitest';
import { CryptoAuditLedger } from '../../src/security/hardening/ledger/cryptoAuditLedger.js';
import { SecurityAuditLedgerRecord } from '../../src/security/hardening/types/securityHardeningTypes.js';

describe('Cryptographically Chained Audit Ledger Unit Tests', () => {
  it('should compute deterministic hashes and verify valid continuous audit chains', () => {
    const p1 = { action: 'USER_LOGIN', ip: '127.0.0.1' };
    const h1 = CryptoAuditLedger.computePayloadHash(p1);
    const curr1 = CryptoAuditLedger.computeCurrentHash({
      sequenceNumber: 1,
      eventType: 'AUTH',
      actorId: 'usr_1',
      actorRole: 'admin',
      targetResource: 'system',
      action: 'LOGIN',
      payloadHash: h1,
      previousHash: CryptoAuditLedger.GENESIS_HASH,
    });

    const record1: SecurityAuditLedgerRecord = {
      id: 'rec_1',
      tenant_id: 't_1',
      organization_id: 'default',
      sequence_number: 1,
      event_type: 'AUTH',
      actor_id: 'usr_1',
      actor_role: 'admin',
      target_resource: 'system',
      action: 'LOGIN',
      payload_hash: h1,
      previous_hash: CryptoAuditLedger.GENESIS_HASH,
      current_hash: curr1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const p2 = { action: 'UPDATE_POLICY', policyId: 'pol_1' };
    const h2 = CryptoAuditLedger.computePayloadHash(p2);
    const curr2 = CryptoAuditLedger.computeCurrentHash({
      sequenceNumber: 2,
      eventType: 'POLICY',
      actorId: 'usr_1',
      actorRole: 'admin',
      targetResource: 'policy:pol_1',
      action: 'UPDATE',
      payloadHash: h2,
      previousHash: curr1,
    });

    const record2: SecurityAuditLedgerRecord = {
      id: 'rec_2',
      tenant_id: 't_1',
      organization_id: 'default',
      sequence_number: 2,
      event_type: 'POLICY',
      actor_id: 'usr_1',
      actor_role: 'admin',
      target_resource: 'policy:pol_1',
      action: 'UPDATE',
      payload_hash: h2,
      previous_hash: curr1,
      current_hash: curr2,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const verify = CryptoAuditLedger.verifyChain([record1, record2]);
    expect(verify.isValid).toBe(true);
    expect(verify.totalEventsChecked).toBe(2);
    expect(verify.tamperedEventsCount).toBe(0);
    expect(verify.lastValidSequence).toBe(2);
  });

  it('should detect tampering when an audit record payload or hash is illegally modified', () => {
    const p1 = { action: 'USER_LOGIN' };
    const h1 = CryptoAuditLedger.computePayloadHash(p1);
    const curr1 = CryptoAuditLedger.computeCurrentHash({
      sequenceNumber: 1,
      eventType: 'AUTH',
      actorId: 'usr_1',
      actorRole: 'admin',
      targetResource: 'system',
      action: 'LOGIN',
      payloadHash: h1,
      previousHash: CryptoAuditLedger.GENESIS_HASH,
    });

    const record1: SecurityAuditLedgerRecord = {
      id: 'rec_1',
      tenant_id: 't_1',
      organization_id: 'default',
      sequence_number: 1,
      event_type: 'AUTH',
      actor_id: 'usr_1',
      actor_role: 'admin',
      target_resource: 'system',
      action: 'LOGIN',
      payload_hash: 'TAMPERED_HASH', // Tampered!
      previous_hash: CryptoAuditLedger.GENESIS_HASH,
      current_hash: curr1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const verify = CryptoAuditLedger.verifyChain([record1]);
    expect(verify.isValid).toBe(false);
    expect(verify.tamperedEventsCount).toBe(1);
    expect(verify.brokenHashAtSequence).toBe(1);
  });
});
