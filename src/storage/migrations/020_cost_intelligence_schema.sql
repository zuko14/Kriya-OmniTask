-- Migration 020: Cost Intelligence Schema
-- Multi-tenant real-time cost attribution, business outcome unit economics, and hard budget circuit breakers.

CREATE TABLE IF NOT EXISTS cost_attribution_records (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    organization_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    workflow_execution_id TEXT,
    task_id TEXT NOT NULL,
    cost_category TEXT NOT NULL, -- 'token_llm', 'voice_telephony', 'api_tool', 'vector_search', 'compute_sandbox'
    provider TEXT NOT NULL,      -- 'google', 'openai', 'anthropic', 'deepseek', 'local', 'twilio', 'elevenlabs', 'livekit', 'clearbit', 'stripe', 'custom_api'
    resource_metric_name TEXT NOT NULL, -- 'prompt_tokens', 'completion_tokens', 'voice_minutes', 'api_calls'
    resource_quantity REAL NOT NULL,
    unit_cost_usd REAL NOT NULL,
    total_cost_usd REAL NOT NULL,
    outcome_id TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_cost_tenant_time ON cost_attribution_records(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_cost_tenant_agent ON cost_attribution_records(tenant_id, agent_id);
CREATE INDEX IF NOT EXISTS idx_cost_tenant_outcome ON cost_attribution_records(tenant_id, outcome_id);
CREATE INDEX IF NOT EXISTS idx_cost_tenant_category ON cost_attribution_records(tenant_id, cost_category);

CREATE TABLE IF NOT EXISTS business_outcomes (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    organization_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    workflow_execution_id TEXT,
    outcome_type TEXT NOT NULL, -- 'lead_qualified', 'invoice_processed', 'incident_resolved', 'meeting_scheduled', 'support_ticket_closed', 'contract_analyzed'
    outcome_status TEXT NOT NULL, -- 'achieved', 'failed', 'aborted'
    value_generated_usd REAL NOT NULL DEFAULT 0.0,
    total_cost_usd REAL NOT NULL DEFAULT 0.0,
    roi_multiplier REAL NOT NULL DEFAULT 0.0,
    outcome_metadata_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_outcomes_tenant_type ON business_outcomes(tenant_id, outcome_type);
CREATE INDEX IF NOT EXISTS idx_outcomes_tenant_agent ON business_outcomes(tenant_id, agent_id);

CREATE TABLE IF NOT EXISTS tenant_budget_policies (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    organization_id TEXT NOT NULL,
    monthly_budget_usd REAL NOT NULL,
    daily_budget_usd REAL NOT NULL,
    warning_threshold_pct REAL NOT NULL DEFAULT 80.0,
    hard_cap_action TEXT NOT NULL DEFAULT 'circuit_break_reject', -- 'circuit_break_reject', 'degrade_to_cheapest_model', 'notify_only'
    current_month_spend_usd REAL NOT NULL DEFAULT 0.0,
    current_day_spend_usd REAL NOT NULL DEFAULT 0.0,
    is_circuit_broken INTEGER NOT NULL DEFAULT 0,
    last_reset_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(tenant_id, organization_id),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_budget_tenant ON tenant_budget_policies(tenant_id);
