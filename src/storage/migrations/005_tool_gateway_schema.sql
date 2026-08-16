-- Xylarc AI — Mediated Tool Gateway & Credential Vault Schema Migration 005
-- Implements credential isolation, per-tool permissions, idempotency tracking, and audit ledger (§8.4, §15, §18 of CLAUDE.md)

CREATE TABLE IF NOT EXISTS tenant_credentials (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    service_slug TEXT NOT NULL,
    name TEXT NOT NULL,
    encrypted_data TEXT NOT NULL,
    iv TEXT NOT NULL,
    tag TEXT NOT NULL,
    metadata_json TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    UNIQUE(tenant_id, service_slug)
);

CREATE INDEX IF NOT EXISTS idx_tenant_credentials_tenant_service 
ON tenant_credentials(tenant_id, service_slug);

CREATE TABLE IF NOT EXISTS tool_definitions (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL, -- crm, calendar, communication, payment, webhook, custom
    risk_tier TEXT NOT NULL DEFAULT 'LOW', -- LOW, MEDIUM, HIGH, CRITICAL
    requires_approval INTEGER NOT NULL DEFAULT 0,
    input_schema_json TEXT NOT NULL DEFAULT '{}',
    output_schema_json TEXT NOT NULL DEFAULT '{}',
    is_system INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tool_permissions (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    agent_id TEXT, -- NULL denotes tenant-wide policy
    tool_slug TEXT NOT NULL,
    is_enabled INTEGER NOT NULL DEFAULT 1,
    daily_quota_limit INTEGER DEFAULT 1000,
    daily_invocation_count INTEGER DEFAULT 0,
    last_invoked_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    UNIQUE(tenant_id, agent_id, tool_slug)
);

CREATE INDEX IF NOT EXISTS idx_tool_permissions_tenant_agent
ON tool_permissions(tenant_id, agent_id, tool_slug);

CREATE TABLE IF NOT EXISTS tool_executions (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    agent_id TEXT,
    tool_slug TEXT NOT NULL,
    idempotency_key TEXT,
    risk_tier TEXT NOT NULL DEFAULT 'LOW',
    status TEXT NOT NULL DEFAULT 'pending', -- pending, executing, completed, failed, needs_approval
    input_json TEXT NOT NULL,
    output_json TEXT,
    error_message TEXT,
    duration_ms INTEGER DEFAULT 0,
    caller_ip TEXT,
    correlation_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    UNIQUE(tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_tool_executions_tenant_tool 
ON tool_executions(tenant_id, tool_slug, created_at);

CREATE INDEX IF NOT EXISTS idx_tool_executions_idempotency 
ON tool_executions(tenant_id, idempotency_key);
