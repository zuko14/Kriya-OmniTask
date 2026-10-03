-- Migration 042: Kriya appointment book (docs/kriya WP-4.3; decision D8)
-- The system of record for tenants without an external calendar. External calendars (WP-5.4) plug in behind
-- the same scheduling tools. The Scheduling agent is the only writer (02 §9 "single writer per resource").

CREATE TABLE IF NOT EXISTS schedule_resources (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,                 -- e.g. "Dr. Rao"
  kind TEXT NOT NULL DEFAULT 'doctor',  -- doctor | room | staff | equipment
  department TEXT,
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  slot_minutes INTEGER NOT NULL DEFAULT 30,
  working_hours_json TEXT NOT NULL,   -- {"mon":[["09:00","13:00"],["14:00","19:00"]], ...}; local time
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_schedule_resources_tenant ON schedule_resources(tenant_id, active);

CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  customer_ref TEXT NOT NULL,         -- bound from the authenticated conversation, never chosen by a model
  customer_name TEXT,
  starts_at TEXT NOT NULL,            -- local "YYYY-MM-DD HH:MM" in the resource timezone
  ends_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('confirmed', 'cancelled')),
  idempotency_key TEXT NOT NULL,
  cancelled_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (resource_id) REFERENCES schedule_resources(id)
);
-- The database, not the agent, makes double-booking impossible.
CREATE UNIQUE INDEX IF NOT EXISTS ux_appointments_slot ON appointments(tenant_id, resource_id, starts_at) WHERE status = 'confirmed';
CREATE UNIQUE INDEX IF NOT EXISTS ux_appointments_idem ON appointments(tenant_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_appointments_customer ON appointments(tenant_id, customer_ref, status);
