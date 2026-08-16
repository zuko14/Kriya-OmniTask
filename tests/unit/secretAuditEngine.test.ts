import { describe, it, expect } from 'vitest';
import { SecretAuditEngine } from '../../src/infrastructure/secrets/secretAuditEngine.js';

describe('SecretAuditEngine Unit Tests', () => {
  it('should compute Shannon entropy accurately', () => {
    // Monotonous repeated string has very low entropy
    const lowEntropy = SecretAuditEngine.calculateEntropy('aaaaaaaaaaaaaaaa');
    expect(lowEntropy).toBe(0);

    // Cryptographic / random string has high entropy
    const highEntropy = SecretAuditEngine.calculateEntropy('d8F#9xL@2qZ!5mK$7wP&0vT*');
    expect(highEntropy).toBeGreaterThan(4.0);
  });

  it('should detect live API token signatures and high-entropy sensitive keys', () => {
    const mockEnv = {
      NODE_ENV: 'production',
      PORT: '3000',
      OPENAI_API_KEY: 'sk-proj-998877665544332211aabbccddeeff',
      AWS_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      PUBLIC_APP_NAME: 'Xylarc AI',
    };

    const report = SecretAuditEngine.auditEnvironmentSecrets(mockEnv, 'audit_report_test');
    expect(report.id).toBe('audit_report_test');
    expect(report.secretsScannedCount).toBe(5);
    expect(report.vulnerabilitiesFoundCount).toBeGreaterThanOrEqual(2);

    const openaiFinding = report.findings.find((f) => f.keyName === 'OPENAI_API_KEY');
    expect(openaiFinding).toBeDefined();
    expect(openaiFinding?.riskLevel).toBe('CRITICAL');

    const awsFinding = report.findings.find((f) => f.keyName === 'AWS_SECRET_ACCESS_KEY');
    expect(awsFinding).toBeDefined();
    expect(awsFinding?.entropyScore).toBeGreaterThan(3.5);
  });
});
