-- ============================================================================
-- Migration 057: Release Gating, Canary Routing, One-Step Rollback & India Hosting Schema
-- Kriya Omnitask — Milestone M8 / WP-8.5
-- ============================================================================

-- 1. API Version Registrations Table
CREATE TABLE IF NOT EXISTS api_version_registrations (
    id VARCHAR(36) PRIMARY KEY,
    api_version VARCHAR(20) NOT NULL UNIQUE,
    status VARCHAR(20) NOT NULL DEFAULT 'active', -- 'active', 'deprecated', 'sunset'
    min_supported_client_version VARCHAR(20) NOT NULL,
    deprecated_at TIMESTAMP,
    sunset_at TIMESTAMP,
    notes TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_api_ver_status ON api_version_registrations(status);

-- 2. Canary Routing Configurations Table
CREATE TABLE IF NOT EXISTS canary_routing_configurations (
    id VARCHAR(36) PRIMARY KEY,
    deployment_id VARCHAR(36) NOT NULL,
    traffic_weight_pct INTEGER NOT NULL DEFAULT 0, -- 0 to 100
    routing_strategy VARCHAR(30) NOT NULL DEFAULT 'tenant_hash', -- 'tenant_hash', 'user_hash', 'random'
    evaluation_interval_seconds INTEGER NOT NULL DEFAULT 60,
    error_rate_threshold_pct REAL NOT NULL DEFAULT 1.0,
    p99_latency_threshold_ms INTEGER NOT NULL DEFAULT 1500,
    consecutive_healthy_evaluations INTEGER NOT NULL DEFAULT 0,
    consecutive_unhealthy_evaluations INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'active', -- 'active', 'paused', 'completed', 'rolled_back'
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_canary_cfg_deployment ON canary_routing_configurations(deployment_id);
CREATE INDEX IF NOT EXISTS idx_canary_cfg_status ON canary_routing_configurations(status);

-- 3. Canary Telemetry Snapshots Table
CREATE TABLE IF NOT EXISTS canary_telemetry_snapshots (
    id VARCHAR(36) PRIMARY KEY,
    deployment_id VARCHAR(36) NOT NULL,
    sample_window_seconds INTEGER NOT NULL,
    total_requests INTEGER NOT NULL,
    error_count INTEGER NOT NULL,
    error_rate_pct REAL NOT NULL,
    p95_latency_ms REAL NOT NULL,
    p99_latency_ms REAL NOT NULL,
    verdict VARCHAR(20) NOT NULL, -- 'healthy', 'warning', 'critical'
    action_taken VARCHAR(20) NOT NULL, -- 'advance', 'hold', 'rollback'
    reason TEXT,
    evaluated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_canary_telemetry_dep ON canary_telemetry_snapshots(deployment_id);
CREATE INDEX IF NOT EXISTS idx_canary_telemetry_eval ON canary_telemetry_snapshots(evaluated_at);

-- 4. Deployment Rollback Events Table
CREATE TABLE IF NOT EXISTS deployment_rollback_events (
    id VARCHAR(36) PRIMARY KEY,
    deployment_id VARCHAR(36) NOT NULL,
    rollback_type VARCHAR(30) NOT NULL, -- 'automated_telemetry', 'manual_operator', 'circuit_breaker'
    trigger_reason TEXT NOT NULL,
    previous_weight_pct INTEGER NOT NULL,
    target_weight_pct INTEGER NOT NULL DEFAULT 0,
    proof_receipt_id VARCHAR(64),
    attention_item_id VARCHAR(64),
    executed_by VARCHAR(100) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rollback_events_dep ON deployment_rollback_events(deployment_id);
CREATE INDEX IF NOT EXISTS idx_rollback_events_type ON deployment_rollback_events(rollback_type);

-- 5. Data Residency Configurations Table (India DPDP & Sovereign Cloud Residency)
CREATE TABLE IF NOT EXISTS data_residency_configs (
    id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL UNIQUE,
    jurisdiction VARCHAR(30) NOT NULL DEFAULT 'IN_DPDP_2023', -- 'IN_DPDP_2023', 'EU_GDPR', 'US_HIPAA', 'GLOBAL'
    primary_region VARCHAR(30) NOT NULL DEFAULT 'ap-south-1', -- 'ap-south-1', 'ap-south-2', 'in-central1'
    allowed_regions_json TEXT NOT NULL DEFAULT '["ap-south-1"]',
    strict_data_localization BOOLEAN NOT NULL DEFAULT 1,
    cross_border_transfer_permitted BOOLEAN NOT NULL DEFAULT 0,
    approved_llm_inference_regions_json TEXT NOT NULL DEFAULT '["ap-south-1"]',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_data_residency_tenant ON data_residency_configs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_data_residency_jurisdiction ON data_residency_configs(jurisdiction);
