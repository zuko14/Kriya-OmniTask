/**
 * Kriya AI — Idempotency Manager Engine
 * Cryptographic request deduplication, concurrent lock assertion, and atomic response caching.
 */

import { CryptoUtils } from '../../core/utils/crypto.js';
import { sha256Canonical } from '../../core/utils/canonicalJson.js';
import { IdempotencyRecord } from '../types/reliabilityTypes.js';
import { ConflictError } from '../../core/errors/errors.js';

export class IdempotencyManager {
  /**
   * Computes a deterministic SHA-256 canonical hash of the request payload.
   */
  public static computePayloadHash(payload: Record<string, unknown>): string {
    // Canonical at every depth (docs/kriya S32): the old key-array replacer dropped nested fields,
    // so different requests sharing an idempotency key looked identical.
    return sha256Canonical(payload);
  }

  /**
   * Evaluates whether an incoming request can proceed under idempotency constraints.
   */
  public static evaluateExistingKey(
    existing: IdempotencyRecord | null,
    currentPayloadHash: string
  ): {
    canExecute: boolean;
    cachedResponse?: Record<string, unknown>;
  } {
    if (!existing) {
      return { canExecute: true };
    }

    const now = new Date().toISOString();
    if (existing.expiresAt < now) {
      // Key expired, allow fresh execution
      return { canExecute: true };
    }

    if (existing.status === 'completed' && existing.responsePayload) {
      if (existing.requestHash !== currentPayloadHash) {
        throw new ConflictError(
          `Idempotency key '${existing.idempotencyKey}' was previously executed with a different request payload hash.`
        );
      }
      return {
        canExecute: false,
        cachedResponse: JSON.parse(existing.responsePayload),
      };
    }

    if (existing.status === 'in_progress') {
      throw new ConflictError(
        `Idempotent operation for key '${existing.idempotencyKey}' is currently in progress. Duplicate concurrent requests blocked.`
      );
    }

    // If previously failed, allow retry
    return { canExecute: true };
  }
}
