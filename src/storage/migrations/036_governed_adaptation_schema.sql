-- Migration 036: Governed Adaptation Schema (§6, §23 M12)
-- Tracks failure signatures, deterministic clustering, typed remediation candidates, golden suite simulations, and canary rollouts.

CREATE TABLE IF NOT EXISTS failure_signatures (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  failure_class TEXT NOT NULL,
  business_type TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  agent_slug TEXT NOT NULL,
  stage TEXT NOT NULL,
  root_cause TEXT NOT NULL,
  frequency INTEGER NOT NULL DEFAULT 1,
  cost_usd REAL NOT NULL DEFAULT 0.0,
  customer_impact TEXT NOT NULL,
  model_tier TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_failure_sig_tenant ON failure_signatures(tenant_id);
CREATE INDEX IF NOT EXISTS idx_failure_sig_class ON failure_signatures(failure_class);
CREATE INDEX IF NOT EXISTS idx_failure_sig_agent ON failure_signatures(agent_slug);

CREATE TABLE IF NOT EXISTS adaptation_proposals (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('platform', 'tenant')),
  proposal_type TEXT NOT NULL CHECK (proposal_type IN (
    'new_skill',
    'knowledge_gap',
    'routing_rule',
    'retry_timing',
    'policy_tightening',
    'extraction_correction'
  )),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  target_failure_class TEXT NOT NULL,
  cluster_signature_id TEXT,
  requires_human_approval INTEGER NOT NULL DEFAULT 1,
  proposed_changes_json TEXT NOT NULL DEFAULT '{}',
  golden_suite_validation_json TEXT NOT NULL DEFAULT '{}',
  simulation_status TEXT NOT NULL CHECK (simulation_status IN (
    'pending',
    'passed',
    'regressed',
    'failed'
  )) DEFAULT 'pending',
  approval_status TEXT NOT NULL CHECK (approval_status IN (
    'pending',
    'approved',
    'rejected'
  )) DEFAULT 'pending',
  approved_by TEXT,
  approved_at TEXT,
  deployed_version_tag TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_adaptation_prop_tenant ON adaptation_proposals(tenant_id);
CREATE INDEX IF NOT EXISTS idx_adaptation_prop_status ON adaptation_proposals(approval_status);
CREATE INDEX IF NOT EXISTS idx_adaptation_prop_type ON adaptation_proposals(proposal_type);

CREATE TABLE IF NOT EXISTS adaptation_canary_evaluations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  version_tag TEXT NOT NULL,
  canary_weight_pct INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN (
    'canary_active',
    'promoted',
    'rolled_back'
  )) DEFAULT 'canary_active',
  baseline_metrics_json TEXT NOT NULL DEFAULT '{}',
  canary_metrics_json TEXT NOT NULL DEFAULT '{}',
  regression_detected INTEGER NOT NULL DEFAULT 0,
  rollback_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (proposal_id) REFERENCES adaptation_proposals(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_canary_eval_tenant ON adaptation_canary_evaluations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_canary_eval_status ON adaptation_canary_evaluations(status);
