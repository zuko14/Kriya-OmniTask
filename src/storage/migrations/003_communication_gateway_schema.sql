-- ==============================================================================
-- Xylarc AI Migration 003: Omnichannel Communication Gateway Schema
-- Defines channel integrations, outbound message queues, idempotency, and webhook ledgers.
-- ==============================================================================

-- 1. Channel Integrations & Encrypted Provider Credentials
CREATE TABLE IF NOT EXISTS channel_integrations (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    channel_type TEXT NOT NULL, -- whatsapp, voice, email, sms
    provider TEXT NOT NULL, -- meta_cloud_api, twilio, vonage, sendgrid, aws_ses
    status TEXT NOT NULL DEFAULT 'active', -- active, disabled, error
    credentials_encrypted TEXT NOT NULL, -- AES-256-GCM ciphertext containing tokens and secrets
    settings_json TEXT NOT NULL DEFAULT '{}', -- quiet hours, frequency limits, templates
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_tenant_type ON channel_integrations(tenant_id, channel_type);

-- 2. Outbound Message Queue & Idempotency Ledger
CREATE TABLE IF NOT EXISTS outbound_messages (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    customer_id TEXT,
    channel TEXT NOT NULL, -- whatsapp, voice, email, sms
    idempotency_key TEXT NOT NULL,
    recipient TEXT NOT NULL, -- normalized phone number / email
    message_type TEXT NOT NULL, -- text, template, interactive_button, interactive_list, media, voice_call
    payload_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued', -- queued, sending, sent, delivered, read, failed, throttled_quiet_hours, throttled_frequency_limit
    external_message_id TEXT,
    error_message TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    scheduled_at TEXT,
    sent_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_outbound_idempotency ON outbound_messages(tenant_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_outbound_customer ON outbound_messages(tenant_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_outbound_status ON outbound_messages(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_outbound_created ON outbound_messages(tenant_id, created_at DESC);

-- 3. Inbound Webhooks Ledger (Replay Prevention & Traceability)
CREATE TABLE IF NOT EXISTS inbound_webhooks (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    channel TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    raw_payload_json TEXT NOT NULL,
    processed_status TEXT NOT NULL DEFAULT 'received', -- received, processed, failed, ignored
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_inbound_hash ON inbound_webhooks(tenant_id, payload_hash);
CREATE INDEX IF NOT EXISTS idx_inbound_time ON inbound_webhooks(tenant_id, created_at DESC);
