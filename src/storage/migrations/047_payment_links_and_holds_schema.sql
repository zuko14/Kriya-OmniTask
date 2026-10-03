-- Migration 047: Payment Links, Payment Holds, and Slot Holds Schema (docs/kriya WP-4.4, ADR-011)
-- Subsystem: Payment Collections, Mandate Governed Transactions, and Prepayment Slot Reservations

CREATE TABLE IF NOT EXISTS payment_links (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  customer_ref TEXT NOT NULL,
  customer_name TEXT,
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  description TEXT NOT NULL,
  appointment_id TEXT,
  hold_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('created', 'paid', 'expired', 'cancelled')),
  payment_url TEXT NOT NULL,
  mandate_id TEXT,
  expires_at TEXT NOT NULL,
  paid_at TEXT,
  cancelled_at TEXT,
  cancelled_reason TEXT,
  idempotency_key TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_payment_links_tenant ON payment_links(tenant_id, customer_ref);
CREATE INDEX IF NOT EXISTS idx_payment_links_status ON payment_links(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_payment_links_appt ON payment_links(tenant_id, appointment_id);

CREATE TABLE IF NOT EXISTS payment_holds (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  customer_ref TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  purpose TEXT NOT NULL,
  appointment_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('held', 'captured', 'released', 'expired')),
  expires_at TEXT NOT NULL,
  captured_at TEXT,
  released_at TEXT,
  released_reason TEXT,
  mandate_id TEXT,
  idempotency_key TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_payment_holds_tenant ON payment_holds(tenant_id, customer_ref);
CREATE INDEX IF NOT EXISTS idx_payment_holds_status ON payment_holds(tenant_id, status);

CREATE TABLE IF NOT EXISTS slot_holds (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  customer_ref TEXT NOT NULL,
  customer_name TEXT,
  fee_amount REAL DEFAULT 500.0,
  status TEXT NOT NULL CHECK (status IN ('active', 'released', 'converted', 'expired')),
  expires_at TEXT NOT NULL,
  appointment_id TEXT,
  idempotency_key TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (resource_id) REFERENCES schedule_resources(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_slot_holds_slot ON slot_holds(tenant_id, resource_id, starts_at, status);
CREATE INDEX IF NOT EXISTS idx_slot_holds_cust ON slot_holds(tenant_id, customer_ref, status);
