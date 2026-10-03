-- Migration 056: Reliability Drills, Failover Runbooks & Point-In-Time Recovery Schema (WP-8.4)
-- Subsystem: Chaos Injection Drills (Staging Only), PITR Snapshots/Restores, High-Availability Failovers

CREATE TABLE IF NOT EXISTS reliability_drill_runs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  drill_name TEXT NOT NULL,
  fault_type TEXT NOT NULL CHECK (fault_type IN ('network_drop_retry', 'llm_rate_limit_fallback', 'db_pool_exhaustion', 'worker_queue_crash', 'latency_spike')),
  environment TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('passed', 'failed', 'aborted')),
  injected_count INTEGER NOT NULL,
  survived_count INTEGER NOT NULL,
  recovery_time_ms INTEGER NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_reliability_drill_runs_tenant ON reliability_drill_runs(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS pitr_snapshots (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  snapshot_name TEXT NOT NULL,
  snapshot_type TEXT NOT NULL CHECK (snapshot_type IN ('full', 'incremental', 'wal_checkpoint')),
  checksum_sha256 TEXT NOT NULL,
  record_counts_json TEXT NOT NULL DEFAULT '{}',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  data_payload_json TEXT,
  status TEXT NOT NULL CHECK (status IN ('completed', 'corrupted', 'pending')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pitr_snapshots_tenant ON pitr_snapshots(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS pitr_restore_operations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  target_timestamp TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('completed', 'verified', 'failed', 'in_progress')),
  restored_records_count INTEGER NOT NULL DEFAULT 0,
  verified INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  executed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (snapshot_id) REFERENCES pitr_snapshots(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pitr_restore_operations_tenant ON pitr_restore_operations(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS failover_drill_runs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  drill_name TEXT NOT NULL,
  primary_node_id TEXT NOT NULL,
  promoted_replica_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
  failover_time_ms INTEGER NOT NULL,
  steps_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_failover_drill_runs_tenant ON failover_drill_runs(tenant_id, created_at DESC);
