-- Migration 052: Evals-as-CI & Regression Gating Schema (WP-6.2)
-- Tracks CI evaluation runs, model swap regression gates, and agent charter update gates (§14, §18 of CLAUDE.md)

CREATE TABLE IF NOT EXISTS evaluation_ci_runs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  organization_id TEXT NOT NULL DEFAULT 'default',
  suite_id TEXT NOT NULL,
  agent_slug TEXT NOT NULL,
  evaluation_type TEXT NOT NULL CHECK (evaluation_type IN ('standard_ci', 'model_swap_gate', 'charter_gate')),
  baseline_model_id TEXT,
  candidate_model_id TEXT,
  baseline_pass_rate REAL,
  candidate_pass_rate REAL,
  pass_k_trials INTEGER NOT NULL DEFAULT 1,
  safety_breaches INTEGER NOT NULL DEFAULT 0,
  verdict TEXT NOT NULL CHECK (verdict IN ('release_approved', 'release_blocked_regression', 'conditional_pass')),
  gate_notes_json TEXT NOT NULL DEFAULT '[]',
  report_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_eval_ci_runs_tenant_agent ON evaluation_ci_runs(tenant_id, agent_slug);
CREATE INDEX IF NOT EXISTS idx_eval_ci_runs_tenant_verdict ON evaluation_ci_runs(tenant_id, verdict);
