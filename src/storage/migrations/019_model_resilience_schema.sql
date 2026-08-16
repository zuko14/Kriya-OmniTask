-- Migration 019: Model Provider Resilience Schema
-- Tables: model_registry, tenant_model_policies, model_routing_decisions

CREATE TABLE IF NOT EXISTS model_registry (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL, -- 'google', 'openai', 'anthropic', 'deepseek', 'local'
  model_identifier TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', -- 'active', 'deprecated', 'disabled', 'experimental'
  context_window_tokens INTEGER NOT NULL DEFAULT 128000,
  input_cost_per_1k REAL NOT NULL DEFAULT 0.0001,
  output_cost_per_1k REAL NOT NULL DEFAULT 0.0002,
  capabilities_json TEXT NOT NULL DEFAULT '[]', -- JSON array of strings
  allowed_data_classifications_json TEXT NOT NULL DEFAULT '["public","internal","confidential","restricted"]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_model_registry_provider_status
  ON model_registry (provider, status);

CREATE TABLE IF NOT EXISTS tenant_model_policies (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  organization_id TEXT NOT NULL DEFAULT 'default',
  default_primary_model_id TEXT NOT NULL,
  default_fallback_model_id TEXT NOT NULL,
  disallowed_providers_json TEXT NOT NULL DEFAULT '[]',
  max_cost_per_query_usd REAL NOT NULL DEFAULT 1.0,
  require_local_for_confidential INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE,
  UNIQUE (tenant_id, organization_id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_model_policy
  ON tenant_model_policies (tenant_id, organization_id);

CREATE TABLE IF NOT EXISTS model_routing_decisions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  organization_id TEXT NOT NULL DEFAULT 'default',
  task_id TEXT NOT NULL,
  task_type TEXT NOT NULL,
  selected_model_id TEXT NOT NULL,
  selected_provider TEXT NOT NULL,
  fallback_occurred INTEGER NOT NULL DEFAULT 0,
  fallback_chain_json TEXT NOT NULL DEFAULT '[]',
  decision_rationale TEXT NOT NULL,
  latency_ms REAL NOT NULL DEFAULT 0.0,
  cost_usd REAL NOT NULL DEFAULT 0.0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_routing_decisions_tenant_task
  ON model_routing_decisions (tenant_id, task_type);
