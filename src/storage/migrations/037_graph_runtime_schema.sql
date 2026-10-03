-- Migration 037: Graph Runtime (docs/kriya WP-2.2)
-- Durable execution for agent/workflow graphs: one row per run, an append-only checkpoint per
-- executed node, and a side-effect ledger keyed by idempotency key so a resumed run can never
-- repeat a tool call or a receipt.

CREATE TABLE IF NOT EXISTS graph_runs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  graph_id TEXT NOT NULL,
  graph_version TEXT NOT NULL,
  graph_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'parked', 'completed', 'failed')),
  next_node_id TEXT,
  state_json TEXT NOT NULL DEFAULT '{}',
  step_count INTEGER NOT NULL DEFAULT 0,
  visits_json TEXT NOT NULL DEFAULT '{}',
  outcome TEXT,
  park_reason TEXT,
  error_message TEXT,
  correlation_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_graph_runs_tenant_status ON graph_runs(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_graph_runs_graph ON graph_runs(tenant_id, graph_id);

CREATE TABLE IF NOT EXISTS graph_checkpoints (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  step INTEGER NOT NULL,
  node_id TEXT NOT NULL,
  node_kind TEXT NOT NULL,
  next_node_id TEXT,
  state_hash TEXT NOT NULL,
  state_json TEXT NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (run_id, step),
  FOREIGN KEY (run_id) REFERENCES graph_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_graph_checkpoints_run ON graph_checkpoints(tenant_id, run_id, step);

CREATE TABLE IF NOT EXISTS graph_side_effects (
  idempotency_key TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  patch_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES graph_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_graph_side_effects_run ON graph_side_effects(tenant_id, run_id);
