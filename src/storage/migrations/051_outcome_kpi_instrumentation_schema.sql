-- Migration 051: Outcome Instrumentation & Blueprint KPI Framework (docs/kriya WP-6.1, Blueprint §14, CLAUDE.md §35, §39)
-- Captures ground-truth outcome metrics snapshots and cost cascade (L0-L3) execution events.

CREATE TABLE IF NOT EXISTS outcome_metrics_snapshots (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  window_type TEXT NOT NULL CHECK (window_type IN ('1h', '24h', '7d', '30d', 'custom')),
  window_start TEXT NOT NULL,
  window_end TEXT NOT NULL,
  dimension_type TEXT NOT NULL CHECK (dimension_type IN ('tenant', 'agent', 'workflow', 'overall')),
  dimension_id TEXT NOT NULL DEFAULT 'all',
  metrics_json TEXT NOT NULL,
  calculated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_outcome_snapshots_tenant_dim 
ON outcome_metrics_snapshots(tenant_id, dimension_type, dimension_id, calculated_at);

CREATE TABLE IF NOT EXISTS cascade_execution_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  run_id TEXT,
  correlation_id TEXT,
  agent_id TEXT NOT NULL,
  workflow_id TEXT,
  cascade_level TEXT NOT NULL CHECK (cascade_level IN ('L0_rule', 'L1_cache', 'L2_fast_model', 'L3_reasoning_model', 'human_review')),
  model_id TEXT,
  resolved INTEGER NOT NULL DEFAULT 1,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0.0,
  rule_name TEXT,
  details_json TEXT DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_cascade_events_tenant_time 
ON cascade_execution_events(tenant_id, created_at);

CREATE INDEX IF NOT EXISTS idx_cascade_events_tenant_agent 
ON cascade_execution_events(tenant_id, agent_id, created_at);

CREATE INDEX IF NOT EXISTS idx_cascade_events_tenant_level 
ON cascade_execution_events(tenant_id, cascade_level, created_at);
