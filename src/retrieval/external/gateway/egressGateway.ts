/**
 * Kriya Omnitask — Secured Egress Gateway (§10.3, §10.4)
 * Enforces per-agent search grants, platform denylists, tenant domain allowlists,
 * domain reputation scores, and SSRF / private network boundaries.
 */

import { ExternalRetrievalRepository } from '../repositories/externalRetrievalRepository.js';
import { EgressGatewayCheckResult } from '../types/externalRetrievalTypes.js';
import { ForbiddenError } from '../../../core/errors/errors.js';
import { logger } from '../../../core/logger/logger.js';
import { SSRFGuard } from '../../../security/ssrf/ssrfGuard.js';

export class EgressGateway {
  private repo: ExternalRetrievalRepository;

  // Sensitive agent categories that are strictly forbidden from having external search grants (§10.4)
  private static readonly FORBIDDEN_AGENT_PATTERNS = [
    /payment/i,
    /billing/i,
    /contract/i,
    /identity/i,
    /auth/i,
    /credential/i,
    /secret/i,
  ];

  // Platform-wide SSRF and malicious denylists
  private static readonly PLATFORM_DENYLISTED_HOSTS = [
    'localhost',
    '127.0.0.1',
    '0.0.0.0',
    '::1',
    '169.254.169.254', // AWS / Cloud metadata service
    'metadata.google.internal',
    'metadata.internal',
  ];

  constructor(repo?: ExternalRetrievalRepository) {
    this.repo = repo || new ExternalRetrievalRepository();
  }

  /**
   * Validates whether an agent in a tenant is permitted to make an external egress retrieval request to targetUrl.
   */
  public async validateEgress(
    tenantId: string,
    agentSlug: string,
    targetUrl: string,
    options?: {
      tenantAllowedDomains?: string[];
    }
  ): Promise<EgressGatewayCheckResult> {
    const cleanAgentSlug = agentSlug.trim().toLowerCase();

    // 1. Forbid Search Grants for sensitive payment/identity/contract agents (§10.4)
    for (const pattern of EgressGateway.FORBIDDEN_AGENT_PATTERNS) {
      if (pattern.test(cleanAgentSlug)) {
        const reason = `Security Policy Violation: Agent '${agentSlug}' is in a restricted category (payment/identity/contract) and cannot hold external search grants (§10.4).`;
        logger.warn(reason, { tenantId, agentSlug, targetUrl });
        throw new ForbiddenError(reason);
      }
    }

    // 2. Check Search Grant for calling agent (§10.4: Search grants are per-agent and off by default)
    const grant = await this.repo.getSearchGrant(tenantId, cleanAgentSlug);
    if (!grant || !grant.enabled) {
      const reason = `External retrieval denied: Agent '${agentSlug}' does not have an active search grant. Grants are per-agent and disabled by default (§10.4).`;
      logger.warn(reason, { tenantId, agentSlug, targetUrl });
      throw new ForbiddenError(reason);
    }

    // 3. Parse and normalize Target URL with SSRF Guard validation
    let domain: string;
    try {
      const validated = SSRFGuard.validateUrl(targetUrl);
      domain = validated.domain;
    } catch (err: any) {
      const reason = `SSRF / Security Block: ${err.message}`;
      logger.error(reason, { tenantId, agentSlug, targetUrl });
      return {
        allowed: false,
        blockedReason: reason,
        domain: 'invalid',
        isAllowlisted: false,
        isDenylisted: true,
        reputationScore: 0,
      };
    }

    // 4. Platform SSRF & Denylist check
    if (this.isPlatformDenylisted(domain) || SSRFGuard.isPrivateOrReservedHost(domain)) {
      const reason = `SSRF / Security Block: Egress to host '${domain}' is blocked by platform security policy.`;
      logger.error(reason, { tenantId, agentSlug, domain });
      return {
        allowed: false,
        blockedReason: reason,
        domain,
        isAllowlisted: false,
        isDenylisted: true,
        reputationScore: 0,
      };
    }

    // 5. Domain Reputation & Auto-Denylist check (§10.4)
    const reputation = await this.repo.getDomainReputation(domain);
    if (reputation?.isAutoDenylisted) {
      const reason = `Domain '${domain}' is auto-denylisted due to multiple prompt injection attempts (${reputation.injectionAttemptsCount} violations recorded).`;
      logger.warn(reason, { tenantId, agentSlug, domain });
      return {
        allowed: false,
        blockedReason: reason,
        domain,
        isAllowlisted: false,
        isDenylisted: true,
        reputationScore: reputation.reputationScore,
      };
    }

    // 6. Domain Allowlist Check (Grant specific + Tenant specific)
    const grantDomains = grant.allowedDomains || [];
    const tenantDomains = options?.tenantAllowedDomains || [];
    const combinedAllowlist = [...grantDomains, ...tenantDomains];

    let isAllowlisted = true;
    if (combinedAllowlist.length > 0) {
      isAllowlisted = combinedAllowlist.some((allowed) => {
        const cleanAllowed = allowed.toLowerCase().trim();
        return domain === cleanAllowed || domain.endsWith(`.${cleanAllowed}`);
      });

      if (!isAllowlisted) {
        const reason = `Domain '${domain}' is not in the allowed domain list for agent '${agentSlug}' or tenant '${tenantId}'.`;
        return {
          allowed: false,
          blockedReason: reason,
          domain,
          isAllowlisted: false,
          isDenylisted: false,
          reputationScore: reputation?.reputationScore ?? 100,
        };
      }
    }

    return {
      allowed: true,
      domain,
      isAllowlisted: true,
      isDenylisted: false,
      reputationScore: reputation?.reputationScore ?? 100,
    };
  }

  private isPlatformDenylisted(host: string): boolean {
    if (EgressGateway.PLATFORM_DENYLISTED_HOSTS.includes(host)) {
      return true;
    }

    // Private IPv4 ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 127.0.0.0/8)
    if (
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host)
    ) {
      return true;
    }

    // Internal and local TLDs
    if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.lan')) {
      return true;
    }

    return false;
  }
}
