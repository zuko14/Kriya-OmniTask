import { describe, it, expect } from 'vitest';
import { ApiKeyService } from '../../src/security/auth/apiKey.js';

describe('API Key Service', () => {
  it('should generate valid live and test API keys with hash', () => {
    const liveKey = ApiKeyService.generateApiKey('live');
    expect(liveKey.rawKey.startsWith('xylarc_live_')).toBe(true);
    expect(liveKey.keyId).toBeDefined();
    expect(liveKey.hashedKey).toContain(':');

    const testKey = ApiKeyService.generateApiKey('test');
    expect(testKey.rawKey.startsWith('xylarc_test_')).toBe(true);
  });

  it('should parse API key components accurately', () => {
    const key = ApiKeyService.generateApiKey('live');
    const parsed = ApiKeyService.parseApiKey(key.rawKey);

    expect(parsed.environment).toBe('live');
    expect(parsed.keyId).toBe(key.keyId);
  });
});
