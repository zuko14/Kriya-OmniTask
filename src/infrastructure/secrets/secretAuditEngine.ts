/**
 * Kriya AI — Secret Inventory & Entropy Audit Engine
 * Evaluates environment configuration and credentials using Shannon entropy and known signature heuristics.
 */

import { SecretAuditItem, SecretAuditReport } from '../types/infrastructureTypes.js';

export class SecretAuditEngine {
  /**
   * Calculates the Shannon entropy of a string (higher value = more random/cryptographic).
   */
  public static calculateEntropy(str: string): number {
    if (!str || str.length === 0) return 0;
    const len = str.length;
    const frequencies: Record<string, number> = {};

    for (let i = 0; i < len; i++) {
      const char = str[i];
      frequencies[char] = (frequencies[char] || 0) + 1;
    }

    let entropy = 0;
    for (const char in frequencies) {
      const p = frequencies[char] / len;
      entropy -= p * Math.log2(p);
    }

    return Math.round(entropy * 100) / 100;
  }

  /**
   * Audits a dictionary of configuration or environment variables.
   */
  public static auditEnvironmentSecrets(
    envRecord: Record<string, string | undefined>,
    reportId: string
  ): SecretAuditReport {
    const findings: SecretAuditItem[] = [];
    let scannedCount = 0;

    const SENSITIVE_KEY_PATTERNS = [
      /KEY/i,
      /SECRET/i,
      /TOKEN/i,
      /PASSWORD/i,
      /PRIVATE/i,
      /AUTH/i,
      /DATABASE_URL/i,
    ];

    for (const [key, value] of Object.entries(envRecord)) {
      if (!value || typeof value !== 'string') continue;
      scannedCount++;

      const isSensitiveKey = SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
      const entropy = this.calculateEntropy(value);
      const isPlaintextLeak = value.length > 8 && !value.startsWith('enc:') && !value.includes('***');

      // 1. Check for specific secret patterns
      if (value.startsWith('sk-') || value.startsWith('AKIA') || value.startsWith('xoxb-') || value.startsWith('ghp_')) {
        findings.push({
          keyName: key,
          location: 'environment_variables',
          entropyScore: entropy,
          isMasked: false,
          riskLevel: 'CRITICAL',
          vulnerability: 'Live API token or AWS key stored unencrypted/unmasked',
          recommendation: 'Rotate key immediately and inject via encrypted vault or AWS Secrets Manager / Vault.',
        });
      } else if (isSensitiveKey && isPlaintextLeak && entropy >= 3.2) {
        findings.push({
          keyName: key,
          location: 'environment_variables',
          entropyScore: entropy,
          isMasked: false,
          riskLevel: entropy >= 4.0 ? 'HIGH' : 'MEDIUM',
          vulnerability: `High-entropy sensitive secret detected in plaintext (Entropy: ${entropy})`,
          recommendation: 'Ensure secret is referenced via KMS/Vault and masked in runtime telemetry logs.',
        });
      }
    }

    return {
      id: reportId,
      scanType: 'config_env',
      secretsScannedCount: scannedCount,
      vulnerabilitiesFoundCount: findings.length,
      findings,
      scannedAt: new Date().toISOString(),
    };
  }
}
