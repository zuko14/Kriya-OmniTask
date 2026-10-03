import { describe, it, expect } from 'vitest';
import { SecretRotationEngine } from '../../src/security/hardening/rotation/secretRotationEngine.js';
import { SecretRotationRecord } from '../../src/security/hardening/types/securityHardeningTypes.js';

describe('Secret & Key Rotation Engine Unit Tests', () => {
  const encKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  it('should plan initial secret creation and subsequent versioned rotations', () => {
    // 1. Initial version (v1) with >= 256-bit entropy (64 hex characters = 32 bytes)
    const plan1 = SecretRotationEngine.planRotation({
      secretName: 'WHATSAPP_ACCESS_TOKEN',
      newSecretValue: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
      gracePeriodSeconds: 3600,
      encryptionKey: encKey,
    });

    expect(plan1.newRecord.secretVersion).toBe(1);
    expect(plan1.newRecord.status).toBe('active');
    expect(plan1.newRecord.encryptedSecretValue).toBeDefined();
    expect(plan1.updatedPreviousRecord).toBeUndefined();

    // 2. Rotate to v2
    const currentActive: SecretRotationRecord = {
      id: 'sec_rec_1',
      tenant_id: 't_1',
      organization_id: 'default',
      secret_name: 'WHATSAPP_ACCESS_TOKEN',
      secret_version: 1,
      status: 'active',
      encrypted_secret_value: plan1.newRecord.encryptedSecretValue,
      rotated_at: plan1.newRecord.rotatedAt,
      created_at: plan1.newRecord.rotatedAt,
      updated_at: plan1.newRecord.rotatedAt,
    };

    const plan2 = SecretRotationEngine.planRotation({
      secretName: 'WHATSAPP_ACCESS_TOKEN',
      newSecretValue: 'f0e1d2c3b4a5968778695a4b3c2d1e0ff0e1d2c3b4a5968778695a4b3c2d1e0f',
      currentActiveRecord: currentActive,
      gracePeriodSeconds: 1800,
      encryptionKey: encKey,
    });

    expect(plan2.newRecord.secretVersion).toBe(2);
    expect(plan2.newRecord.status).toBe('active');
    expect(plan2.updatedPreviousRecord).toBeDefined();
    expect(plan2.updatedPreviousRecord?.status).toBe('grace_period');
    expect(plan2.updatedPreviousRecord?.expiresAt).toBeDefined();
  });

  it('should enforce minimum 256-bit entropy and reject weak secrets', () => {
    // Too short
    expect(() =>
      SecretRotationEngine.planRotation({
        secretName: 'API_KEY',
        newSecretValue: 'short_key',
        gracePeriodSeconds: 3600,
        encryptionKey: encKey,
      })
    ).toThrow('Secret does not satisfy minimum 256-bit entropy requirement');

    // Repeated low-entropy characters
    expect(() =>
      SecretRotationEngine.planRotation({
        secretName: 'API_KEY',
        newSecretValue: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        gracePeriodSeconds: 3600,
        encryptionKey: encKey,
      })
    ).toThrow('Secret does not satisfy minimum 256-bit entropy requirement');
  });

  it('should detect expired grace-period secrets', () => {
    const futureDate = new Date(Date.now() + 100000).toISOString();
    const pastDate = new Date(Date.now() - 100000).toISOString();

    expect(SecretRotationEngine.isExpired(futureDate)).toBe(false);
    expect(SecretRotationEngine.isExpired(pastDate)).toBe(true);
  });
});
