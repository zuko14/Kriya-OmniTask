-- Migration 021: Enterprise Governance Schema
-- Multi-level org hierarchy, enterprise SSO/OIDC config, ABAC data classification, and automated retention purge auditing.

CREATE TABLE IF NOT EXISTS organization_units (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    parent_unit_id TEXT, -- NULL for top-level division
    name TEXT NOT NULL,
    code TEXT NOT NULL,
    unit_type TEXT NOT NULL, -- 'division', 'department', 'team', 'squad'
    lead_user_id TEXT,
    metadata_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(tenant_id, code),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_unit_id) REFERENCES organization_units(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_org_tenant_parent ON organization_units(tenant_id, parent_unit_id);

CREATE TABLE IF NOT EXISTS enterprise_sso_configs (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    provider_type TEXT NOT NULL, -- 'okta', 'azure_ad', 'google_workspace', 'generic_oidc', 'saml2'
    issuer_url TEXT NOT NULL,
    client_id TEXT NOT NULL,
    client_secret_encrypted TEXT NOT NULL,
    claims_mapping_json TEXT NOT NULL,
    enforce_sso INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(tenant_id, provider_type),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sso_tenant ON enterprise_sso_configs(tenant_id);

CREATE TABLE IF NOT EXISTS data_retention_policies (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    data_classification TEXT NOT NULL, -- 'public', 'internal', 'confidential', 'restricted'
    target_resource_type TEXT NOT NULL, -- 'audit_logs', 'agent_conversations', 'cost_records', 'transcripts', 'workflow_executions'
    retention_days INTEGER NOT NULL,
    purge_action TEXT NOT NULL DEFAULT 'hard_delete', -- 'hard_delete', 'anonymize', 'archive_cold_storage'
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(tenant_id, data_classification, target_resource_type),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_retention_tenant ON data_retention_policies(tenant_id);

CREATE TABLE IF NOT EXISTS governance_purge_audit (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    policy_id TEXT NOT NULL,
    target_resource_type TEXT NOT NULL,
    records_evaluated INTEGER NOT NULL,
    records_purged INTEGER NOT NULL,
    status TEXT NOT NULL, -- 'completed', 'failed'
    executed_at TEXT NOT NULL,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_purge_tenant ON governance_purge_audit(tenant_id, executed_at);
