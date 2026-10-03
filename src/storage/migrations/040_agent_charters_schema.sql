-- Migration 040: Agent charters (docs/kriya WP-4.1, 02 §9)
-- What an agent owns, which tools it may use, what it may see, its autonomy cap and budgets.
-- Append-only: a published (tenant, agent, version) never changes, so receipts that name an
-- agent version can always be traced to exactly what that agent was allowed to do.

CREATE TABLE IF NOT EXISTS agent_charters (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  agent_slug TEXT NOT NULL,
  version TEXT NOT NULL,
  charter_json TEXT NOT NULL,
  charter_hash TEXT NOT NULL,
  published_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, agent_slug, version),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_charters_tenant_agent ON agent_charters(tenant_id, agent_slug, created_at);
