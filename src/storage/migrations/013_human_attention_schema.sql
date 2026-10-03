-- Migration 013: Human Attention Center & Priority Exception Queue Schema
-- Tracks human escalations, exception resolution workflows, and live conversation takeovers (§14, §16 of CLAUDE.md)

CREATE TABLE IF NOT EXISTS attention_items (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  organization_id TEXT NOT NULL DEFAULT 'default',
  correlation_id TEXT NOT NULL,
  trace_id TEXT,
  customer_id TEXT,
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  source_agent_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  reason_category TEXT NOT NULL CHECK (reason_category IN (
    'policy_violation',
    'low_confidence',
    'financial_threshold',
    'sensitive_complaint',
    'security_anomaly',
    'agent_disagreement',
    'workflow_suspended',
    'manual_flag',
    'slo_burn'
  )),
  priority TEXT NOT NULL CHECK (priority IN ('P0_CRITICAL', 'P1_HIGH', 'P2_MEDIUM', 'P3_LOW')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'claimed', 'resolved', 'dismissed', 'timed_out')),
  assigned_user_id TEXT,
  context_data_json TEXT NOT NULL DEFAULT '{}',
  recommended_action TEXT,
  resolution_action TEXT CHECK (resolution_action IN ('approved', 'rejected', 'overridden', 'taken_over', 'dismissed')),
  resolution_notes TEXT,
  sla_expires_at TEXT NOT NULL,
  resolved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_attention_items_tenant_status ON attention_items(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_attention_items_tenant_priority ON attention_items(tenant_id, priority);
CREATE INDEX IF NOT EXISTS idx_attention_items_tenant_customer ON attention_items(tenant_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_attention_items_tenant_assigned ON attention_items(tenant_id, assigned_user_id);

CREATE TABLE IF NOT EXISTS conversation_takeovers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  organization_id TEXT NOT NULL DEFAULT 'default',
  customer_id TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  taken_over_by_user_id TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  reason TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_takeovers_tenant_customer ON conversation_takeovers(tenant_id, customer_id, is_active);
