-- Migration 032: Failure Escalation Chain Schema (§5, §17.5, §18.5, §23 M6)
-- Tracks structured failure records, supervisor remediation loops, orchestrator reassessments, and unified decision traces.

CREATE TABLE IF NOT EXISTS failure_records (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  agent_slug TEXT NOT NULL,
  failure_class TEXT NOT NULL CHECK (failure_class IN (
    'transient',
    'bad_input',
    'tool_failure',
    'model_failure',
    'capability_gap',
    'scope_mismatch',
    'policy_block',
    'critical_action'
  )),
  stage TEXT NOT NULL,
  error_message TEXT NOT NULL,
  attempts_count INTEGER NOT NULL DEFAULT 1,
  inputs_hash TEXT NOT NULL,
  tool_responses_json TEXT NOT NULL DEFAULT '{}',
  confidence REAL NOT NULL DEFAULT 0.0,
  recoverable INTEGER NOT NULL DEFAULT 1,
  risk_tier TEXT NOT NULL CHECK (risk_tier IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  is_idempotent INTEGER NOT NULL DEFAULT 1,
  remediation_status TEXT NOT NULL CHECK (remediation_status IN (
    'pending',
    'remediated',
    'escalated_to_supervisor',
    'escalated_to_orchestrator',
    'escalated_to_attention',
    'stopped_by_policy'
  )) DEFAULT 'pending',
  escalation_level TEXT NOT NULL CHECK (escalation_level IN ('specialist', 'supervisor', 'orchestrator', 'attention')) DEFAULT 'specialist',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_failure_records_tenant_task ON failure_records(tenant_id, task_id);
CREATE INDEX IF NOT EXISTS idx_failure_records_tenant_class ON failure_records(tenant_id, failure_class);
CREATE INDEX IF NOT EXISTS idx_failure_records_tenant_level ON failure_records(tenant_id, escalation_level);

CREATE TABLE IF NOT EXISTS escalation_traces (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  current_level TEXT NOT NULL CHECK (current_level IN ('specialist', 'supervisor', 'orchestrator', 'attention')),
  status TEXT NOT NULL CHECK (status IN ('in_progress', 'resolved', 'escalated_to_attention', 'stopped_by_policy')),
  total_attempts INTEGER NOT NULL DEFAULT 0,
  total_duration_ms INTEGER NOT NULL DEFAULT 0,
  total_cost_usd REAL NOT NULL DEFAULT 0.0,
  steps_json TEXT NOT NULL DEFAULT '[]',
  attention_item_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_escalation_traces_tenant_task ON escalation_traces(tenant_id, task_id);
CREATE INDEX IF NOT EXISTS idx_escalation_traces_tenant_corr ON escalation_traces(tenant_id, correlation_id);
