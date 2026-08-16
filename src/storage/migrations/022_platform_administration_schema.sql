-- Migration 022: Platform Administration Schema
-- Operator Control Plane, Tenant Lifecycle, Fleet Health & Node Diagnostics, and System Announcements.

CREATE TABLE IF NOT EXISTS operator_audit_logs (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL,
    target_tenant_id TEXT,
    action_type TEXT NOT NULL, -- 'tenant_provision', 'tenant_suspend', 'tenant_reactivate', 'tenant_delete', 'quota_override', 'maintenance_mode_toggle', 'global_announcement_broadcast', 'emergency_kill_switch'
    reason TEXT NOT NULL,
    metadata_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_operator_logs_target ON operator_audit_logs(target_tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_operator_logs_action ON operator_audit_logs(action_type, created_at);

CREATE TABLE IF NOT EXISTS node_fleet_heartbeats (
    id TEXT PRIMARY KEY,
    node_id TEXT NOT NULL UNIQUE,
    cluster_region TEXT NOT NULL,
    status TEXT NOT NULL, -- 'healthy', 'degraded', 'draining', 'offline'
    cpu_usage_pct REAL NOT NULL,
    memory_usage_pct REAL NOT NULL,
    active_worker_threads INTEGER NOT NULL,
    active_agent_executions INTEGER NOT NULL,
    last_heartbeat_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fleet_status ON node_fleet_heartbeats(status, last_heartbeat_at);

CREATE TABLE IF NOT EXISTS system_announcements (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    severity TEXT NOT NULL, -- 'info', 'warning', 'critical', 'maintenance'
    is_active INTEGER NOT NULL DEFAULT 1,
    target_tenant_ids_json TEXT NOT NULL, -- '["*"]' for all or specific tenant IDs
    starts_at TEXT NOT NULL,
    expires_at TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_announcements_active ON system_announcements(is_active, starts_at);

CREATE TABLE IF NOT EXISTS platform_maintenance_state (
    id TEXT PRIMARY KEY,
    is_maintenance_active INTEGER NOT NULL DEFAULT 0,
    maintenance_message TEXT,
    read_only_mode INTEGER NOT NULL DEFAULT 0,
    emergency_kill_active INTEGER NOT NULL DEFAULT 0,
    activated_by TEXT,
    activated_at TEXT,
    updated_at TEXT NOT NULL
);
