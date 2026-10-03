-- Migration 045: Refunds and Doctor Emergency Leave Reference Workflow Schema (docs/kriya WP-4.7)
-- Subsystem: Payment Refunds, Resource Emergency Leaves, and Settlement Verification

ALTER TABLE appointments ADD COLUMN fee_amount REAL DEFAULT 500.0;
ALTER TABLE appointments ADD COLUMN is_prepaid INTEGER DEFAULT 1;

CREATE TABLE IF NOT EXISTS payment_refunds (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  customer_ref TEXT NOT NULL,
  appointment_id TEXT,
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('processed', 'voided', 'failed')),
  mandate_id TEXT,
  human_approver_id TEXT,
  idempotency_key TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_payment_refunds_tenant ON payment_refunds(tenant_id, customer_ref);
CREATE INDEX IF NOT EXISTS idx_payment_refunds_appointment ON payment_refunds(tenant_id, appointment_id);

CREATE TABLE IF NOT EXISTS doctor_emergency_leaves (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  doctor_name TEXT NOT NULL,
  leave_start TEXT NOT NULL,
  leave_end TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'cancelled')),
  affected_count INTEGER NOT NULL DEFAULT 0,
  resolved_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (resource_id) REFERENCES schedule_resources(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_doctor_leaves_tenant ON doctor_emergency_leaves(tenant_id, resource_id, status);
