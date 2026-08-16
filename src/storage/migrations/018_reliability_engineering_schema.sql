-- Migration 018: Reliability Engineering Schema
-- Tables: idempotency_keys, dead_letter_jobs, service_dependency_health, operation_recovery_log

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  organization_id TEXT NOT NULL DEFAULT 'default',
  idempotency_key TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_payload TEXT,
  status TEXT NOT NULL DEFAULT 'in_progress', -- 'in_progress', 'completed', 'failed'
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE,
  UNIQUE (tenant_id, idempotency_key, resource_type)
);

CREATE INDEX IF NOT EXISTS idx_idempotency_lookup
  ON idempotency_keys (tenant_id, idempotency_key, resource_type);

CREATE INDEX IF NOT EXISTS idx_idempotency_expiry
  ON idempotency_keys (expires_at);

CREATE TABLE IF NOT EXISTS dead_letter_jobs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  organization_id TEXT NOT NULL DEFAULT 'default',
  job_type TEXT NOT NULL,
  payload TEXT NOT NULL, -- JSON
  failure_reason TEXT NOT NULL,
  error_stack TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  status TEXT NOT NULL DEFAULT 'pending_review', -- 'pending_review', 'retrying', 'discarded', 'resolved'
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_dlq_tenant_status
  ON dead_letter_jobs (tenant_id, status);

CREATE TABLE IF NOT EXISTS service_dependency_health (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  dependency_name TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'healthy', -- 'healthy', 'degraded', 'unhealthy', 'circuit_broken'
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  failure_rate REAL NOT NULL DEFAULT 0.0,
  latency_p95_ms REAL NOT NULL DEFAULT 0.0,
  last_probe_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE,
  UNIQUE (tenant_id, dependency_name)
);

CREATE INDEX IF NOT EXISTS idx_dependency_health_tenant
  ON service_dependency_health (tenant_id, dependency_name);

CREATE TABLE IF NOT EXISTS operation_recovery_log (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  organization_id TEXT NOT NULL DEFAULT 'default',
  operation_id TEXT NOT NULL,
  operation_type TEXT NOT NULL,
  lifecycle_state TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'running', 'verifying', 'completed', 'partially_completed', 'failed', 'retrying', 'failed_permanently', 'cancelled', 'timed_out', 'blocked', 'requires_approval', 'escalated'
  checkpoint_state_json TEXT NOT NULL DEFAULT '{}',
  compensation_action_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_recovery_tenant_op
  ON operation_recovery_log (tenant_id, operation_id);
