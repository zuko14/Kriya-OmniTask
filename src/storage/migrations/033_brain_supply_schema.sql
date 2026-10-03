-- ==============================================================================
-- Xylarc AI Migration 033: Brain Supply & Admin Brain Console Schema (§9.5-§9.9, §18.6, §23)
-- Defines BYO / Managed brain supply configurations, tenant active brains,
-- model suitability catalogue, alignment check runs, and spend budget tracking.
-- ==============================================================================

-- 1. Tenant Brain Supply Configuration & Budgets (§9.5, §9.8)
CREATE TABLE IF NOT EXISTS tenant_brain_configs (
    tenant_id TEXT PRIMARY KEY,
    brain_supply TEXT NOT NULL DEFAULT 'byo', -- 'byo' | 'managed'
    monthly_budget_usd REAL NOT NULL DEFAULT 50.0,
    daily_budget_usd REAL NOT NULL DEFAULT 5.0,
    current_month_spend_usd REAL NOT NULL DEFAULT 0.0,
    current_day_spend_usd REAL NOT NULL DEFAULT 0.0,
    spend_anomaly_threshold_multiplier REAL NOT NULL DEFAULT 3.0,
    status TEXT NOT NULL DEFAULT 'active', -- 'active', 'paused_anomaly', 'budget_exhausted', 'degraded'
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_brain_configs_status ON tenant_brain_configs(status);

-- 2. Tenant Active Brains Table (§9.5, §9.8, §18.6.1)
CREATE TABLE IF NOT EXISTS tenant_brains (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    provider TEXT NOT NULL, -- 'openrouter', 'anthropic', 'openai', 'google', etc.
    model_id TEXT NOT NULL,
    model_version TEXT NOT NULL,
    credential_vault_service_slug TEXT,
    key_last_four TEXT NOT NULL, -- Never store plaintext key! Last 4 only
    status TEXT NOT NULL DEFAULT 'certified', -- 'certified', 'stale', 'unhealthy', 'revoked', 'unassigned'
    health_status TEXT NOT NULL DEFAULT 'healthy', -- 'healthy', 'degraded', 'unhealthy', 'halted'
    certified_tiers_json TEXT NOT NULL DEFAULT '[]', -- JSON array of CapabilityTier ('T1', 'T2', etc.)
    certified_languages_json TEXT NOT NULL DEFAULT '[]', -- JSON array of language codes
    assigned_agents_json TEXT NOT NULL DEFAULT '[]', -- JSON array of agent slugs
    current_month_spend_usd REAL NOT NULL DEFAULT 0.0,
    expires_at TEXT,
    last_certified_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tenant_brains_tenant ON tenant_brains(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_brains_status ON tenant_brains(status);

-- 3. Brain Alignment Runs Table (Stage 0-6 Tracking) (§9.7, §18.6.3)
CREATE TABLE IF NOT EXISTS brain_alignment_runs (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    model_id TEXT NOT NULL,
    model_version TEXT NOT NULL,
    provider TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running', -- 'running', 'completed', 'failed', 'cancelled'
    current_stage INTEGER NOT NULL DEFAULT 0,
    stages_json TEXT NOT NULL DEFAULT '{}',
    estimated_cost_usd REAL NOT NULL DEFAULT 0.0,
    actual_cost_usd REAL NOT NULL DEFAULT 0.0,
    report_card_json TEXT NOT NULL DEFAULT '{}',
    error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_alignment_runs_tenant ON brain_alignment_runs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_alignment_runs_status ON brain_alignment_runs(status);

-- 4. Model Catalogue & Suitability Reference Table (§9.6, §18.6.2)
CREATE TABLE IF NOT EXISTS brain_catalogue (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    model_id TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    context_window INTEGER NOT NULL,
    indicative_cost_per_million_inr REAL NOT NULL,
    structured_output_support INTEGER NOT NULL DEFAULT 1,
    tool_calling_support INTEGER NOT NULL DEFAULT 1,
    min_context_window_met INTEGER NOT NULL DEFAULT 1,
    region_compliant INTEGER NOT NULL DEFAULT 1,
    suitability_state TEXT NOT NULL DEFAULT 'SUPPORTED', -- 'RECOMMENDED', 'SUPPORTED', 'MARGINAL', 'UNSUITABLE'
    named_limitation TEXT,
    failed_hard_requirement TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_catalogue_provider ON brain_catalogue(provider);
CREATE INDEX IF NOT EXISTS idx_catalogue_suitability ON brain_catalogue(suitability_state);

-- Seed Initial Model Catalogue with Diverse Suitability Classes (§9.6, §18.6.2)
INSERT OR REPLACE INTO brain_catalogue (
    id, provider, model_id, display_name, context_window, indicative_cost_per_million_inr,
    structured_output_support, tool_calling_support, min_context_window_met, region_compliant,
    suitability_state, named_limitation, failed_hard_requirement, created_at, updated_at
) VALUES 
(
    'cat_claude_3_5_sonnet', 'anthropic', 'claude-3-5-sonnet-20241022', 'Claude 3.5 Sonnet', 200000, 250.0,
    1, 1, 1, 1, 'RECOMMENDED', NULL, NULL,
    datetime('now'), datetime('now')
),
(
    'cat_claude_3_haiku', 'anthropic', 'claude-3-haiku-20240307', 'Claude 3 Haiku', 200000, 20.0,
    1, 1, 1, 1, 'RECOMMENDED', NULL, NULL,
    datetime('now'), datetime('now')
),
(
    'cat_gpt_4o', 'openai', 'gpt-4o', 'GPT-4o Omnimodel', 128000, 210.0,
    1, 1, 1, 1, 'SUPPORTED', NULL, NULL,
    datetime('now'), datetime('now')
),
(
    'cat_mistral_nemo', 'openrouter', 'mistralai/mistral-nemo', 'Mistral Nemo 12B', 128000, 15.0,
    1, 1, 1, 1, 'MARGINAL', 'limited Telugu coverage; weak structured-output adherence under high concurrency', NULL,
    datetime('now'), datetime('now')
),
(
    'cat_llama_3_8b_legacy', 'openrouter', 'meta-llama/llama-3-8b-instruct:free', 'Llama 3 8B Legacy', 8000, 0.0,
    0, 0, 0, 1, 'UNSUITABLE', NULL, 'Fails hard requirements: structured output and minimum 32k context window (has 8k)',
    datetime('now'), datetime('now')
);
