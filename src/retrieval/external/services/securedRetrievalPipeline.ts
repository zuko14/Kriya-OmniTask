/**
 * Kriya Omnitask — Secured External Retrieval Pipeline Service (§10.3, §10.4)
 * Orchestrates end-to-end typed information need execution with strict PII blocking,
 * egress gating, isolated fetching, prompt injection sanitization, and isolation wrapping.
 */

import { QueryBuilder } from '../query/queryBuilder.js';
import { PiiScrubber } from '../scrubber/piiScrubber.js';
import { EgressGateway } from '../gateway/egressGateway.js';
import { IsolatedFetcherWorker, HttpFetchFn } from '../fetcher/isolatedFetcher.js';
import { ContentSanitizer } from '../sanitizer/contentSanitizer.js';
import { IsolationWrapper } from '../wrapper/isolationWrapper.js';
import { ExternalRetrievalRepository } from '../repositories/externalRetrievalRepository.js';
import {
  ExternalFactRecord,
  TypedInformationNeed,
  TypedInformationNeedInput,
  TypedInformationNeedSchema,
} from '../types/externalRetrievalTypes.js';
import { logger } from '../../../core/logger/logger.js';

export interface ExecuteRetrievalOptions {
  directUrl?: string;
  customFetch?: HttpFetchFn;
  tenantAllowedDomains?: string[];
  ttlSeconds?: number;
}

export interface RetrievalPipelineExecutionResult {
  success: boolean;
  facts: ExternalFactRecord[];
  queryBuilt: string;
  blocked: boolean;
  blockReason?: string;
  securityEventsCount: number;
}

export class SecuredRetrievalPipeline {
  private repo: ExternalRetrievalRepository;
  private egressGateway: EgressGateway;
  private contentSanitizer: ContentSanitizer;

  constructor(repo?: ExternalRetrievalRepository) {
    this.repo = repo || new ExternalRetrievalRepository();
    this.egressGateway = new EgressGateway(this.repo);
    this.contentSanitizer = new ContentSanitizer(this.repo);
  }

  /**
   * Executes the full Secured External Retrieval Pipeline (§10.3).
   */
  public async executePipeline(
    tenantId: string,
    correlationId: string,
    rawNeed: TypedInformationNeedInput | TypedInformationNeed,
    options?: ExecuteRetrievalOptions
  ): Promise<RetrievalPipelineExecutionResult> {
    const need = TypedInformationNeedSchema.parse(rawNeed);
    const agentSlug = need.callingAgentSlug;

    // -----------------------------------------------------------------------
    // Step 1: Query Builder (Deterministic) (§10.3)
    // -----------------------------------------------------------------------
    const builtQuery = QueryBuilder.buildQuery(need);

    // -----------------------------------------------------------------------
    // Step 2: Outbound PII Scrubber (§10.3, §10.4)
    // HARD RULE: A query containing PII is BLOCKED, not sanitized-and-sent!
    // -----------------------------------------------------------------------
    PiiScrubber.assertNoPii(builtQuery.queryString, {
      tenantId,
      correlationId,
      agentSlug,
      topic: need.topic,
    });

    // Determine target URL for retrieval
    const targetUrl = options?.directUrl || (
      need.targetDomains && need.targetDomains.length > 0
        ? `https://${need.targetDomains[0]}/search?q=${encodeURIComponent(builtQuery.queryString)}`
        : `https://api.duckduckgo.com/html/?q=${encodeURIComponent(builtQuery.queryString)}`
    );

    // -----------------------------------------------------------------------
    // Step 3: Egress Gateway (§10.3, §10.4)
    // Enforces search grants (off by default), allowlists, and domain reputation
    // -----------------------------------------------------------------------
    const egressCheck = await this.egressGateway.validateEgress(
      tenantId,
      agentSlug,
      targetUrl,
      { tenantAllowedDomains: options?.tenantAllowedDomains }
    );

    if (!egressCheck.allowed) {
      const blockReason = egressCheck.blockedReason || 'Blocked by egress security policy.';
      logger.warn(`Egress Gateway blocked retrieval for agent '${agentSlug}': ${blockReason}`, {
        tenantId,
        correlationId,
        targetUrl,
      });

      return {
        success: false,
        facts: [],
        queryBuilt: builtQuery.queryString,
        blocked: true,
        blockReason,
        securityEventsCount: 0,
      };
    }

    // -----------------------------------------------------------------------
    // Step 4: Isolated Fetcher Worker (§10.3, §10.4)
    // Sandboxed execution with zero DB, zero secret, zero tool access
    // -----------------------------------------------------------------------
    const fetcher = new IsolatedFetcherWorker(options?.customFetch);
    const fetchedPayload = await fetcher.fetchUrl(targetUrl);

    // -----------------------------------------------------------------------
    // Step 5: Content Sanitizer & Injection Neutralization (§10.3, §10.4)
    // Strips active code, hidden text, zero-width chars, neutralizes injections
    // -----------------------------------------------------------------------
    const sanitization = await this.contentSanitizer.sanitize(
      fetchedPayload.rawContent,
      targetUrl,
      { tenantId, correlationId, agentSlug }
    );

    // -----------------------------------------------------------------------
    // Step 6: Isolation Wrapper & Trust Tagging (§10.1, §10.2, §10.3)
    // Fences untrusted text in <<<UNTRUSTED_EXTERNAL_DATA...>>>
    // -----------------------------------------------------------------------
    const trustTier = egressCheck.isAllowlisted ? 'TIER_C' : 'TIER_D';
    const factRecord = IsolationWrapper.wrapInIsolationBoundary(sanitization.sanitized, {
      tenantId,
      correlationId,
      agentSlug,
      topic: need.topic,
      trustTier,
      ttlSeconds: options?.ttlSeconds || need.maxAgeHours * 3600,
    });

    // -----------------------------------------------------------------------
    // Step 7: Audit Ledger Log (§10.3)
    // -----------------------------------------------------------------------
    await this.repo.logRetrievalEvent(
      factRecord,
      builtQuery.queryString,
      sanitization.hasInjections ? 'sanitized_injection' : 'success'
    );

    return {
      success: true,
      facts: [factRecord],
      queryBuilt: builtQuery.queryString,
      blocked: false,
      securityEventsCount: sanitization.hasInjections ? 1 : 0,
    };
  }
}
