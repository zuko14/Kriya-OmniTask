-- Kriya Omnitask — Tenant Connectors Schema (WP-5.4, Blueprint §05, §13, ADR-011)
-- Manages third-party connector configurations (Google Calendar, etc.) linked to AES-256-GCM vault secrets.

CREATE TABLE IF NOT EXISTS tenant_connectors (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,                         -- 'google_calendar', 'outlook_calendar', etc.
    category TEXT NOT NULL,                         -- 'calendar', 'crm', 'communication', etc.
    name TEXT NOT NULL,                             -- Human-readable name, e.g. 'Clinic Main Calendar'
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disconnected', 'expired', 'error')),
    credential_slug TEXT NOT NULL,                  -- Slug in CredentialVault (AES-256-GCM encrypted)
    settings_json TEXT NOT NULL DEFAULT '{}',       -- Provider-specific settings (e.g. { calendarId: 'primary', syncSlotMinutes: 30 })
    last_synced_at TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(tenant_id, provider, name)
);

CREATE INDEX IF NOT EXISTS idx_tenant_connectors_lookup 
ON tenant_connectors (tenant_id, provider, status);

CREATE INDEX IF NOT EXISTS idx_tenant_connectors_category
ON tenant_connectors (tenant_id, category);

-- Optional external event binding on appointments and slot holds
ALTER TABLE appointments ADD COLUMN external_event_id TEXT;
ALTER TABLE slot_holds ADD COLUMN external_hold_ref TEXT;
