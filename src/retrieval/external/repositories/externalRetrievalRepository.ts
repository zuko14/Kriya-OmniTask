/**
 * Kriya Omnitask — Secured External Retrieval Repository
 * Database access layer for Search Grants, Domain Reputation, and Audit Events (§10.3, §10.4).
 */

import { db, DatabaseClient } from '../../../storage/db.js';
import {
  SearchGrantRecord,
  DomainReputationRecord,
  ExternalFactRecord,
} from '../types/externalRetrievalTypes.js';

interface RawSearchGrantRow {
  id: string;
  tenant_id: string;
  agent_slug: string;
  enabled: number;
  allowed_domains_json: string;
  max_daily_queries: number;
  created_at: string;
  updated_at: string;
}

interface RawDomainReputationRow {
  domain: string;
  reputation_score: number;
  injection_attempts_count: number;
  last_violation_at: string | null;
  is_auto_denylisted: number;
  denylisted_at: string | null;
  denylist_reason: string | null;
  created_at: string;
  updated_at: string;
}

export class ExternalRetrievalRepository {
  private client: DatabaseClient;

  constructor(client?: DatabaseClient) {
    this.client = client || db.getClient();
  }

  // =========================================================================
  // 1. Search Grants per Agent (§10.4)
  // =========================================================================

  public async getSearchGrant(tenantId: string, agentSlug: string): Promise<SearchGrantRecord | null> {
    const row = await this.client.queryOne<RawSearchGrantRow>(
      'SELECT * FROM external_search_grants WHERE tenant_id = ? AND agent_slug = ?',
      [tenantId, agentSlug]
    );
    if (!row) return null;
    return this.mapGrantRow(row);
  }

  public async listSearchGrants(tenantId: string): Promise<SearchGrantRecord[]> {
    const rows = await this.client.query<RawSearchGrantRow>(
      'SELECT * FROM external_search_grants WHERE tenant_id = ? ORDER BY agent_slug ASC',
      [tenantId]
    );
    return rows.map((r: RawSearchGrantRow) => this.mapGrantRow(r));
  }

  public async saveSearchGrant(grant: SearchGrantRecord): Promise<SearchGrantRecord> {
    const now = new Date().toISOString();
    await this.client.execute(
      `INSERT OR REPLACE INTO external_search_grants (
        id, tenant_id, agent_slug, enabled, allowed_domains_json,
        max_daily_queries, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        grant.id,
        grant.tenantId,
        grant.agentSlug,
        grant.enabled ? 1 : 0,
        JSON.stringify(grant.allowedDomains || []),
        grant.maxDailyQueries || 100,
        grant.createdAt || now,
        now,
      ]
    );
    return {
      ...grant,
      updatedAt: now,
    };
  }

  // =========================================================================
  // 2. Domain Reputation & Auto-Denylist Tracker (§10.3, §10.4)
  // =========================================================================

  public async getDomainReputation(domain: string): Promise<DomainReputationRecord | null> {
    const cleanDomain = domain.toLowerCase().trim();
    const row = await this.client.queryOne<RawDomainReputationRow>(
      'SELECT * FROM domain_reputation_ledger WHERE domain = ?',
      [cleanDomain]
    );
    if (!row) return null;
    return this.mapDomainRow(row);
  }

  public async recordInjectionStrike(
    domain: string,
    reason = 'Indirect prompt injection attempt detected'
  ): Promise<DomainReputationRecord> {
    const cleanDomain = domain.toLowerCase().trim();
    const now = new Date().toISOString();
    const existing = await this.getDomainReputation(cleanDomain);

    const newStrikes = (existing?.injectionAttemptsCount || 0) + 1;
    const newScore = Math.max(0, (existing?.reputationScore ?? 100) - 35);
    const shouldAutoDenylist = newStrikes >= 3;

    await this.client.execute(
      `INSERT OR REPLACE INTO domain_reputation_ledger (
        domain, reputation_score, injection_attempts_count, last_violation_at,
        is_auto_denylisted, denylisted_at, denylist_reason, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        cleanDomain,
        newScore,
        newStrikes,
        now,
        shouldAutoDenylist ? 1 : 0,
        shouldAutoDenylist ? (existing?.denylistedAt || now) : null,
        shouldAutoDenylist ? (existing?.denylistReason || `Auto-denylisted: ${newStrikes} injection attempts recorded`) : null,
        existing?.createdAt || now,
        now,
      ]
    );

    return {
      domain: cleanDomain,
      reputationScore: newScore,
      injectionAttemptsCount: newStrikes,
      lastViolationAt: now,
      isAutoDenylisted: shouldAutoDenylist,
      denylistedAt: shouldAutoDenylist ? (existing?.denylistedAt || now) : null,
      denylistReason: shouldAutoDenylist ? (existing?.denylistReason || reason) : null,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
  }

  public async listDenylistedDomains(): Promise<DomainReputationRecord[]> {
    const rows = await this.client.query<RawDomainReputationRow>(
      'SELECT * FROM domain_reputation_ledger WHERE is_auto_denylisted = 1 ORDER BY updated_at DESC'
    );
    return rows.map((r: RawDomainReputationRow) => this.mapDomainRow(r));
  }

  // =========================================================================
  // 3. Retrieval Events Audit Log (§10.3)
  // =========================================================================

  public async logRetrievalEvent(fact: ExternalFactRecord, queryText: string, status: string): Promise<void> {
    const now = new Date().toISOString();
    await this.client.execute(
      `INSERT INTO external_retrieval_events (
        id, tenant_id, correlation_id, agent_slug, topic, query_text,
        source_url, domain, trust_tier, content_hash, status,
        security_flags_json, freshness_ttl_seconds, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        fact.id,
        fact.tenantId,
        fact.correlationId,
        fact.agentSlug,
        fact.topic,
        queryText,
        fact.sourceUrl,
        fact.domain,
        fact.trustTier,
        fact.contentHash,
        status,
        JSON.stringify(fact.securityFlags || []),
        fact.freshnessTtlSeconds || 3600,
        now,
      ]
    );
  }

  // =========================================================================
  // Private Helpers
  // =========================================================================

  private mapGrantRow(r: RawSearchGrantRow): SearchGrantRecord {
    let allowedDomains: string[] = [];
    try {
      allowedDomains = JSON.parse(r.allowed_domains_json || '[]');
    } catch {
      allowedDomains = [];
    }

    return {
      id: r.id,
      tenantId: r.tenant_id,
      agentSlug: r.agent_slug,
      enabled: r.enabled === 1,
      allowedDomains,
      maxDailyQueries: r.max_daily_queries,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  private mapDomainRow(r: RawDomainReputationRow): DomainReputationRecord {
    return {
      domain: r.domain,
      reputationScore: r.reputation_score,
      injectionAttemptsCount: r.injection_attempts_count,
      lastViolationAt: r.last_violation_at,
      isAutoDenylisted: r.is_auto_denylisted === 1,
      denylistedAt: r.denylisted_at,
      denylistReason: r.denylist_reason,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }
}
