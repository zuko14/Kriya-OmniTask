/**
 * Kriya AI — Secret & Key Rotation Engine
 * Versioned secret rotation with zero-downtime grace period transition (§14, §20 of CLAUDE.md).
 */

import { SecretRotationRecord, SecretStatus } from '../types/securityHardeningTypes.js';
import { CryptoUtils } from '../../../core/utils/crypto.js';
import { ValidationError } from '../../../core/errors/errors.js';

export class SecretRotationEngine {
  public static readonly MINIMUM_ENTROPY_BITS = 256;

  /**
   * Calculates estimated Shannon entropy in bits for a given secret string.
   */
  public static calculateEntropyBits(secretValue: string): number {
    if (!secretValue || secretValue.length === 0) return 0;

    // Check if it's a valid 64+ char hex string (32+ bytes = 256+ bits)
    if (/^[0-9a-fA-F]{64,}$/.test(secretValue)) {
      return (secretValue.length / 2) * 8;
    }

    // Check if it's a valid 44+ char base64 string
    if (/^[A-Za-z0-9+/=]{44,}$/.test(secretValue)) {
      try {
        const decoded = Buffer.from(secretValue, 'base64');
        if (decoded.length >= 32) {
          return decoded.length * 8;
        }
      } catch {
        // Fall back to Shannon entropy calculation
      }
    }

    const len = secretValue.length;
    const freqMap = new Map<string, number>();

    for (let i = 0; i < len; i++) {
      const char = secretValue[i];
      freqMap.set(char, (freqMap.get(char) || 0) + 1);
    }

    let entropyPerSymbol = 0;
    for (const count of freqMap.values()) {
      const p = count / len;
      entropyPerSymbol -= p * Math.log2(p);
    }

    return Math.round(entropyPerSymbol * len);
  }

  /**
   * Enforces minimum cryptographic entropy requirement (minimum 256-bit entropy).
   */
  public static validateEntropy(
    secretValue: string,
    minBits: number = SecretRotationEngine.MINIMUM_ENTROPY_BITS
  ): { valid: boolean; bits: number; reason?: string } {
    if (!secretValue || typeof secretValue !== 'string') {
      return { valid: false, bits: 0, reason: 'Secret value must be a non-empty string.' };
    }

    if (secretValue.length < 32) {
      return {
        valid: false,
        bits: secretValue.length * 4,
        reason: `Secret length (${secretValue.length} chars) is below the mandatory minimum of 32 characters (256 bits).`,
      };
    }

    const uniqueChars = new Set(secretValue).size;
    if (uniqueChars < 8) {
      return {
        valid: false,
        bits: uniqueChars * 8,
        reason: `Secret character diversity (${uniqueChars} unique characters) is too low to satisfy entropy requirements.`,
      };
    }

    const bits = SecretRotationEngine.calculateEntropyBits(secretValue);
    if (bits < minBits) {
      return {
        valid: false,
        bits,
        reason: `Secret entropy of ${bits} bits is below the mandatory threshold of ${minBits} bits.`,
      };
    }

    return { valid: true, bits };
  }

  /**
   * Plans and prepares a new version of a rotated secret.
   */
  public static planRotation(params: {
    secretName: string;
    newSecretValue: string;
    currentActiveRecord?: SecretRotationRecord | null;
    gracePeriodSeconds: number;
    encryptionKey: string;
  }): {
    newRecord: {
      secretName: string;
      secretVersion: number;
      status: SecretStatus;
      encryptedSecretValue: string;
      rotatedAt: string;
    };
    updatedPreviousRecord?: {
      id: string;
      status: SecretStatus;
      expiresAt: string;
    };
  } {
    // Validate minimum 256-bit entropy
    const entropyCheck = SecretRotationEngine.validateEntropy(params.newSecretValue);
    if (!entropyCheck.valid) {
      throw new ValidationError(
        `Secret does not satisfy minimum 256-bit entropy requirement: ${entropyCheck.reason}`
      );
    }

    const now = new Date();
    const rotatedAt = now.toISOString();
    const nextVersion = params.currentActiveRecord
      ? params.currentActiveRecord.secret_version + 1
      : 1;

    // Encrypt the new secret at rest with AES-256-GCM
    const encryptedSecretValue = JSON.stringify(
      CryptoUtils.encrypt(params.newSecretValue, params.encryptionKey)
    );

    const newRecord = {
      secretName: params.secretName,
      secretVersion: nextVersion,
      status: 'active' as SecretStatus,
      encryptedSecretValue,
      rotatedAt,
    };

    let updatedPreviousRecord: { id: string; status: SecretStatus; expiresAt: string } | undefined;
    if (params.currentActiveRecord) {
      const graceExpiresAt = new Date(now.getTime() + params.gracePeriodSeconds * 1000).toISOString();
      updatedPreviousRecord = {
        id: params.currentActiveRecord.id,
        status: 'grace_period' as SecretStatus,
        expiresAt: graceExpiresAt,
      };
    }

    return {
      newRecord,
      updatedPreviousRecord,
    };
  }

  /**
   * Evaluates whether a grace-period secret has expired and should be revoked.
   */
  public static isExpired(expiresAt?: string): boolean {
    if (!expiresAt) return false;
    return new Date(expiresAt).getTime() <= Date.now();
  }
}
