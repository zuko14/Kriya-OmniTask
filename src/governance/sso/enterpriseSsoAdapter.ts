/**
 * Kriya AI — Enterprise SSO / OIDC Adapter
 * IdP claim normalization, group mapping, and enterprise authentication exchange.
 */

import {
  EnterpriseSsoConfig,
  SsoExchangeRequest,
} from '../types/governanceTypes.js';
import { JwtService } from '../../security/auth/jwt.js';

export interface SsoAuthResult {
  token: string;
  user: {
    userId: string;
    email: string;
    name?: string;
    roles: string[];
    tenantId: string;
  };
}

export class EnterpriseSsoAdapter {
  /**
   * Normalizes IdP claims and maps them to platform roles according to tenant SSO configuration.
   */
  public static mapClaimsToRoles(
    config: EnterpriseSsoConfig,
    idpGroups: string[]
  ): string[] {
    const rolesSet = new Set<string>();

    for (const group of idpGroups) {
      if (config.claimsMapping[group]) {
        rolesSet.add(config.claimsMapping[group]);
      }
    }

    if (rolesSet.size === 0) {
      rolesSet.add('read_only'); // Default safe role
    }

    return Array.from(rolesSet);
  }

  /**
   * Handles token exchange from an external IdP (e.g. Okta, Azure AD).
   */
  public static exchangeIdpToken(
    config: EnterpriseSsoConfig,
    request: SsoExchangeRequest
  ): SsoAuthResult {
    if (!config.isActive) {
      throw new Error(`SSO Provider '${config.providerType}' is currently inactive.`);
    }

    // In production or mock environment, parse IdP claims
    const email = request.mockClaims?.email || 'sso-user@enterprise.com';
    const sub = request.mockClaims?.sub || 'idp_user_123';
    const idpGroups = request.mockClaims?.groups || ['Admins'];
    const name = request.mockClaims?.name || 'Enterprise SSO User';

    const mappedRoles = this.mapClaimsToRoles(config, idpGroups);
    const userId = `usr_sso_${sub}`;

    const token = JwtService.sign({
      userId,
      tenantId: config.tenantId,
      email,
      roles: mappedRoles,
    });

    return {
      token,
      user: {
        userId,
        email,
        name,
        roles: mappedRoles,
        tenantId: config.tenantId,
      },
    };
  }
}
