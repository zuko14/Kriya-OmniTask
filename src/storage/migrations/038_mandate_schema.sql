-- Migration 038: Kriya Mandate — delegated authority (docs/kriya WP-3.1, 02 §6)
-- Who (principal) lets which agent do which actions, within what scope, up to what limits, until when.

CREATE TABLE IF NOT EXISTS mandates (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  agent_slug TEXT NOT NULL,
  action_types_json TEXT NOT NULL,
  resource_scope_json TEXT NOT NULL DEFAULT '{}',
  per_action_limit REAL,
  daily_limit REAL,
  currency TEXT NOT NULL DEFAULT 'INR',
  max_count_per_day INTEGER,
  valid_from TEXT NOT NULL,
  valid_until TEXT,
  revoked_at TEXT,
  revoked_by TEXT,
  created_by TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_mandates_tenant_agent ON mandates(tenant_id, agent_slug);

-- Daily consumption per mandate; updated atomically with the authorization decision.
CREATE TABLE IF NOT EXISTS mandate_usage (
  mandate_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  usage_date TEXT NOT NULL,
  total_amount REAL NOT NULL DEFAULT 0,
  action_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (mandate_id, usage_date),
  FOREIGN KEY (mandate_id) REFERENCES mandates(id) ON DELETE CASCADE
);
