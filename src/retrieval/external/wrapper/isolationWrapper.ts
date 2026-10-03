/**
 * Kriya Omnitask — Isolation Wrapper & Trust Tagging Engine (§10.1, §10.2, §10.3)
 * Fences untrusted external text in explicit system boundary blocks, attaches
 * Trust Ladder tiers, generates structured citations, and enforces TTL freshness.
 */

import { CryptoUtils } from '../../../core/utils/crypto.js';
import {
  ExternalFactRecord,
  SanitizedWebContent,
  TrustTier,
} from '../types/externalRetrievalTypes.js';

export class IsolationWrapper {
  /**
   * Encloses sanitized web content in an immutable, fenced boundary block
   * and produces a fully qualified ExternalFactRecord.
   */
  public static wrapInIsolationBoundary(
    sanitized: SanitizedWebContent,
    params: {
      tenantId: string;
      correlationId: string;
      agentSlug: string;
      topic: string;
      trustTier?: TrustTier;
      ttlSeconds?: number;
      extractedData?: Record<string, unknown>;
    }
  ): ExternalFactRecord {
    const trustTier: TrustTier = params.trustTier || (sanitized.domain.endsWith('.gov') || sanitized.domain.endsWith('.edu') ? 'TIER_C' : 'TIER_D');
    const ttlSeconds = params.ttlSeconds || 3600; // 1 hour default
    const retrievedTime = new Date(sanitized.retrievedAt).getTime();
    const expiresAt = new Date(retrievedTime + ttlSeconds * 1000).toISOString();

    const id = `fact_${CryptoUtils.generateId()}`;

    // Fenced boundary format (§10.3)
    const isolatedContent = [
      `<<<UNTRUSTED_EXTERNAL_DATA source="${sanitized.sourceUrl}" retrieved_at="${sanitized.retrievedAt}" trust_tier="${trustTier}" content_hash="${sanitized.contentHash}">>>`,
      sanitized.textContent,
      `<<<END_UNTRUSTED_EXTERNAL_DATA>>>`,
    ].join('\n');

    // Human-readable citation string (§10.3)
    const citation = `[External Source: ${sanitized.domain} · Retrieved: ${sanitized.retrievedAt} · Trust: ${trustTier}]`;

    return {
      id,
      tenantId: params.tenantId,
      correlationId: params.correlationId,
      agentSlug: params.agentSlug,
      topic: params.topic,
      sourceUrl: sanitized.sourceUrl,
      domain: sanitized.domain,
      trustTier,
      retrievedAt: sanitized.retrievedAt,
      contentHash: sanitized.contentHash,
      freshnessTtlSeconds: ttlSeconds,
      isolatedContent,
      extractedData: params.extractedData || {},
      citation,
      expiresAt,
      securityFlags: sanitized.injectionsDetected,
    };
  }

  /**
   * Checks if an external fact has expired past its freshness TTL.
   */
  public static isFactFresh(fact: ExternalFactRecord, now = new Date()): boolean {
    const expiryTime = new Date(fact.expiresAt).getTime();
    return now.getTime() < expiryTime;
  }
}
