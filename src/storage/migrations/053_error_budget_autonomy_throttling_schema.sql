-- Migration 053: Error-Budget Autonomy Throttling Schema (WP-6.3)
-- Implements rolling error budgets, SLA targets, automated step-down throttling,
-- and audited human restoration transitions (CLAUDE.md §15, §37; Blueprint §14; ADR-026)

CREATE TABLE IF NOT EXISTS agent_error_budgets (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  agent_slug TEXT NOT NULL,
  configured_tier_cap TEXT NOT NULL CHECK (configured_tier_cap IN ('T0', 'T1', 'T2', 'T3')),
  effective_tier_cap TEXT NOT NULL CHECK (effective_tier_cap IN ('T0', 'T1', 'T2', 'T3')),
  is_throttled INTEGER NOT NULL DEFAULT 0,
  target_sla_rate REAL NOT NULL DEFAULT 0.99,
  allowed_error_budget REAL NOT NULL DEFAULT 0.01,
  current_error_rate REAL NOT NULL DEFAULT 0.0,
  burned_budget_percent REAL NOT NULL DEFAULT 0.0,
  sample_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  throttled_at TEXT,
  throttled_reason TEXT,
  restored_at TEXT,
  restored_by TEXT,
  last_evaluated_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  UNIQUE(tenant_id, agent_slug)
);

CREATE INDEX IF NOT EXISTS idx_agent_error_budgets_tenant ON agent_error_budgets(tenant_id, agent_slug);
CREATE INDEX IF NOT EXISTS idx_agent_error_budgets_throttled ON agent_error_budgets(tenant_id, is_throttled);

CREATE TABLE IF NOT EXISTS agent_autonomy_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  agent_slug TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('throttled', 'restored', 'budget_warning', 'evaluated')),
  from_tier TEXT NOT NULL CHECK (from_tier IN ('T0', 'T1', 'T2', 'T3')),
  to_tier TEXT NOT NULL CHECK (to_tier IN ('T0', 'T1', 'T2', 'T3')),
  burned_budget_percent REAL NOT NULL,
  reason TEXT NOT NULL,
  actor TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_autonomy_events_tenant ON agent_autonomy_events(tenant_id, agent_slug, created_at);
