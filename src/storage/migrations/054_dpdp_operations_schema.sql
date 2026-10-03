-- Migration 054: Digital Personal Data Protection (DPDP) Operations Schema (WP-8.2)
-- India DPDP Act 2023 compliance: Consent Ledger (§6, §7), Rights Requests & Erasure Receipts (§11, §12, §13, §14),
-- Automated Data Retention Purges (§8(7)), and Breach Incident Governance (§8(6)).

CREATE TABLE IF NOT EXISTS dpdp_consent_ledger (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  purpose TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('granted', 'withdrawn', 'expired', 'superseded')),
  notice_version TEXT NOT NULL DEFAULT 'v1.0',
  notice_hash TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en',
  valid_until TEXT,
  proof_receipt_id TEXT,
  withdrawn_at TEXT,
  withdrawn_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_dpdp_consent_tenant_customer ON dpdp_consent_ledger(tenant_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_dpdp_consent_purpose ON dpdp_consent_ledger(tenant_id, purpose, status);

CREATE TABLE IF NOT EXISTS dpdp_rights_requests (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  request_type TEXT NOT NULL CHECK (request_type IN ('access', 'correction', 'erasure', 'grievance', 'nominee')),
  status TEXT NOT NULL CHECK (status IN ('submitted', 'in_review', 'completed', 'rejected')),
  payload_json TEXT NOT NULL DEFAULT '{}',
  resolution_notes TEXT,
  erasure_tombstone_hash TEXT,
  proof_receipt_id TEXT,
  sla_expires_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_dpdp_rights_tenant_customer ON dpdp_rights_requests(tenant_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_dpdp_rights_status ON dpdp_rights_requests(tenant_id, status);

CREATE TABLE IF NOT EXISTS dpdp_retention_jobs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  policy_id TEXT,
  target_resource_type TEXT NOT NULL,
  retention_days INTEGER NOT NULL,
  cutoff_timestamp TEXT NOT NULL,
  records_scanned INTEGER NOT NULL DEFAULT 0,
  records_purged INTEGER NOT NULL DEFAULT 0,
  purge_action TEXT NOT NULL CHECK (purge_action IN ('anonymize', 'hard_delete')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  proof_receipt_id TEXT,
  executed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_dpdp_retention_jobs_tenant ON dpdp_retention_jobs(tenant_id, status);

CREATE TABLE IF NOT EXISTS dpdp_breach_incidents (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  incident_name TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')),
  breach_type TEXT NOT NULL CHECK (breach_type IN ('unauthorized_access', 'accidental_exposure', 'ransomware_loss', 'credential_leakage')),
  status TEXT NOT NULL CHECK (status IN ('detected', 'contained', 'notified', 'resolved')),
  affected_principals_count INTEGER NOT NULL DEFAULT 0,
  incident_summary TEXT NOT NULL,
  root_cause TEXT,
  remediation_steps TEXT,
  dpbi_notified_at TEXT,
  dpbi_reference_number TEXT,
  principals_notified_at TEXT,
  dpo_contact TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_dpdp_breach_tenant_status ON dpdp_breach_incidents(tenant_id, status);
