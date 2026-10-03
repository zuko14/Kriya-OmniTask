-- Kriya Omnitask — Reach Browser Tool Schema (WP-5.5, Blueprint §10, §15, ADR-022)
-- Tracks isolated browser automation sessions, evidence hashes, and Proof linkage across tenants.

CREATE TABLE IF NOT EXISTS reach_sessions (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    run_id TEXT,
    status TEXT NOT NULL, -- 'completed', 'failed', 'killed', 'security_blocked'
    initial_url TEXT NOT NULL,
    final_url TEXT,
    actions_count INTEGER NOT NULL DEFAULT 0,
    proof_receipt_id TEXT,
    evidence_sha256 TEXT,
    error_message TEXT,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_reach_sessions_tenant ON reach_sessions(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_reach_sessions_run ON reach_sessions(run_id);
