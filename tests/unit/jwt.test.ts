import { describe, it, expect } from 'vitest';
import { JwtService } from '../../src/security/auth/jwt.js';
import { UnauthorizedError } from '../../src/core/errors/errors.js';

describe('JWT Authentication Service', () => {
  it('should sign and verify valid JWT access tokens', () => {
    const payload = {
      userId: 'usr-123',
      tenantId: 'tenant-acme',
      organizationId: 'org-main',
      roles: ['admin'],
      email: 'admin@acme.com',
    };

    const token = JwtService.sign(payload, 3600);
    expect(typeof token).toBe('string');
    expect(token.split('.').length).toBe(3);

    const verified = JwtService.verify(token);
    expect(verified.userId).toBe('usr-123');
    expect(verified.tenantId).toBe('tenant-acme');
    expect(verified.roles).toContain('admin');
    expect(verified.email).toBe('admin@acme.com');
  });

  it('should reject tampered JWT signatures', () => {
    const token = JwtService.sign({
      userId: 'usr-1',
      tenantId: 't-1',
      roles: ['owner'],
      email: 'user@t.com',
    });

    const parts = token.split('.');
    // Tamper with payload
    const tampered = `${parts[0]}.${parts[1]}abc.${parts[2]}`;
    expect(() => JwtService.verify(tampered)).toThrow(UnauthorizedError);
  });

  it('should reject expired JWT tokens', async () => {
    const token = JwtService.sign(
      { userId: 'usr-exp', tenantId: 't-exp', roles: ['read_only'], email: 'exp@t.com' },
      -10 // Expired 10 seconds ago
    );

    expect(() => JwtService.verify(token)).toThrow(UnauthorizedError);
  });
});
