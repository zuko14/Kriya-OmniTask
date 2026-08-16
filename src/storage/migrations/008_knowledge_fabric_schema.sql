-- ============================================================================
-- Migration 008: Knowledge Fabric, Vector / Relational Ingestion & Lineage Schema
-- Phase 11 of Xylarc AI Autonomous Business Workforce (§10, §11, §12 of CLAUDE.md)
-- ============================================================================

-- 1. Knowledge Documents Table
CREATE TABLE IF NOT EXISTS knowledge_documents (
    id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(36) NOT NULL,
    organization_id VARCHAR(36) NOT NULL DEFAULT 'default',
    title VARCHAR(255) NOT NULL,
    source_type VARCHAR(50) NOT NULL, -- 'pdf', 'docx', 'markdown', 'text', 'web_crawl', 'structured_json', 'faq', 'policy_sop'
    source_uri VARCHAR(512),
    mime_type VARCHAR(100) NOT NULL DEFAULT 'text/plain',
    content_raw TEXT NOT NULL,
    content_normalized TEXT NOT NULL,
    summary TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    is_active INTEGER NOT NULL DEFAULT 1, -- 1 = active, 0 = inactive / archived
    quality_status VARCHAR(50) NOT NULL DEFAULT 'UNVERIFIED', -- 'VERIFIED', 'UNVERIFIED', 'STALE', 'CONFLICTING', 'UNKNOWN'
    stale_after_days INTEGER NOT NULL DEFAULT 90,
    provenance_json TEXT NOT NULL DEFAULT '{}', -- author, uploaded_by, source_system, content_hash, verified_at, verified_by
    access_scope_json TEXT NOT NULL DEFAULT '{"allowedRoles":["admin","support_agent"],"allowedAgents":["*"],"isPublicToTenant":true}',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_kdocuments_tenant ON knowledge_documents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_kdocuments_tenant_status ON knowledge_documents(tenant_id, is_active, quality_status);
CREATE INDEX IF NOT EXISTS idx_kdocuments_tenant_source ON knowledge_documents(tenant_id, source_type);

-- 2. Knowledge Chunks Table (Dense Vector + Full Text / Metadata Index)
CREATE TABLE IF NOT EXISTS knowledge_chunks (
    id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(36) NOT NULL,
    document_id VARCHAR(36) NOT NULL,
    chunk_index INTEGER NOT NULL,
    heading_context VARCHAR(255) NOT NULL DEFAULT '',
    content TEXT NOT NULL,
    token_count INTEGER NOT NULL DEFAULT 0,
    embedding_json TEXT, -- JSON array of floating-point numbers (e.g. 128 / 768 / 1536 dims)
    quality_status VARCHAR(50) NOT NULL DEFAULT 'UNVERIFIED',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (document_id) REFERENCES knowledge_documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_kchunks_tenant_doc ON knowledge_chunks(tenant_id, document_id);
CREATE INDEX IF NOT EXISTS idx_kchunks_tenant ON knowledge_chunks(tenant_id);

-- 3. Knowledge Lineage Events Table (Immutable Provenance Ledger)
CREATE TABLE IF NOT EXISTS knowledge_lineage_events (
    id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(36) NOT NULL,
    document_id VARCHAR(36) NOT NULL,
    event_type VARCHAR(50) NOT NULL, -- 'ingested', 'chunked', 'embedded', 'updated', 'verified', 'invalidated', 'retrieved'
    actor_type VARCHAR(50) NOT NULL, -- 'user', 'agent', 'system'
    actor_id VARCHAR(100) NOT NULL,
    agent_id VARCHAR(100),
    query_text TEXT,
    details_json TEXT NOT NULL DEFAULT '{}',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_klineage_tenant_doc ON knowledge_lineage_events(tenant_id, document_id);
CREATE INDEX IF NOT EXISTS idx_klineage_tenant_event ON knowledge_lineage_events(tenant_id, event_type);
