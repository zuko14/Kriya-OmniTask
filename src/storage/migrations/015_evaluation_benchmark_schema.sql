-- Migration 015: Agent Evaluation Benchmark & Golden Test Suite Schema
-- Tracks golden datasets, batch evaluation benchmarks, and release gating verdicts (§14, §18 of CLAUDE.md)

CREATE TABLE IF NOT EXISTS evaluation_datasets (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  organization_id TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '1.0.0',
  target_agent_id TEXT NOT NULL,
  test_cases_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_eval_datasets_tenant ON evaluation_datasets(tenant_id);
CREATE INDEX IF NOT EXISTS idx_eval_datasets_agent ON evaluation_datasets(tenant_id, target_agent_id);

CREATE TABLE IF NOT EXISTS evaluation_benchmarks (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  organization_id TEXT NOT NULL DEFAULT 'default',
  dataset_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  prompt_version TEXT NOT NULL DEFAULT 'v1',
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  verdict TEXT NOT NULL CHECK (verdict IN ('release_approved', 'release_blocked_regression', 'conditional_pass')),
  total_test_cases INTEGER NOT NULL DEFAULT 0,
  passed_test_cases INTEGER NOT NULL DEFAULT 0,
  failed_test_cases INTEGER NOT NULL DEFAULT 0,
  pass_rate REAL NOT NULL DEFAULT 0.0,
  avg_faithfulness REAL NOT NULL DEFAULT 0.0,
  avg_latency_ms INTEGER NOT NULL DEFAULT 0,
  total_cost_usd REAL NOT NULL DEFAULT 0.0,
  detailed_results_json TEXT NOT NULL DEFAULT '[]',
  started_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (dataset_id) REFERENCES evaluation_datasets(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_eval_benchmarks_tenant_dataset ON evaluation_benchmarks(tenant_id, dataset_id);
CREATE INDEX IF NOT EXISTS idx_eval_benchmarks_tenant_status ON evaluation_benchmarks(tenant_id, status);
