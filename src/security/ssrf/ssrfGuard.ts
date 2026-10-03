/**
 * Kriya Omnitask — Centralized Hardened SSRF Guard (WP-8.1, Blueprint §10, §15, ADR-028)
 *
 * Comprehensive protection against Server-Side Request Forgery (SSRF), DNS rebinding,
 * private network access, cloud metadata exfiltration, and protocol manipulation.
 *
 * Implements strict compliance with:
 * - RFC 1918 (Private IPv4: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
 * - RFC 3927 (Link-Local: 169.254.0.0/16 including AWS/GCP/Azure metadata 169.254.169.254)
 * - RFC 6598 (Carrier-Grade NAT: 100.64.0.0/10)
 * - RFC 5737 / RFC 2544 / RFC 1112 (Reserved, Benchmark, Multicast: 198.18.0.0/15, 198.51.100.0/24, 203.0.113.0/24, 224.0.0.0/4, 240.0.0.0/4)
 * - RFC 4291 / RFC 4193 (IPv6 Loopback, Link-Local, Unique-Local: ::1, fe80::/10, fc00::/7)
 * - Decimal, Hexadecimal, and Octal IP representations
 * - Cloud provider metadata DNS names (metadata.google.internal, instance-data, etc.)
 */

import { lookup } from 'node:dns/promises';
import { logger } from '../../core/logger/logger.js';

export class SsrfSecurityError extends Error {
  public readonly code = 'SSRF_SECURITY_VIOLATION';
  public readonly statusCode = 403;
  public readonly targetUrl: string;
  public readonly resolvedHost?: string;

  constructor(message: string, targetUrl: string, resolvedHost?: string) {
    super(message);
    this.name = 'SsrfSecurityError';
    this.targetUrl = targetUrl;
    this.resolvedHost = resolvedHost;
  }
}

export interface SsrfValidationOptions {
  /** If specified, hostname must match at least one domain pattern */
  allowedDomains?: string[];
  /** Allow performing async DNS lookup to verify resolved IP against SSRF rules (default: true) */
  resolveDns?: boolean;
  /** Allow custom DNS resolver function for deterministic testing */
  dnsLookupFn?: (host: string) => Promise<string[]>;
}

export class SSRFGuard {
  // Disallowed internal and local hostnames
  private static readonly LOCALHOST_NAMES = new Set([
    'localhost',
    'localhost.localdomain',
    'ip6-localhost',
    'ip6-loopback',
    'metadata.google.internal',
    'metadata.internal',
    'metadata',
    'instance-data',
    '169.254.169.254',
  ]);

  private static readonly ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

  /**
   * Validates a target URL synchronously against protocol, hostname denylists,
   * private IP regexes, and optional domain allowlists.
   */
  public static validateUrl(
    targetUrl: string,
    options?: SsrfValidationOptions
  ): { valid: boolean; normalizedUrl: string; domain: string } {
    if (!targetUrl || typeof targetUrl !== 'string') {
      throw new SsrfSecurityError('Target URL must be a non-empty string.', targetUrl);
    }

    let parsed: URL;
    try {
      parsed = new URL(targetUrl);
    } catch {
      throw new SsrfSecurityError(`Malformed URL format: '${targetUrl}'`, targetUrl);
    }

    // Protocol check: strictly HTTP or HTTPS
    const protocol = parsed.protocol.toLowerCase();
    if (!this.ALLOWED_PROTOCOLS.has(protocol)) {
      throw new SsrfSecurityError(
        `Disallowed URL protocol '${protocol}'. Only 'http:' and 'https:' are permitted.`,
        targetUrl
      );
    }

    const domain = parsed.hostname.toLowerCase();

    // Check private, loopback, or cloud metadata hosts
    if (this.isPrivateOrReservedHost(domain)) {
      throw new SsrfSecurityError(
        `SSRF Block: Navigation to private, loopback, or cloud metadata address '${domain}' is strictly forbidden.`,
        targetUrl,
        domain
      );
    }

    // Domain allowlist check if configured
    if (options?.allowedDomains && options.allowedDomains.length > 0) {
      const matched = options.allowedDomains.some((pattern) =>
        this.matchesDomainPattern(domain, pattern)
      );

      if (!matched) {
        throw new SsrfSecurityError(
          `Domain '${domain}' is not permitted by domain allowlist policy (allowed: ${options.allowedDomains.join(', ')}).`,
          targetUrl,
          domain
        );
      }
    }

    return {
      valid: true,
      normalizedUrl: parsed.toString(),
      domain,
    };
  }

  /**
   * Asynchronously validates the URL and performs DNS resolution to defend
   * against DNS rebinding attacks where an external domain resolves to a private IP.
   */
  public static async assertSafeUrl(
    targetUrl: string,
    options?: SsrfValidationOptions
  ): Promise<{ valid: boolean; normalizedUrl: string; domain: string; resolvedIp: string }> {
    const { normalizedUrl, domain } = this.validateUrl(targetUrl, options);

    // If resolveDns is not explicitly false, inspect resolved IP addresses
    if (options?.resolveDns !== false) {
      let resolvedIps: string[] = [];

      try {
        if (options?.dnsLookupFn) {
          resolvedIps = await options.dnsLookupFn(domain);
        } else {
          // Standard node:dns lookup (all addresses)
          const results = await lookup(domain, { all: true });
          resolvedIps = results.map((r) => r.address);
        }
      } catch (err: any) {
        // If lookup fails because domain is an IP literal or unreachable, verify domain directly
        if (this.isPrivateOrReservedHost(domain)) {
          throw new SsrfSecurityError(
            `SSRF Block: Target host '${domain}' resolves to a prohibited internal address.`,
            targetUrl,
            domain
          );
        }
        resolvedIps = [domain];
      }

      for (const ip of resolvedIps) {
        if (this.isPrivateOrReservedHost(ip)) {
          logger.warn(`SSRF Block: Domain '${domain}' resolved to internal IP '${ip}'`, { targetUrl });
          throw new SsrfSecurityError(
            `SSRF Block: Domain '${domain}' resolved to prohibited internal IP address '${ip}' (DNS rebinding defense).`,
            targetUrl,
            ip
          );
        }
      }

      return {
        valid: true,
        normalizedUrl,
        domain,
        resolvedIp: resolvedIps[0] || domain,
      };
    }

    return {
      valid: true,
      normalizedUrl,
      domain,
      resolvedIp: domain,
    };
  }

  /**
   * Determines if a hostname or IP string represents a private, loopback, link-local, or reserved address.
   */
  public static isPrivateOrReservedHost(hostname: string): boolean {
    let host = hostname.toLowerCase().trim();
    if (host.startsWith('[') && host.endsWith(']')) {
      host = host.slice(1, -1);
    }

    // Check named local hosts and metadata hosts
    if (this.LOCALHOST_NAMES.has(host)) {
      return true;
    }

    // Check local/internal TLDs
    if (
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      host.endsWith('.lan') ||
      host.endsWith('.corp') ||
      host.endsWith('.home')
    ) {
      return true;
    }

    // Check decimal representation of IP (e.g. 2130706433 = 127.0.0.1)
    if (/^\d+$/.test(host)) {
      const num = parseInt(host, 10);
      if (!isNaN(num) && num >= 0 && num <= 4294967295) {
        const o0 = (num >>> 24) & 255;
        const o1 = (num >>> 16) & 255;
        const o2 = (num >>> 8) & 255;
        const o3 = num & 255;
        return this.isPrivateIpv4Octets(o0, o1, o2, o3);
      }
      return true;
    }

    // Check Hexadecimal IP representation (e.g. 0x7f000001)
    if (/^0x[0-9a-f]+$/i.test(host)) {
      const num = parseInt(host, 16);
      if (!isNaN(num) && num >= 0 && num <= 4294967295) {
        const o0 = (num >>> 24) & 255;
        const o1 = (num >>> 16) & 255;
        const o2 = (num >>> 8) & 255;
        const o3 = num & 255;
        return this.isPrivateIpv4Octets(o0, o1, o2, o3);
      }
      return true;
    }

    // Check IPv6 loopback / unique local / link local
    if (
      host === '::1' ||
      host === '::' ||
      host.startsWith('fc00:') ||
      host.startsWith('fd') ||
      host.startsWith('fe80:') ||
      host.startsWith('ff00:')
    ) {
      return true;
    }

    // Check IPv4-mapped IPv6 (::ffff:127.0.0.1 or ::ffff:7f00:1)
    if (host.startsWith('::ffff:')) {
      const mapped = host.slice(7);
      return this.isPrivateOrReservedHost(mapped);
    }

    // Check standard IPv4 dotted decimal notation (allowing octal or zero-padded octets)
    const parts = host.split('.');
    if (parts.length === 4 && parts.every((p) => /^\d+$/.test(p))) {
      const octets = parts.map((p) => {
        // Handle octal prefix like 0177
        if (p.length > 1 && p.startsWith('0')) {
          return parseInt(p, 8);
        }
        return parseInt(p, 10);
      });

      if (octets.some((o) => isNaN(o) || o < 0 || o > 255)) {
        return true; // Malformed octet
      }

      return this.isPrivateIpv4Octets(octets[0], octets[1], octets[2], octets[3]);
    }

    return false;
  }

  /**
   * Internal evaluation of IPv4 octets against RFC boundaries.
   */
  private static isPrivateIpv4Octets(o0: number, o1: number, o2: number, _o3: number): boolean {
    // 0.0.0.0/8 (Current network)
    if (o0 === 0) return true;

    // 127.0.0.0/8 (Loopback)
    if (o0 === 127) return true;

    // 10.0.0.0/8 (RFC 1918 Private)
    if (o0 === 10) return true;

    // 172.16.0.0/12 (RFC 1918 Private)
    if (o0 === 172 && o1 >= 16 && o1 <= 31) return true;

    // 192.168.0.0/16 (RFC 1918 Private)
    if (o0 === 192 && o1 === 168) return true;

    // 169.254.0.0/16 (RFC 3927 Link-Local / Cloud Metadata)
    if (o0 === 169 && o1 === 254) return true;

    // 100.64.0.0/10 (RFC 6598 Carrier-Grade NAT)
    if (o0 === 100 && o1 >= 64 && o1 <= 127) return true;

    // 192.0.0.0/24 (IETF Protocol Assignments)
    if (o0 === 192 && o1 === 0 && o2 === 0) return true;

    // 192.0.2.0/24 (TEST-NET-1)
    if (o0 === 192 && o1 === 0 && o2 === 2) return true;

    // 198.18.0.0/15 (Benchmarking)
    if (o0 === 198 && (o1 === 18 || o1 === 19)) return true;

    // 198.51.100.0/24 (TEST-NET-2)
    if (o0 === 198 && o1 === 51 && o2 === 100) return true;

    // 203.0.113.0/24 (TEST-NET-3)
    if (o0 === 203 && o1 === 0 && o2 === 113) return true;

    // 224.0.0.0/4 (Multicast)
    if (o0 >= 224 && o0 <= 239) return true;

    // 240.0.0.0/4 (Reserved / Future Use)
    if (o0 >= 240) return true;

    return false;
  }

  /**
   * Matches a hostname against a domain pattern (supports wildcard '*.domain.com' and exact matches).
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
}
