import { describe, it, expect } from 'vitest';
import { config, ConfigSchema } from '../../src/core/config/config.js';

describe('Configuration Manager', () => {
  it('should load valid default configuration', () => {
    expect(config.get('PORT')).toBe(3000);
    expect(config.get('DB_DRIVER')).toBe('sqlite');
    expect(config.get('TENANT_ISOLATION_STRICT')).toBe(true);
    expect(config.get('MAX_AGENT_DELEGATION_DEPTH')).toBe(5);
  });

  it('should redact sensitive keys in getRedacted()', () => {
    const redacted = config.getRedacted();
    expect(redacted.JWT_SECRET).toBe('[REDACTED]');
    expect(redacted.ENCRYPTION_KEY).toBe('[REDACTED]');
  });

  it('should validate and reject invalid configurations', () => {
    const invalidConfig = {
      PORT: -10, // Invalid port
      LOG_LEVEL: 'super_loud', // Invalid log level
    };

    const result = ConfigSchema.safeParse(invalidConfig);
    expect(result.success).toBe(false);
  });
});
