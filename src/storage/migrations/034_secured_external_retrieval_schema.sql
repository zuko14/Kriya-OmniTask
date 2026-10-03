-- ============================================================================
-- Migration 034: Secured External Retrieval Schema (§10.3, §10.4)
-- Tables for Search Grants, Domain Reputation, and External Fact Audit Lineage
-- ============================================================================

-- 1. Search Grants per Agent (§10.4: Search grants are per-agent and off by default)
CREATE TABLE IF NOT EXISTS external_search_grants (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    agent_slug TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0, -- 0 = disabled (off by default), 1 = enabled
    allowed_domains_json TEXT NOT NULL DEFAULT '[]',
    max_daily_queries INTEGER NOT NULL DEFAULT 100,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(tenant_id, agent_slug)
);

CREATE INDEX IF NOT EXISTS idx_search_grants_tenant ON external_search_grants(tenant_id);

-- 2. Domain Reputation & Security Denylist Tracker (§10.3, §10.4)
CREATE TABLE IF NOT EXISTS domain_reputation_ledger (
    domain TEXT PRIMARY KEY,
    reputation_score INTEGER NOT NULL DEFAULT 100, -- 0 to 100
    injection_attempts_count INTEGER NOT NULL DEFAULT 0,
    last_violation_at TEXT,
    is_auto_denylisted INTEGER NOT NULL DEFAULT 0, -- 1 if >= 3 injection hits
    denylisted_at TEXT,
    denylist_reason TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- 3. External Retrieval Events & Provenance Lineage (§10.3, §10.4)
CREATE TABLE IF NOT EXISTS external_retrieval_events (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    correlation_id TEXT NOT NULL,
    agent_slug TEXT NOT NULL,
    topic TEXT NOT NULL,
    query_text TEXT NOT NULL,
    source_url TEXT NOT NULL,
    domain TEXT NOT NULL,
    trust_tier TEXT NOT NULL, -- 'TIER_C', 'TIER_D'
    content_hash TEXT NOT NULL,
    status TEXT NOT NULL, -- 'success', 'blocked_pii', 'blocked_gateway', 'sanitized_injection'
    security_flags_json TEXT NOT NULL DEFAULT '[]',
    freshness_ttl_seconds INTEGER NOT NULL DEFAULT 3600,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_retrieval_events_tenant ON external_retrieval_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_retrieval_events_correlation ON external_retrieval_events(correlation_id);
