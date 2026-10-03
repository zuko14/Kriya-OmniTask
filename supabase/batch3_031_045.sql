
-- Migration 031: model_certification_skills_schema
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

INSERT INTO _schema_migrations (version, name, applied_at) VALUES ('031', 'model_certification_skills_schema', CURRENT_TIMESTAMP) ON CONFLICT (version) DO NOTHING;

-- Migration 032: failure_escalation_schema
-- Migration 032: Failure Escalation Chain Schema (§5, §17.5, §18.5, §23 M6)
-- Tracks structured failure records, supervisor remediation loops, orchestrator reassessments, and unified decision traces.

CREATE TABLE IF NOT EXISTS failure_records (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  agent_slug TEXT NOT NULL,
  failure_class TEXT NOT NULL CHECK (failure_class IN (
    'transient',
    'bad_input',
    'tool_failure',
    'model_failure',
    'capability_gap',
    'scope_mismatch',
    'policy_block',
    'critical_action'
  )),
  stage TEXT NOT NULL,
  error_message TEXT NOT NULL,
  attempts_count INTEGER NOT NULL DEFAULT 1,
  inputs_hash TEXT NOT NULL,
  tool_responses_json TEXT NOT NULL DEFAULT '{}',
  confidence REAL NOT NULL DEFAULT 0.0,
  recoverable INTEGER NOT NULL DEFAULT 1,
  risk_tier TEXT NOT NULL CHECK (risk_tier IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  is_idempotent INTEGER NOT NULL DEFAULT 1,
  remediation_status TEXT NOT NULL CHECK (remediation_status IN (
    'pending',
    'remediated',
    'escalated_to_supervisor',
    'escalated_to_orchestrator',
    'escalated_to_attention',
    'stopped_by_policy'
  )) DEFAULT 'pending',
  escalation_level TEXT NOT NULL CHECK (escalation_level IN ('specialist', 'supervisor', 'orchestrator', 'attention')) DEFAULT 'specialist',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_failure_records_tenant_task ON failure_records(tenant_id, task_id);
CREATE INDEX IF NOT EXISTS idx_failure_records_tenant_class ON failure_records(tenant_id, failure_class);
CREATE INDEX IF NOT EXISTS idx_failure_records_tenant_level ON failure_records(tenant_id, escalation_level);

CREATE TABLE IF NOT EXISTS escalation_traces (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  current_level TEXT NOT NULL CHECK (current_level IN ('specialist', 'supervisor', 'orchestrator', 'attention')),
  status TEXT NOT NULL CHECK (status IN ('in_progress', 'resolved', 'escalated_to_attention', 'stopped_by_policy')),
  total_attempts INTEGER NOT NULL DEFAULT 0,
  total_duration_ms INTEGER NOT NULL DEFAULT 0,
  total_cost_usd REAL NOT NULL DEFAULT 0.0,
  steps_json TEXT NOT NULL DEFAULT '[]',
  attention_item_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_escalation_traces_tenant_task ON escalation_traces(tenant_id, task_id);
CREATE INDEX IF NOT EXISTS idx_escalation_traces_tenant_corr ON escalation_traces(tenant_id, correlation_id);

INSERT INTO _schema_migrations (version, name, applied_at) VALUES ('032', 'failure_escalation_schema', CURRENT_TIMESTAMP) ON CONFLICT (version) DO NOTHING;

-- Migration 033: brain_supply_schema
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
INSERT INTO brain_catalogue (
    id, provider, model_id, display_name, context_window, indicative_cost_per_million_inr,
    structured_output_support, tool_calling_support, min_context_window_met, region_compliant,
    suitability_state, named_limitation, failed_hard_requirement, created_at, updated_at
) VALUES 
(
    'cat_claude_3_5_sonnet', 'anthropic', 'claude-3-5-sonnet-20241022', 'Claude 3.5 Sonnet', 200000, 250.0,
    1, 1, 1, 1, 'RECOMMENDED', NULL, NULL,
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
),
(
    'cat_claude_3_haiku', 'anthropic', 'claude-3-haiku-20240307', 'Claude 3 Haiku', 200000, 20.0,
    1, 1, 1, 1, 'RECOMMENDED', NULL, NULL,
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
),
(
    'cat_gpt_4o', 'openai', 'gpt-4o', 'GPT-4o Omnimodel', 128000, 210.0,
    1, 1, 1, 1, 'SUPPORTED', NULL, NULL,
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
),
(
    'cat_mistral_nemo', 'openrouter', 'mistralai/mistral-nemo', 'Mistral Nemo 12B', 128000, 15.0,
    1, 1, 1, 1, 'MARGINAL', 'limited Telugu coverage; weak structured-output adherence under high concurrency', NULL,
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
),
(
    'cat_llama_3_8b_legacy', 'openrouter', 'meta-llama/llama-3-8b-instruct:free', 'Llama 3 8B Legacy', 8000, 0.0,
    0, 0, 0, 1, 'UNSUITABLE', NULL, 'Fails hard requirements: structured output and minimum 32k context window (has 8k)',
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
) ON CONFLICT (id) DO NOTHING;

INSERT INTO _schema_migrations (version, name, applied_at) VALUES ('033', 'brain_supply_schema', CURRENT_TIMESTAMP) ON CONFLICT (version) DO NOTHING;

-- Migration 034: secured_external_retrieval_schema
-- ============================================================================
-- Migration 034: Secured External Retrieval Schema (§10.3, §10.4)
-- Tables for Search Grants, Domain Reputation, and External Fact Audit Lineage
-- ============================================================================

-- 1. Search Grants per Agent (§10.4: Search grants are per-agent and off by default)
CREATE TABLE IF NOT EXISTS external_search_grants (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    agent_slug TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0, -- 0 = disabled (off by default), 1 = enabled
    allowed_domains_json TEXT NOT NULL DEFAULT '[]',
    max_daily_queries INTEGER NOT NULL DEFAULT 100,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(tenant_id, agent_slug)
);

CREATE INDEX IF NOT EXISTS idx_search_grants_tenant ON external_search_grants(tenant_id);

-- 2. Domain Reputation & Security Denylist Tracker (§10.3, §10.4)
CREATE TABLE IF NOT EXISTS domain_reputation_ledger (
    domain TEXT PRIMARY KEY,
    reputation_score INTEGER NOT NULL DEFAULT 100, -- 0 to 100
    injection_attempts_count INTEGER NOT NULL DEFAULT 0,
    last_violation_at TEXT,
    is_auto_denylisted INTEGER NOT NULL DEFAULT 0, -- 1 if >= 3 injection hits
    denylisted_at TEXT,
    denylist_reason TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- 3. External Retrieval Events & Provenance Lineage (§10.3, §10.4)
CREATE TABLE IF NOT EXISTS external_retrieval_events (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    correlation_id TEXT NOT NULL,
    agent_slug TEXT NOT NULL,
    topic TEXT NOT NULL,
    query_text TEXT NOT NULL,
    source_url TEXT NOT NULL,
    domain TEXT NOT NULL,
    trust_tier TEXT NOT NULL, -- 'TIER_C', 'TIER_D'
    content_hash TEXT NOT NULL,
    status TEXT NOT NULL, -- 'success', 'blocked_pii', 'blocked_gateway', 'sanitized_injection'
    security_flags_json TEXT NOT NULL DEFAULT '[]',
    freshness_ttl_seconds INTEGER NOT NULL DEFAULT 3600,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_retrieval_events_tenant ON external_retrieval_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_retrieval_events_correlation ON external_retrieval_events(correlation_id);

INSERT INTO _schema_migrations (version, name, applied_at) VALUES ('034', 'secured_external_retrieval_schema', CURRENT_TIMESTAMP) ON CONFLICT (version) DO NOTHING;

-- Migration 035: realtime_data_layer_schema
-- ============================================================================
-- Migration 035: Real-Time Data Layer Stream Schema (§19 of CLAUDE1.md)
-- Monotonic Event Ledger for Live Workforce Activity & SSE Streaming
-- ============================================================================

CREATE TABLE IF NOT EXISTS realtime_event_stream (
    seq SERIAL PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    ts TEXT NOT NULL,
    type TEXT NOT NULL,
    agent_id TEXT,
    execution_id TEXT,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_realtime_stream_tenant_seq
    ON realtime_event_stream (tenant_id, seq);

CREATE INDEX IF NOT EXISTS idx_realtime_stream_tenant_ts
    ON realtime_event_stream (tenant_id, ts);

CREATE INDEX IF NOT EXISTS idx_realtime_stream_agent
    ON realtime_event_stream (tenant_id, agent_id);

INSERT INTO _schema_migrations (version, name, applied_at) VALUES ('035', 'realtime_data_layer_schema', CURRENT_TIMESTAMP) ON CONFLICT (version) DO NOTHING;

-- Migration 036: governed_adaptation_schema
-- Migration 036: Governed Adaptation Schema (§6, §23 M12)
-- Tracks failure signatures, deterministic clustering, typed remediation candidates, golden suite simulations, and canary rollouts.

CREATE TABLE IF NOT EXISTS failure_signatures (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  failure_class TEXT NOT NULL,
  business_type TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  agent_slug TEXT NOT NULL,
  stage TEXT NOT NULL,
  root_cause TEXT NOT NULL,
  frequency INTEGER NOT NULL DEFAULT 1,
  cost_usd REAL NOT NULL DEFAULT 0.0,
  customer_impact TEXT NOT NULL,
  model_tier TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_failure_sig_tenant ON failure_signatures(tenant_id);
CREATE INDEX IF NOT EXISTS idx_failure_sig_class ON failure_signatures(failure_class);
CREATE INDEX IF NOT EXISTS idx_failure_sig_agent ON failure_signatures(agent_slug);

CREATE TABLE IF NOT EXISTS adaptation_proposals (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('platform', 'tenant')),
  proposal_type TEXT NOT NULL CHECK (proposal_type IN (
    'new_skill',
    'knowledge_gap',
    'routing_rule',
    'retry_timing',
    'policy_tightening',
    'extraction_correction'
  )),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  target_failure_class TEXT NOT NULL,
  cluster_signature_id TEXT,
  requires_human_approval INTEGER NOT NULL DEFAULT 1,
  proposed_changes_json TEXT NOT NULL DEFAULT '{}',
  golden_suite_validation_json TEXT NOT NULL DEFAULT '{}',
  simulation_status TEXT NOT NULL CHECK (simulation_status IN (
    'pending',
    'passed',
    'regressed',
    'failed'
  )) DEFAULT 'pending',
  approval_status TEXT NOT NULL CHECK (approval_status IN (
    'pending',
    'approved',
    'rejected'
  )) DEFAULT 'pending',
  approved_by TEXT,
  approved_at TEXT,
  deployed_version_tag TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_adaptation_prop_tenant ON adaptation_proposals(tenant_id);
CREATE INDEX IF NOT EXISTS idx_adaptation_prop_status ON adaptation_proposals(approval_status);
CREATE INDEX IF NOT EXISTS idx_adaptation_prop_type ON adaptation_proposals(proposal_type);

CREATE TABLE IF NOT EXISTS adaptation_canary_evaluations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  version_tag TEXT NOT NULL,
  canary_weight_pct INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN (
    'canary_active',
    'promoted',
    'rolled_back'
  )) DEFAULT 'canary_active',
  baseline_metrics_json TEXT NOT NULL DEFAULT '{}',
  canary_metrics_json TEXT NOT NULL DEFAULT '{}',
  regression_detected INTEGER NOT NULL DEFAULT 0,
  rollback_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (proposal_id) REFERENCES adaptation_proposals(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_canary_eval_tenant ON adaptation_canary_evaluations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_canary_eval_status ON adaptation_canary_evaluations(status);

INSERT INTO _schema_migrations (version, name, applied_at) VALUES ('036', 'governed_adaptation_schema', CURRENT_TIMESTAMP) ON CONFLICT (version) DO NOTHING;

-- Migration 037: graph_runtime_schema
-- Migration 037: Graph Runtime (docs/kriya WP-2.2)
-- Durable execution for agent/workflow graphs: one row per run, an append-only checkpoint per
-- executed node, and a side-effect ledger keyed by idempotency key so a resumed run can never
-- repeat a tool call or a receipt.

CREATE TABLE IF NOT EXISTS graph_runs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  graph_id TEXT NOT NULL,
  graph_version TEXT NOT NULL,
  graph_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'parked', 'completed', 'failed')),
  next_node_id TEXT,
  state_json TEXT NOT NULL DEFAULT '{}',
  step_count INTEGER NOT NULL DEFAULT 0,
  visits_json TEXT NOT NULL DEFAULT '{}',
  outcome TEXT,
  park_reason TEXT,
  error_message TEXT,
  correlation_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_graph_runs_tenant_status ON graph_runs(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_graph_runs_graph ON graph_runs(tenant_id, graph_id);

CREATE TABLE IF NOT EXISTS graph_checkpoints (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  step INTEGER NOT NULL,
  node_id TEXT NOT NULL,
  node_kind TEXT NOT NULL,
  next_node_id TEXT,
  state_hash TEXT NOT NULL,
  state_json TEXT NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (run_id, step),
  FOREIGN KEY (run_id) REFERENCES graph_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_graph_checkpoints_run ON graph_checkpoints(tenant_id, run_id, step);

CREATE TABLE IF NOT EXISTS graph_side_effects (
  idempotency_key TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  patch_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES graph_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_graph_side_effects_run ON graph_side_effects(tenant_id, run_id);

INSERT INTO _schema_migrations (version, name, applied_at) VALUES ('037', 'graph_runtime_schema', CURRENT_TIMESTAMP) ON CONFLICT (version) DO NOTHING;

-- Migration 038: mandate_schema
-- Migration 038: Kriya Mandate — delegated authority (docs/kriya WP-3.1, 02 §6)
-- Who (principal) lets which agent do which actions, within what scope, up to what limits, until when.

CREATE TABLE IF NOT EXISTS mandates (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  agent_slug TEXT NOT NULL,
  action_types_json TEXT NOT NULL,
  resource_scope_json TEXT NOT NULL DEFAULT '{}',
  per_action_limit REAL,
  daily_limit REAL,
  currency TEXT NOT NULL DEFAULT 'INR',
  max_count_per_day INTEGER,
  valid_from TEXT NOT NULL,
  valid_until TEXT,
  revoked_at TEXT,
  revoked_by TEXT,
  created_by TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_mandates_tenant_agent ON mandates(tenant_id, agent_slug);

-- Daily consumption per mandate; updated atomically with the authorization decision.
CREATE TABLE IF NOT EXISTS mandate_usage (
  mandate_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  usage_date TEXT NOT NULL,
  total_amount REAL NOT NULL DEFAULT 0,
  action_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (mandate_id, usage_date),
  FOREIGN KEY (mandate_id) REFERENCES mandates(id) ON DELETE CASCADE
);

INSERT INTO _schema_migrations (version, name, applied_at) VALUES ('038', 'mandate_schema', CURRENT_TIMESTAMP) ON CONFLICT (version) DO NOTHING;

-- Migration 039: proof_receipts_schema
-- Migration 039: Kriya Proof — signed, hash-chained action receipts (docs/kriya WP-3.3, 02 §7)

-- Public halves of the platform signing keys, kept forever so old receipts stay verifiable offline.
CREATE TABLE IF NOT EXISTS proof_signing_keys (
  key_id TEXT PRIMARY KEY,
  algorithm TEXT NOT NULL DEFAULT 'ed25519',
  public_key_pem TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS proof_receipts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  run_id TEXT,
  node_id TEXT,
  action_type TEXT NOT NULL,
  risk_tier TEXT NOT NULL,
  body_json TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL,
  key_id TEXT NOT NULL,
  signature TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  UNIQUE (tenant_id, sequence),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (key_id) REFERENCES proof_signing_keys(key_id)
);

CREATE INDEX IF NOT EXISTS idx_proof_receipts_run ON proof_receipts(tenant_id, run_id);

INSERT INTO _schema_migrations (version, name, applied_at) VALUES ('039', 'proof_receipts_schema', CURRENT_TIMESTAMP) ON CONFLICT (version) DO NOTHING;

-- Migration 040: agent_charters_schema
-- Migration 040: Agent charters (docs/kriya WP-4.1, 02 §9)
-- What an agent owns, which tools it may use, what it may see, its autonomy cap and budgets.
-- Append-only: a published (tenant, agent, version) never changes, so receipts that name an
-- agent version can always be traced to exactly what that agent was allowed to do.

CREATE TABLE IF NOT EXISTS agent_charters (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  agent_slug TEXT NOT NULL,
  version TEXT NOT NULL,
  charter_json TEXT NOT NULL,
  charter_hash TEXT NOT NULL,
  published_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, agent_slug, version),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_charters_tenant_agent ON agent_charters(tenant_id, agent_slug, created_at);

INSERT INTO _schema_migrations (version, name, applied_at) VALUES ('040', 'agent_charters_schema', CURRENT_TIMESTAMP) ON CONFLICT (version) DO NOTHING;

-- Migration 041: cascade_cache_schema
-- Migration 041: L1 cascade cache (docs/kriya WP-2.4, 02 §5.1)
-- Accepted model answers per tenant, keyed by a hash of (schema, knowledge version, normalised input, context).
-- Survives restarts and is shared by every instance on the same database. Expired rows are pruned on write.

CREATE TABLE IF NOT EXISTS cascade_cache (
  tenant_id TEXT NOT NULL,
  cache_key TEXT NOT NULL,
  schema_name TEXT NOT NULL,
  value_json TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, cache_key),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_cascade_cache_expiry ON cascade_cache(tenant_id, expires_at);

INSERT INTO _schema_migrations (version, name, applied_at) VALUES ('041', 'cascade_cache_schema', CURRENT_TIMESTAMP) ON CONFLICT (version) DO NOTHING;

-- Migration 042: appointment_book_schema
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

INSERT INTO _schema_migrations (version, name, applied_at) VALUES ('042', 'appointment_book_schema', CURRENT_TIMESTAMP) ON CONFLICT (version) DO NOTHING;

-- Migration 043: attention_routing_and_verification_schema
-- Migration 043: Attention routing & Verification schema (docs/kriya WP-4.6)
-- Routing rules to the right human by role, branch, and hours.
-- Verification jobs for async read-back checks by the Verification agent.

-- 1. Extend attention_items with routing & branch fields
ALTER TABLE attention_items ADD COLUMN IF NOT EXISTS assigned_role TEXT;
ALTER TABLE attention_items ADD COLUMN IF NOT EXISTS branch_id TEXT;
ALTER TABLE attention_items ADD COLUMN IF NOT EXISTS routed_at TEXT;
ALTER TABLE attention_items ADD COLUMN IF NOT EXISTS routing_rule_id TEXT;
ALTER TABLE attention_items ADD COLUMN IF NOT EXISTS after_hours INTEGER NOT NULL DEFAULT 0;
ALTER TABLE attention_items ADD COLUMN IF NOT EXISTS next_available_at TEXT;

CREATE INDEX IF NOT EXISTS idx_attention_items_tenant_role ON attention_items(tenant_id, assigned_role, status);
CREATE INDEX IF NOT EXISTS idx_attention_items_tenant_branch ON attention_items(tenant_id, branch_id);

-- 2. Tenant branches with local operating hours and timezone
CREATE TABLE IF NOT EXISTS branches (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  code TEXT,
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  working_hours_json TEXT NOT NULL,
  emergency_role TEXT NOT NULL DEFAULT 'emergency_on_call',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_branches_tenant ON branches(tenant_id, active);

-- 3. Deterministic attention routing rules
CREATE TABLE IF NOT EXISTS attention_routing_rules (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  priority_order INTEGER NOT NULL DEFAULT 100,
  conditions_json TEXT NOT NULL,
  target_role TEXT NOT NULL,
  target_user_id TEXT,
  branch_id TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_routing_rules_tenant ON attention_routing_rules(tenant_id, active, priority_order);

-- 4. Verification jobs for async read-back checks by the Verification agent
CREATE TABLE IF NOT EXISTS verification_jobs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  tool_slug TEXT NOT NULL,
  action_input_json TEXT NOT NULL,
  action_output_json TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'verified', 'mismatch', 'expired')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  deadline_at TEXT NOT NULL,
  next_check_at TEXT NOT NULL,
  observed_state_json TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_verification_jobs_tenant_status ON verification_jobs(tenant_id, status, next_check_at);
CREATE UNIQUE INDEX IF NOT EXISTS ux_verification_jobs_idem ON verification_jobs(tenant_id, idempotency_key);

INSERT INTO _schema_migrations (version, name, applied_at) VALUES ('043', 'attention_routing_and_verification_schema', CURRENT_TIMESTAMP) ON CONFLICT (version) DO NOTHING;

-- Migration 044: document_lens_schema
-- Migration 044: Document (Lens) Schema (docs/kriya WP-4.5)
-- Zero-retention document extraction metadata, structured fields, and verification hashes.

CREATE TABLE IF NOT EXISTS parsed_documents (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  run_id TEXT,
  document_type TEXT NOT NULL,
  sha256_hash TEXT NOT NULL,
  extraction_method TEXT NOT NULL CHECK (extraction_method IN ('L0_deterministic', 'L2_fast_model', 'L3_reasoning_model')),
  confidence REAL NOT NULL DEFAULT 1.0,
  is_valid INTEGER NOT NULL DEFAULT 1,
  structured_data_json TEXT NOT NULL,
  validation_errors_json TEXT,
  status TEXT NOT NULL CHECK (status IN ('verified', 'low_confidence', 'unsupported_template', 'failed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_parsed_docs_tenant_hash ON parsed_documents(tenant_id, sha256_hash);
CREATE INDEX IF NOT EXISTS idx_parsed_docs_tenant_corr ON parsed_documents(tenant_id, correlation_id);
CREATE INDEX IF NOT EXISTS idx_parsed_docs_tenant_status ON parsed_documents(tenant_id, status);

INSERT INTO _schema_migrations (version, name, applied_at) VALUES ('044', 'document_lens_schema', CURRENT_TIMESTAMP) ON CONFLICT (version) DO NOTHING;

-- Migration 045: refunds_and_leave_workflow_schema
-- Migration 045: Refunds and Doctor Emergency Leave Reference Workflow Schema (docs/kriya WP-4.7)
-- Subsystem: Payment Refunds, Resource Emergency Leaves, and Settlement Verification

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS fee_amount REAL DEFAULT 500.0;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS is_prepaid INTEGER DEFAULT 1;

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

INSERT INTO _schema_migrations (version, name, applied_at) VALUES ('045', 'refunds_and_leave_workflow_schema', CURRENT_TIMESTAMP) ON CONFLICT (version) DO NOTHING;
