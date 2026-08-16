import { describe, it, expect } from 'vitest';
import { CryptoUtils } from '../../src/core/utils/crypto.js';

describe('Cryptography Utilities', () => {
  const secretKey = 'my_super_secret_encryption_key_32_bytes!';

  it('should generate valid UUID v4 tokens', () => {
    const id1 = CryptoUtils.generateId();
    const id2 = CryptoUtils.generateId();

    expect(id1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(id1).not.toBe(id2);
  });

  it('should encrypt and decrypt plaintext using AES-256-GCM', () => {
    const sensitiveData = JSON.stringify({
      apiKey: 'sk-prod-123456789',
      customerCreditCard: '4111-2222-3333-4444',
    });

    const encrypted = CryptoUtils.encrypt(sensitiveData, secretKey);
    expect(encrypted.iv).toBeDefined();
    expect(encrypted.tag).toBeDefined();
    expect(encrypted.data).toBeDefined();
    expect(encrypted.data).not.toContain('sk-prod');

    const decrypted = CryptoUtils.decrypt(encrypted, secretKey);
    expect(decrypted).toBe(sensitiveData);
  });

  it('should fail decryption when authentication tag or ciphertext is tampered with', () => {
    const encrypted = CryptoUtils.encrypt('confidential', secretKey);
    const tampered = { ...encrypted, data: encrypted.data.slice(0, -2) + 'aa' };

    expect(() => CryptoUtils.decrypt(tampered, secretKey)).toThrow();
  });

  it('should hash and verify passwords using PBKDF2 with salt', () => {
    const password = 'CorrectHorseBatteryStaple123!';
    const hash = CryptoUtils.hashPassword(password);

    expect(hash).toContain(':');
    expect(CryptoUtils.verifyPassword(password, hash)).toBe(true);
    expect(CryptoUtils.verifyPassword('WrongPassword123!', hash)).toBe(false);
  });

  it('should generate and verify HMAC-SHA256 signatures', () => {
    const payload = JSON.stringify({ event: 'lead.created', timestamp: 1720000000 });
    const signature = CryptoUtils.createHmacSignature(payload, secretKey);

    expect(CryptoUtils.verifyHmacSignature(payload, signature, secretKey)).toBe(true);
    expect(CryptoUtils.verifyHmacSignature(payload + 'tampered', signature, secretKey)).toBe(false);
  });
});
