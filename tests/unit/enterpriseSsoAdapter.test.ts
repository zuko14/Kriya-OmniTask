import { describe, it, expect } from 'vitest';
import { EnterpriseSsoAdapter } from '../../src/governance/sso/enterpriseSsoAdapter.js';
import { EnterpriseSsoConfig } from '../../src/governance/types/governanceTypes.js';

describe('EnterpriseSsoAdapter Unit Tests', () => {
  const config: EnterpriseSsoConfig = {
    id: 'sso_okta_1',
    tenantId: 'tenant_1',
    providerType: 'okta',
    issuerUrl: 'https://enterprise.okta.com/oauth2/default',
    clientId: 'okta_client_id_123',
    claimsMapping: {
      'Corporate-Admins': 'admin',
      'Finance-Managers': 'finance_manager',
      'Operations-Leads': 'operations_manager',
    },
    enforceSso: true,
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  it('should map IdP groups to platform roles correctly', () => {
    const roles = EnterpriseSsoAdapter.mapClaimsToRoles(config, ['Corporate-Admins', 'Finance-Managers']);
    expect(roles).toContain('admin');
    expect(roles).toContain('finance_manager');
    expect(roles.length).toBe(2);
  });

  it('should fallback to read_only role when no mapped groups match', () => {
    const roles = EnterpriseSsoAdapter.mapClaimsToRoles(config, ['Unknown-Group-X']);
    expect(roles).toEqual(['read_only']);
  });

  it('should exchange IdP token claims for platform session token', () => {
    const auth = EnterpriseSsoAdapter.exchangeIdpToken(config, {
      providerType: 'okta',
      idTokenOrAssertion: 'mock_jwt_assertion_string',
      mockClaims: {
        email: 'cfo@enterprise.com',
        sub: 'okta_usr_456',
        groups: ['Finance-Managers'],
        name: 'Enterprise CFO',
      },
    });

    expect(auth.token).toBeDefined();
    expect(auth.user.email).toBe('cfo@enterprise.com');
    expect(auth.user.roles).toContain('finance_manager');
    expect(auth.user.tenantId).toBe('tenant_1');
  });
});
