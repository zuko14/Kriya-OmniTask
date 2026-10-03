-- ==============================================================================
-- Xylarc AI Migration 030: Four-Tier Context & Token Architecture Schema (§8, §23)
-- Defines conversation sessions, Tier 1 session state, turn archives,
-- per-tenant/per-task token budgets, and per-language cost tracking.
-- ==============================================================================

-- 1. Conversation Sessions (Tier 0 Context Container & Aggregate Metadata)
CREATE TABLE IF NOT EXISTS conversation_sessions (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    organization_id TEXT NOT NULL DEFAULT 'default',
    customer_id TEXT,
    agent_slug TEXT NOT NULL,
    channel TEXT NOT NULL DEFAULT 'web', -- 'whatsapp', 'voice', 'web', 'email', 'sms'
    language TEXT NOT NULL DEFAULT 'en', -- 'en', 'hi', 'te', 'ta', 'kn', 'bn', 'mr', 'gu'
    status TEXT NOT NULL DEFAULT 'active', -- 'active', 'compacted', 'closed', 'escalated'
    rolling_summary TEXT NOT NULL DEFAULT '',
    total_prompt_tokens INTEGER NOT NULL DEFAULT 0,
    total_completion_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens_spent INTEGER NOT NULL DEFAULT 0,
    total_cost_usd REAL NOT NULL DEFAULT 0.0,
    total_cost_inr REAL NOT NULL DEFAULT 0.0,
    last_compacted_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_tenant ON conversation_sessions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sessions_customer ON conversation_sessions(tenant_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON conversation_sessions(tenant_id, status);

-- 2. Tier 1: Session State (Structured Entities, Decisions, Commitments, Open Items)
CREATE TABLE IF NOT EXISTS conversation_session_states (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    entities_json TEXT NOT NULL DEFAULT '{}',
    decisions_json TEXT NOT NULL DEFAULT '[]',
    commitments_json TEXT NOT NULL DEFAULT '[]',
    open_items_json TEXT NOT NULL DEFAULT '[]',
    version INTEGER NOT NULL DEFAULT 1,
    extracted_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(tenant_id, session_id),
    FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY(session_id) REFERENCES conversation_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_session_states_tenant ON conversation_session_states(tenant_id);
CREATE INDEX IF NOT EXISTS idx_session_states_session ON conversation_session_states(tenant_id, session_id);

-- 3. Conversation Turns (Tier 0 Working Window & Tier 3 Full Immutable Archive)
CREATE TABLE IF NOT EXISTS conversation_turns (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    turn_index INTEGER NOT NULL,
    speaker TEXT NOT NULL, -- 'customer', 'agent', 'system', 'supervisor'
    language TEXT NOT NULL DEFAULT 'en',
    content TEXT NOT NULL,
    structured_payload_json TEXT NOT NULL DEFAULT '{}',
    tokens_prompt INTEGER NOT NULL DEFAULT 0,
    tokens_completion INTEGER NOT NULL DEFAULT 0,
    is_compacted INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY(session_id) REFERENCES conversation_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_turns_tenant_session ON conversation_turns(tenant_id, session_id, turn_index);
CREATE INDEX IF NOT EXISTS idx_turns_compacted ON conversation_turns(tenant_id, session_id, is_compacted);

-- 4. Token Budget Policies (Per-Tenant / Per-Task / Per-Session Ladder)
CREATE TABLE IF NOT EXISTS token_budget_policies (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    task_token_budget INTEGER NOT NULL DEFAULT 8000,
    session_token_budget INTEGER NOT NULL DEFAULT 32000,
    compaction_threshold_pct REAL NOT NULL DEFAULT 65.0, -- 60% - 70% threshold
    warn_threshold_pct REAL NOT NULL DEFAULT 70.0,
    optimize_threshold_pct REAL NOT NULL DEFAULT 85.0,
    restrict_threshold_pct REAL NOT NULL DEFAULT 95.0,
    stop_threshold_pct REAL NOT NULL DEFAULT 100.0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(tenant_id),
    FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_token_budget_tenant ON token_budget_policies(tenant_id);

-- 5. Conversation Language Costs (Per-Language Tracking & Pricing Multipliers)
CREATE TABLE IF NOT EXISTS conversation_language_costs (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    language TEXT NOT NULL, -- 'en', 'hi', 'te', 'ta', 'kn', 'bn', 'mr', 'gu'
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    token_efficiency_multiplier REAL NOT NULL DEFAULT 1.0,
    cost_usd REAL NOT NULL DEFAULT 0.0,
    cost_inr REAL NOT NULL DEFAULT 0.0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(tenant_id, session_id, language),
    FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY(session_id) REFERENCES conversation_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_lang_cost_tenant ON conversation_language_costs(tenant_id, language);
CREATE INDEX IF NOT EXISTS idx_lang_cost_session ON conversation_language_costs(tenant_id, session_id);
