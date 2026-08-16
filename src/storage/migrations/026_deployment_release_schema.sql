-- ============================================================================
-- Migration 026: Deployment & Release Engineering Schema
-- Phase 29 of Xylarc AI Autonomous Business Workforce
-- ============================================================================

-- 1. Release Deployments Table
CREATE TABLE IF NOT EXISTS release_deployments (
    id VARCHAR(36) PRIMARY KEY,
    version_tag VARCHAR(50) NOT NULL,
    environment VARCHAR(30) NOT NULL DEFAULT 'production', -- 'staging', 'production', 'canary'
    status VARCHAR(30) NOT NULL DEFAULT 'pending', -- 'pending', 'canary', 'promoted', 'rolled_back'
    canary_weight_pct INTEGER NOT NULL DEFAULT 0, -- 0 to 100
    gate_verdict VARCHAR(30) NOT NULL DEFAULT 'pending', -- 'approved', 'blocked', 'conditional'
    gate_details_json TEXT NOT NULL DEFAULT '{}',
    deployed_by VARCHAR(100) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    promoted_at TIMESTAMP,
    rolled_back_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_deployments_env ON release_deployments(environment);
CREATE INDEX IF NOT EXISTS idx_deployments_status ON release_deployments(status);
CREATE INDEX IF NOT EXISTS idx_deployments_version ON release_deployments(version_tag);

-- 2. Feature Flags Table
CREATE TABLE IF NOT EXISTS feature_flags (
    id VARCHAR(36) PRIMARY KEY,
    flag_key VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    is_enabled BOOLEAN NOT NULL DEFAULT 0,
    allowed_tenants_json TEXT NOT NULL DEFAULT '[]',
    allowed_roles_json TEXT NOT NULL DEFAULT '[]',
    rollout_pct INTEGER NOT NULL DEFAULT 0, -- 0 to 100
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_feature_flags_key ON feature_flags(flag_key);
CREATE INDEX IF NOT EXISTS idx_feature_flags_enabled ON feature_flags(is_enabled);

-- 3. Schema Transitions Table (Expand / Migrate / Contract Zero-Downtime Pipeline)
CREATE TABLE IF NOT EXISTS schema_transitions (
    id VARCHAR(36) PRIMARY KEY,
    table_name VARCHAR(100) NOT NULL,
    version VARCHAR(50) NOT NULL,
    phase VARCHAR(30) NOT NULL, -- 'expand', 'migrate', 'contract'
    status VARCHAR(30) NOT NULL DEFAULT 'pending', -- 'pending', 'running', 'completed', 'failed'
    details_json TEXT NOT NULL DEFAULT '{}',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_schema_transitions_table ON schema_transitions(table_name);
CREATE INDEX IF NOT EXISTS idx_schema_transitions_phase ON schema_transitions(phase);
CREATE INDEX IF NOT EXISTS idx_schema_transitions_status ON schema_transitions(status);
