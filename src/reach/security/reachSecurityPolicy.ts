/**
 * Kriya Omnitask — Reach Browser Security Policy Engine (WP-5.5, Blueprint §10, §15, ADR-022)
 *
 * Enforces strict domain allowlists, action allowlists, anti-SSRF protections,
 * and protocol sanitization for all browser interactions.
 */

import { BrowserAction, BrowserActionType, ReachSecurityViolationError } from '../types/reachTypes.js';
import { SSRFGuard } from '../../security/ssrf/ssrfGuard.js';

export class ReachSecurityPolicy {
  // Disallowed and internal IP regexes (IPv4 and IPv6)
  private static readonly LOCALHOST_NAMES = new Set(['localhost', 'localhost.localdomain', 'ip6-localhost', 'ip6-loopback']);

  /**
   * Validates a target URL against the tenant's domain allowlist and anti-SSRF rules.
   */
  public static validateUrl(
    targetUrl: string,
    allowedDomains: string[]
  ): { valid: boolean; normalizedUrl: string; domain: string } {
    if (!targetUrl || typeof targetUrl !== 'string') {
      throw new ReachSecurityViolationError('Target URL must be a non-empty string.');
    }

    let parsed: URL;
    try {
      parsed = new URL(targetUrl);
    } catch {
      throw new ReachSecurityViolationError(`Invalid URL format: '${targetUrl}'`);
    }

    // Protocol check: strictly HTTP or HTTPS
    const protocol = parsed.protocol.toLowerCase();
    if (protocol !== 'http:' && protocol !== 'https:') {
      throw new ReachSecurityViolationError(
        `Disallowed URL protocol '${protocol}'. Reach browser tool only permits 'http:' and 'https:'.`
      );
    }

    const hostname = parsed.hostname.toLowerCase();

    // SSRF & Localhost Protection
    if (ReachSecurityPolicy.isPrivateOrReservedHost(hostname)) {
      throw new ReachSecurityViolationError(
        `Navigation to private, loopback, or cloud metadata address '${hostname}' is strictly prohibited.`
      );
    }

    // Domain Allowlist matching
    if (!allowedDomains || allowedDomains.length === 0) {
      throw new ReachSecurityViolationError(
        'Reach session configuration must specify at least one allowed domain.'
      );
    }

    const domainMatched = allowedDomains.some((pattern) =>
      ReachSecurityPolicy.matchesDomainPattern(hostname, pattern)
    );

    if (!domainMatched) {
      throw new ReachSecurityViolationError(
        `Domain '${hostname}' is not permitted by Reach security policy (allowed: ${allowedDomains.join(', ')}).`,
        { hostname, allowedDomains }
      );
    }

    return {
      valid: true,
      normalizedUrl: parsed.toString(),
      domain: hostname,
    };
  }

  /**
   * Validates whether a browser action is allowed by policy.
   */
  public static validateAction(
    action: BrowserAction,
    allowedActions?: BrowserActionType[]
  ): void {
    if (!action || !action.type) {
      throw new ReachSecurityViolationError('Action must specify a valid action type.');
    }

    if (allowedActions && allowedActions.length > 0) {
      if (!allowedActions.includes(action.type)) {
        throw new ReachSecurityViolationError(
          `Action '${action.type}' is forbidden by Reach action allowlist (allowed: ${allowedActions.join(', ')}).`,
          { actionType: action.type, allowedActions }
        );
      }
    }
  }

  /**
   * Tests if a domain matches a wildcard or exact domain pattern.
   * Examples:
   *   '*.example.com' matches 'portal.example.com', 'a.b.example.com', and 'example.com'
   *   'example.com' matches 'example.com'
   */
  public static matchesDomainPattern(hostname: string, pattern: string): boolean {
    const normHost = hostname.toLowerCase().trim();
    const normPat = pattern.toLowerCase().trim();

    if (normPat === '*' || normPat === normHost) {
      return true;
    }

    if (normPat.startsWith('*.')) {
      const baseDomain = normPat.slice(2);
      if (normHost === baseDomain) return true;
      if (normHost.endsWith(`.${baseDomain}`)) return true;
    }

    return false;
  }

  /**
   * Determines if a host is localhost, private IP, link-local, or cloud metadata.
   */
  public static isPrivateOrReservedHost(hostname: string): boolean {
    return SSRFGuard.isPrivateOrReservedHost(hostname);
  }
}
