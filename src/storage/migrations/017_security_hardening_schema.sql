-- Migration 017: Security Hardening & Zero-Trust Audit Schema
-- Tracks cryptographically chained tamper-evident audit logs and secret rotations (§14, §20 of CLAUDE.md)

CREATE TABLE IF NOT EXISTS security_audit_ledger (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  organization_id TEXT NOT NULL DEFAULT 'default',
  sequence_number INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  target_resource TEXT NOT NULL,
  action TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  previous_hash TEXT NOT NULL,
  current_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_ledger_seq ON security_audit_ledger(tenant_id, sequence_number);
CREATE INDEX IF NOT EXISTS idx_audit_ledger_tenant_event ON security_audit_ledger(tenant_id, event_type);

CREATE TABLE IF NOT EXISTS secret_rotations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  organization_id TEXT NOT NULL DEFAULT 'default',
  secret_name TEXT NOT NULL,
  secret_version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'grace_period', 'revoked')),
  encrypted_secret_value TEXT NOT NULL,
  rotated_at TEXT NOT NULL,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_secrets_name_ver ON secret_rotations(tenant_id, secret_name, secret_version);
CREATE INDEX IF NOT EXISTS idx_secrets_status ON secret_rotations(tenant_id, status);
