-- Migration 043: Attention routing & Verification schema (docs/kriya WP-4.6)
-- Routing rules to the right human by role, branch, and hours.
-- Verification jobs for async read-back checks by the Verification agent.

-- 1. Extend attention_items with routing & branch fields
ALTER TABLE attention_items ADD COLUMN assigned_role TEXT;
ALTER TABLE attention_items ADD COLUMN branch_id TEXT;
ALTER TABLE attention_items ADD COLUMN routed_at TEXT;
ALTER TABLE attention_items ADD COLUMN routing_rule_id TEXT;
ALTER TABLE attention_items ADD COLUMN after_hours INTEGER NOT NULL DEFAULT 0;
ALTER TABLE attention_items ADD COLUMN next_available_at TEXT;

CREATE INDEX IF NOT EXISTS idx_attention_items_tenant_role ON attention_items(tenant_id, assigned_role, status);
CREATE INDEX IF NOT EXISTS idx_attention_items_tenant_branch ON attention_items(tenant_id, branch_id);

-- 2. Tenant branches with local operating hours and timezone
CREATE TABLE IF NOT EXISTS branches (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  code TEXT,
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  working_hours_json TEXT NOT NULL,
  emergency_role TEXT NOT NULL DEFAULT 'emergency_on_call',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_branches_tenant ON branches(tenant_id, active);

-- 3. Deterministic attention routing rules
CREATE TABLE IF NOT EXISTS attention_routing_rules (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  priority_order INTEGER NOT NULL DEFAULT 100,
  conditions_json TEXT NOT NULL,
  target_role TEXT NOT NULL,
  target_user_id TEXT,
  branch_id TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_routing_rules_tenant ON attention_routing_rules(tenant_id, active, priority_order);

-- 4. Verification jobs for async read-back checks by the Verification agent
CREATE TABLE IF NOT EXISTS verification_jobs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  tool_slug TEXT NOT NULL,
  action_input_json TEXT NOT NULL,
  action_output_json TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'verified', 'mismatch', 'expired')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  deadline_at TEXT NOT NULL,
  next_check_at TEXT NOT NULL,
  observed_state_json TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_verification_jobs_tenant_status ON verification_jobs(tenant_id, status, next_check_at);
CREATE UNIQUE INDEX IF NOT EXISTS ux_verification_jobs_idem ON verification_jobs(tenant_id, idempotency_key);
