-- ==============================================================================
-- Xylarc AI Migration 002: Customer 360 & Entity Resolution Schema
-- Defines customer profiles, identity resolution aliases, timeline events, and consent records.
-- ==============================================================================

-- 1. Customers Core Table
CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    organization_id TEXT,
    primary_email TEXT,
    primary_phone TEXT,
    external_crm_id TEXT,
    full_name TEXT NOT NULL,
    lifecycle_stage TEXT NOT NULL DEFAULT 'lead', -- lead, qualified, opportunity, customer, active, at_risk, churned, win_back
    sentiment_score REAL NOT NULL DEFAULT 0.0, -- -1.0 to 1.0
    churn_risk_score REAL NOT NULL DEFAULT 0.0, -- 0.0 to 1.0
    preferred_language TEXT NOT NULL DEFAULT 'en',
    preferred_channel TEXT NOT NULL DEFAULT 'whatsapp', -- whatsapp, voice, email, web
    attributes_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'active', -- active, merged, archived
    merged_into_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_customers_tenant ON customers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_customers_org ON customers(organization_id);
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(tenant_id, primary_email);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(tenant_id, primary_phone);
CREATE INDEX IF NOT EXISTS idx_customers_stage ON customers(tenant_id, lifecycle_stage);
CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(tenant_id, status);

-- 2. Customer Identities (Deterministic Entity Resolution Table)
CREATE TABLE IF NOT EXISTS customer_identities (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    customer_id TEXT NOT NULL,
    identity_type TEXT NOT NULL, -- email, phone, whatsapp_id, crm_id, cookie_id, national_id
    identity_value TEXT NOT NULL, -- normalized string
    is_verified INTEGER NOT NULL DEFAULT 0,
    confidence REAL NOT NULL DEFAULT 1.0,
    source TEXT NOT NULL, -- whatsapp_webhook, crm_sync, web_form, call_ani, manual
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_identities_unique ON customer_identities(tenant_id, identity_type, identity_value);
CREATE INDEX IF NOT EXISTS idx_identities_customer ON customer_identities(tenant_id, customer_id);

-- 3. Customer Unified Timeline Events
CREATE TABLE IF NOT EXISTS customer_timeline_events (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    customer_id TEXT NOT NULL,
    channel TEXT NOT NULL, -- whatsapp, voice, email, web, crm, system
    event_type TEXT NOT NULL, -- conversation.started, message.received, message.sent, call.completed, booking.created, order.placed, ticket.created, review.submitted, sentiment.changed, lifecycle.transitioned
    summary TEXT NOT NULL,
    details_json TEXT NOT NULL DEFAULT '{}',
    correlation_id TEXT,
    actor_type TEXT NOT NULL DEFAULT 'system', -- agent, customer, human_operator, system
    actor_id TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_timeline_customer_time ON customer_timeline_events(tenant_id, customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_timeline_event_type ON customer_timeline_events(tenant_id, event_type);

-- 4. Customer Consents & Communication Governance
CREATE TABLE IF NOT EXISTS customer_consents (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    customer_id TEXT NOT NULL,
    consent_type TEXT NOT NULL, -- whatsapp_marketing, voice_calls, email_newsletter, data_processing
    status TEXT NOT NULL DEFAULT 'granted', -- granted, revoked, pending
    granted_at TEXT NOT NULL,
    revoked_at TEXT,
    ip_address TEXT,
    source TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_consents_unique ON customer_consents(tenant_id, customer_id, consent_type);
CREATE INDEX IF NOT EXISTS idx_consents_customer ON customer_consents(tenant_id, customer_id);
