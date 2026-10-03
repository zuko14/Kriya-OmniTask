-- ==============================================================================
-- Xylarc AI Migration 031: Model Registry, Certification & Skill Library Schema (§9, §17.3-17.4, §23)
-- Defines model certification matrix (per tier × per language),
-- deterministic skill library, and skill test execution ledgers.
-- ==============================================================================

-- 1. Model Certifications Matrix Table (Tier × Language)
CREATE TABLE IF NOT EXISTS model_certifications (
    id TEXT PRIMARY KEY,
    model_id TEXT NOT NULL,
    model_version TEXT NOT NULL,
    provider TEXT NOT NULL,
    upstream_provider TEXT NOT NULL DEFAULT 'direct', -- 'direct', 'openrouter', 'bedrock', 'azure'
    tier TEXT NOT NULL, -- 'T1', 'T2', 'T3', 'T4'
    language TEXT NOT NULL, -- 'en', 'hi', 'te', 'ta', 'kn', 'bn', 'mr', 'gu'
    eval_suite_version TEXT NOT NULL DEFAULT 'v1.0.0',
    status TEXT NOT NULL DEFAULT 'uncertified', -- 'certified', 'uncertified', 'expired', 'stale', 'failed'
    pass_rate REAL NOT NULL DEFAULT 0.0,
    latency_p95_ms REAL NOT NULL DEFAULT 0.0,
    cost_per_task_usd REAL NOT NULL DEFAULT 0.0,
    stage_results_json TEXT NOT NULL DEFAULT '{}', -- Details of stages 0-6
    certified_at TEXT,
    expires_at TEXT,
    certified_by TEXT NOT NULL DEFAULT 'system_harness',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(model_id, tier, language)
);

CREATE INDEX IF NOT EXISTS idx_model_certs_model ON model_certifications(model_id);
CREATE INDEX IF NOT EXISTS idx_model_certs_tier_lang ON model_certifications(tier, language);
CREATE INDEX IF NOT EXISTS idx_model_certs_status ON model_certifications(status);

-- 2. Deterministic Skill Library (§9.3, §17.4)
CREATE TABLE IF NOT EXISTS skills (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    version TEXT NOT NULL DEFAULT '1.0.0',
    category TEXT NOT NULL, -- 'extraction', 'validation', 'normalization', 'calculation', 'security', 'compliance'
    description TEXT NOT NULL,
    input_schema_json TEXT NOT NULL DEFAULT '{}',
    output_schema_json TEXT NOT NULL DEFAULT '{}',
    is_deterministic INTEGER NOT NULL DEFAULT 1,
    test_status TEXT NOT NULL DEFAULT 'passed', -- 'passed', 'failed', 'untested'
    last_tested_at TEXT,
    granted_dna_profiles_json TEXT NOT NULL DEFAULT '["*"]',
    invocation_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_skills_category ON skills(category);
CREATE INDEX IF NOT EXISTS idx_skills_test_status ON skills(test_status);

-- 3. Skill Test Execution History
CREATE TABLE IF NOT EXISTS skill_test_executions (
    id TEXT PRIMARY KEY,
    skill_id TEXT NOT NULL,
    status TEXT NOT NULL, -- 'passed', 'failed'
    assertions_count INTEGER NOT NULL DEFAULT 0,
    duration_ms REAL NOT NULL DEFAULT 0.0,
    error_message TEXT,
    details_json TEXT NOT NULL DEFAULT '{}',
    executed_at TEXT NOT NULL,
    FOREIGN KEY(skill_id) REFERENCES skills(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_skill_tests_skill ON skill_test_executions(skill_id, executed_at DESC);
