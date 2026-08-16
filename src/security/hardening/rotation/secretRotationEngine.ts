/**
 * Xylarc AI — Secret & Key Rotation Engine
 * Versioned secret rotation with zero-downtime grace period transition (§14, §20 of CLAUDE.md).
 */

import { SecretRotationRecord, SecretStatus } from '../types/securityHardeningTypes.js';
import { CryptoUtils } from '../../../core/utils/crypto.js';

export class SecretRotationEngine {
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
