/**
 * Kriya AI — Scoped API Key Authentication
 * Generates and validates machine-to-machine integration API keys.
 */

import { CryptoUtils } from '../../core/utils/crypto.js';
import { UnauthorizedError } from '../../core/errors/errors.js';

export interface ApiKeyClaims {
  tenantId: string;
  keyId: string;
  name: string;
  scopes: string[];
}

export class ApiKeyService {
  private static readonly PREFIX = 'xylarc_';

  /**
   * Generates a new cryptographically secure API key string.
   */
  public static generateApiKey(environment: 'live' | 'test' = 'live'): { rawKey: string; keyId: string; hashedKey: string } {
    const keyId = CryptoUtils.generateId();
    const entropy = CryptoUtils.generateSecureToken(32);
    const rawKey = `${this.PREFIX}${environment}_${keyId}_${entropy}`;
    const hashedKey = CryptoUtils.hashPassword(rawKey);

    return { rawKey, keyId, hashedKey };
  }

  /**
   * Parses the raw API key to extract the key ID and environment.
   */
  public static parseApiKey(rawKey: string): { environment: string; keyId: string } {
    if (!rawKey.startsWith(this.PREFIX)) {
      throw new UnauthorizedError('Invalid API key format');
    }

    const parts = rawKey.split('_');
    if (parts.length < 4) {
      throw new UnauthorizedError('Malformed API key structure');
    }

    const environment = parts[1];
    const keyId = parts[2];
    return { environment, keyId };
  }
}
