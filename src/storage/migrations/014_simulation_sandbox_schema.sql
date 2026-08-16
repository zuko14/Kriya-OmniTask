-- Migration 014: Agent Simulation & Dry-Run Sandbox Schema
-- Tracks simulation scenarios, dry-run sandbox executions, and behavioral regression reports (§14, §17 of CLAUDE.md)

CREATE TABLE IF NOT EXISTS simulation_scenarios (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  organization_id TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN (
    'lead_qualification',
    'customer_support',
    'calendar_booking',
    'reactivation',
    'adversarial_test',
    'edge_case'
  )),
  target_agent_id TEXT NOT NULL,
  mock_customer_json TEXT NOT NULL DEFAULT '{}',
  initial_message TEXT NOT NULL,
  conversation_history_json TEXT NOT NULL DEFAULT '[]',
  mock_tool_responses_json TEXT NOT NULL DEFAULT '{}',
  expected_outcomes_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sim_scenarios_tenant ON simulation_scenarios(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sim_scenarios_category ON simulation_scenarios(tenant_id, category);
CREATE INDEX IF NOT EXISTS idx_sim_scenarios_agent ON simulation_scenarios(tenant_id, target_agent_id);

CREATE TABLE IF NOT EXISTS simulation_runs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  organization_id TEXT NOT NULL DEFAULT 'default',
  scenario_id TEXT NOT NULL,
  run_mode TEXT NOT NULL CHECK (run_mode IN ('dry_run', 'replay', 'synthetic')),
  status TEXT NOT NULL CHECK (status IN ('running', 'passed', 'failed', 'regression_detected')),
  simulated_output TEXT NOT NULL,
  simulated_tool_calls_json TEXT NOT NULL DEFAULT '[]',
  policy_verdicts_json TEXT NOT NULL DEFAULT '[]',
  comparison_report_json TEXT NOT NULL DEFAULT '{}',
  latency_ms INTEGER NOT NULL DEFAULT 0,
  tokens_used INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0.0,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (scenario_id) REFERENCES simulation_scenarios(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sim_runs_tenant_scenario ON simulation_runs(tenant_id, scenario_id);
CREATE INDEX IF NOT EXISTS idx_sim_runs_tenant_status ON simulation_runs(tenant_id, status);
