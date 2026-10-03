-- Migration 028: Tenant Elevation & Extended Enterprise Provisioning Schema (§2, §17.1, §17.2, §17.6)
-- Supports owner-plane provisioning, temporary operator elevation sessions, and strict governance fields.

CREATE TABLE IF NOT EXISTS tenant_elevation_sessions (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    operator_id TEXT NOT NULL,
    operator_name TEXT,
    reason TEXT NOT NULL,
    duration_minutes INTEGER NOT NULL,
    starts_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_elevation_tenant_active ON tenant_elevation_sessions(tenant_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_elevation_operator ON tenant_elevation_sessions(operator_id, created_at);

-- Add extended fields to tenants table safely if not already present
-- SQLite allows adding columns with ALTER TABLE
ALTER TABLE tenants ADD COLUMN industry TEXT DEFAULT 'general';
ALTER TABLE tenants ADD COLUMN region TEXT DEFAULT 'ap-south-1';
ALTER TABLE tenants ADD COLUMN languages_json TEXT DEFAULT '["en", "hi"]';
ALTER TABLE tenants ADD COLUMN timezone TEXT DEFAULT 'Asia/Kolkata';
ALTER TABLE tenants ADD COLUMN dna_profile_id TEXT DEFAULT 'dna_general_service';
ALTER TABLE tenants ADD COLUMN brain_supply_mode TEXT DEFAULT 'byo'; -- 'byo' or 'managed' (§9.5)
ALTER TABLE tenants ADD COLUMN quotas_json TEXT DEFAULT '{"max_concurrent_tasks":10,"monthly_budget_inr":10000}';
ALTER TABLE tenants ADD COLUMN autonomy_ceiling TEXT DEFAULT 'L2'; -- 'L1', 'L2', 'L3', 'L4'
