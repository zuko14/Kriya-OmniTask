/**
 * Kriya AI — Cryptographically Chained Tamper-Evident Audit Ledger
 * SHA-256 chained hash log and cryptographic tamper detection (§14, §20 of CLAUDE.md).
 */

import { createHash } from 'node:crypto';
import { sha256Canonical } from '../../../core/utils/canonicalJson.js';
import {
  SecurityAuditLedgerRecord,
  AuditLedgerVerificationReport,
} from '../types/securityHardeningTypes.js';

export class CryptoAuditLedger {
  public static readonly GENESIS_HASH = '0'.repeat(64);

  /**
   * Computes deterministic SHA-256 hash of a payload object.
   */
  public static computePayloadHash(payload: Record<string, unknown>): string {
    // Canonical at every depth (docs/kriya S32): the old key-array replacer dropped nested fields.
    return sha256Canonical(payload);
  }

  /**
   * Computes the current chained hash linking metadata, payload hash, and previous hash.
   */
  public static computeCurrentHash(params: {
    sequenceNumber: number;
    eventType: string;
    actorId: string;
    actorRole: string;
    targetResource: string;
    action: string;
    payloadHash: string;
    previousHash: string;
  }): string {
    const raw = `${params.sequenceNumber}|${params.eventType}|${params.actorId}|${params.actorRole}|${params.targetResource}|${params.action}|${params.payloadHash}|${params.previousHash}`;
    return createHash('sha256').update(raw).digest('hex');
  }

  /**
   * Verifies the cryptographic chain integrity of a sequential list of audit records.
   */
  public static verifyChain(records: SecurityAuditLedgerRecord[]): AuditLedgerVerificationReport {
    if (!records || records.length === 0) {
      return {
        isValid: true,
        totalEventsChecked: 0,
        tamperedEventsCount: 0,
        lastValidSequence: 0,
        details: ['Audit ledger is empty.'],
      };
    }

    let expectedPreviousHash = this.GENESIS_HASH;
    let expectedSequence = 1;
    let tamperedEventsCount = 0;
    let lastValidSequence = 0;
    let brokenHashAtSequence: number | undefined;
    const details: string[] = [];

    for (const record of records) {
      // 1. Sequence Continuity Check
      if (record.sequence_number !== expectedSequence) {
        tamperedEventsCount++;
        if (brokenHashAtSequence === undefined) brokenHashAtSequence = record.sequence_number;
        details.push(
          `Sequence break at record #${record.sequence_number}: expected sequence #${expectedSequence}.`
        );
        break;
      }

      // 2. Previous Hash Link Check
      if (record.previous_hash !== expectedPreviousHash) {
        tamperedEventsCount++;
        if (brokenHashAtSequence === undefined) brokenHashAtSequence = record.sequence_number;
        details.push(
          `Broken hash chain at sequence #${record.sequence_number}: previous_hash mismatch.`
        );
        break;
      }

      // 3. Current Hash Recomputation Check
      const recomputedHash = this.computeCurrentHash({
        sequenceNumber: record.sequence_number,
        eventType: record.event_type,
        actorId: record.actor_id,
        actorRole: record.actor_role,
        targetResource: record.target_resource,
        action: record.action,
        payloadHash: record.payload_hash,
        previousHash: record.previous_hash,
      });

      if (recomputedHash !== record.current_hash) {
        tamperedEventsCount++;
        if (brokenHashAtSequence === undefined) brokenHashAtSequence = record.sequence_number;
        details.push(
          `Tampered record detected at sequence #${record.sequence_number}: current_hash signature invalid.`
        );
        break;
      }

      lastValidSequence = record.sequence_number;
      expectedPreviousHash = record.current_hash;
      expectedSequence++;
    }

    const isValid = tamperedEventsCount === 0;
    if (isValid) {
      details.push(`All ${records.length} audit ledger events cryptographically verified without tampering.`);
    }

    return {
      isValid,
      totalEventsChecked: records.length,
      tamperedEventsCount,
      lastValidSequence,
      brokenHashAtSequence,
      details,
    };
  }
}
