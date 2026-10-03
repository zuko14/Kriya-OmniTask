
-- Migration 016: multilingual_schema
-- Migration 016: Multilingual System (Indic & Global Languages) Schema
-- Tracks customer language profiles, code-switching preferences, and translation caches (§14, §19 of CLAUDE.md)

CREATE TABLE IF NOT EXISTS language_profiles (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  organization_id TEXT NOT NULL DEFAULT 'default',
  customer_id TEXT NOT NULL,
  primary_language TEXT NOT NULL,
  detected_languages_json TEXT NOT NULL DEFAULT '[]',
  preferred_script TEXT NOT NULL DEFAULT 'Latin',
  is_code_switched INTEGER NOT NULL DEFAULT 0,
  confidence_score REAL NOT NULL DEFAULT 1.0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lang_profiles_tenant_customer ON language_profiles(tenant_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_lang_profiles_tenant_lang ON language_profiles(tenant_id, primary_language);

CREATE TABLE IF NOT EXISTS multilingual_translations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  organization_id TEXT NOT NULL DEFAULT 'default',
  source_text TEXT NOT NULL,
  source_language TEXT NOT NULL,
  target_language TEXT NOT NULL,
  translated_text TEXT NOT NULL,
  quality_score REAL NOT NULL DEFAULT 1.0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_translations_lookup ON multilingual_translations(tenant_id, source_language, target_language);

INSERT INTO _schema_migrations (version, name, applied_at) VALUES ('016', 'multilingual_schema', CURRENT_TIMESTAMP) ON CONFLICT (version) DO NOTHING;

-- Migration 017: security_hardening_schema
-- Migration 017: Security Hardening & Zero-Trust Audit Schema
-- Tracks cryptographically chained tamper-evident audit logs and secret rotations (§14, §20 of CLAUDE.md)

CREATE TABLE IF NOT EXISTS security_audit_ledger (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  organization_id TEXT NOT NULL DEFAULT 'default',
  sequence_number INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  target_resource TEXT NOT NULL,
  action TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  previous_hash TEXT NOT NULL,
  current_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_ledger_seq ON security_audit_ledger(tenant_id, sequence_number);
CREATE INDEX IF NOT EXISTS idx_audit_ledger_tenant_event ON security_audit_ledger(tenant_id, event_type);

CREATE TABLE IF NOT EXISTS secret_rotations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  organization_id TEXT NOT NULL DEFAULT 'default',
  secret_name TEXT NOT NULL,
  secret_version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'grace_period', 'revoked')),
  encrypted_secret_value TEXT NOT NULL,
  rotated_at TEXT NOT NULL,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_secrets_name_ver ON secret_rotations(tenant_id, secret_name, secret_version);
CREATE INDEX IF NOT EXISTS idx_secrets_status ON secret_rotations(tenant_id, status);

INSERT INTO _schema_migrations (version, name, applied_at) VALUES ('017', 'security_hardening_schema', CURRENT_TIMESTAMP) ON CONFLICT (version) DO NOTHING;

-- Migration 018: reliability_engineering_schema
-- Migration 018: Reliability Engineering Schema
-- Tables: idempotency_keys, dead_letter_jobs, service_dependency_health, operation_recovery_log

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  organization_id TEXT NOT NULL DEFAULT 'default',
  idempotency_key TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_payload TEXT,
  status TEXT NOT NULL DEFAULT 'in_progress', -- 'in_progress', 'completed', 'failed'
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE,
  UNIQUE (tenant_id, idempotency_key, resource_type)
);

CREATE INDEX IF NOT EXISTS idx_idempotency_lookup
  ON idempotency_keys (tenant_id, idempotency_key, resource_type);

CREATE INDEX IF NOT EXISTS idx_idempotency_expiry
  ON idempotency_keys (expires_at);

CREATE TABLE IF NOT EXISTS dead_letter_jobs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  organization_id TEXT NOT NULL DEFAULT 'default',
  job_type TEXT NOT NULL,
  payload TEXT NOT NULL, -- JSON
  failure_reason TEXT NOT NULL,
  error_stack TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  status TEXT NOT NULL DEFAULT 'pending_review', -- 'pending_review', 'retrying', 'discarded', 'resolved'
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_dlq_tenant_status
  ON dead_letter_jobs (tenant_id, status);

CREATE TABLE IF NOT EXISTS service_dependency_health (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  dependency_name TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'healthy', -- 'healthy', 'degraded', 'unhealthy', 'circuit_broken'
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  failure_rate REAL NOT NULL DEFAULT 0.0,
  latency_p95_ms REAL NOT NULL DEFAULT 0.0,
  last_probe_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE,
  UNIQUE (tenant_id, dependency_name)
);

CREATE INDEX IF NOT EXISTS idx_dependency_health_tenant
  ON service_dependency_health (tenant_id, dependency_name);

CREATE TABLE IF NOT EXISTS operation_recovery_log (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  organization_id TEXT NOT NULL DEFAULT 'default',
  operation_id TEXT NOT NULL,
  operation_type TEXT NOT NULL,
  lifecycle_state TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'running', 'verifying', 'completed', 'partially_completed', 'failed', 'retrying', 'failed_permanently', 'cancelled', 'timed_out', 'blocked', 'requires_approval', 'escalated'
  checkpoint_state_json TEXT NOT NULL DEFAULT '{}',
  compensation_action_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_recovery_tenant_op
  ON operation_recovery_log (tenant_id, operation_id);

INSERT INTO _schema_migrations (version, name, applied_at) VALUES ('018', 'reliability_engineering_schema', CURRENT_TIMESTAMP) ON CONFLICT (version) DO NOTHING;

-- Migration 019: model_resilience_schema
-- Migration 019: Model Provider Resilience Schema
-- Tables: model_registry, tenant_model_policies, model_routing_decisions

CREATE TABLE IF NOT EXISTS model_registry (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL, -- 'google', 'openai', 'anthropic', 'deepseek', 'local'
  model_identifier TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', -- 'active', 'deprecated', 'disabled', 'experimental'
  context_window_tokens INTEGER NOT NULL DEFAULT 128000,
  input_cost_per_1k REAL NOT NULL DEFAULT 0.0001,
  output_cost_per_1k REAL NOT NULL DEFAULT 0.0002,
  capabilities_json TEXT NOT NULL DEFAULT '[]', -- JSON array of strings
  allowed_data_classifications_json TEXT NOT NULL DEFAULT '["public","internal","confidential","restricted"]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_model_registry_provider_status
  ON model_registry (provider, status);

CREATE TABLE IF NOT EXISTS tenant_model_policies (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  organization_id TEXT NOT NULL DEFAULT 'default',
  default_primary_model_id TEXT NOT NULL,
  default_fallback_model_id TEXT NOT NULL,
  disallowed_providers_json TEXT NOT NULL DEFAULT '[]',
  max_cost_per_query_usd REAL NOT NULL DEFAULT 1.0,
  require_local_for_confidential INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE,
  UNIQUE (tenant_id, organization_id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_model_policy
  ON tenant_model_policies (tenant_id, organization_id);

CREATE TABLE IF NOT EXISTS model_routing_decisions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  organization_id TEXT NOT NULL DEFAULT 'default',
  task_id TEXT NOT NULL,
  task_type TEXT NOT NULL,
  selected_model_id TEXT NOT NULL,
  selected_provider TEXT NOT NULL,
  fallback_occurred INTEGER NOT NULL DEFAULT 0,
  fallback_chain_json TEXT NOT NULL DEFAULT '[]',
  decision_rationale TEXT NOT NULL,
  latency_ms REAL NOT NULL DEFAULT 0.0,
  cost_usd REAL NOT NULL DEFAULT 0.0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_routing_decisions_tenant_task
  ON model_routing_decisions (tenant_id, task_type);

INSERT INTO _schema_migrations (version, name, applied_at) VALUES ('019', 'model_resilience_schema', CURRENT_TIMESTAMP) ON CONFLICT (version) DO NOTHING;

-- Migration 020: cost_intelligence_schema
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

INSERT INTO _schema_migrations (version, name, applied_at) VALUES ('020', 'cost_intelligence_schema', CURRENT_TIMESTAMP) ON CONFLICT (version) DO NOTHING;

-- Migration 021: enterprise_governance_schema
-- Migration 021: Enterprise Governance Schema
-- Multi-level org hierarchy, enterprise SSO/OIDC config, ABAC data classification, and automated retention purge auditing.

CREATE TABLE IF NOT EXISTS organization_units (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    parent_unit_id TEXT, -- NULL for top-level division
    name TEXT NOT NULL,
    code TEXT NOT NULL,
    unit_type TEXT NOT NULL, -- 'division', 'department', 'team', 'squad'
    lead_user_id TEXT,
    metadata_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(tenant_id, code),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_unit_id) REFERENCES organization_units(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_org_tenant_parent ON organization_units(tenant_id, parent_unit_id);

CREATE TABLE IF NOT EXISTS enterprise_sso_configs (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    provider_type TEXT NOT NULL, -- 'okta', 'azure_ad', 'google_workspace', 'generic_oidc', 'saml2'
    issuer_url TEXT NOT NULL,
    client_id TEXT NOT NULL,
    client_secret_encrypted TEXT NOT NULL,
    claims_mapping_json TEXT NOT NULL,
    enforce_sso INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(tenant_id, provider_type),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sso_tenant ON enterprise_sso_configs(tenant_id);

CREATE TABLE IF NOT EXISTS data_retention_policies (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    data_classification TEXT NOT NULL, -- 'public', 'internal', 'confidential', 'restricted'
    target_resource_type TEXT NOT NULL, -- 'audit_logs', 'agent_conversations', 'cost_records', 'transcripts', 'workflow_executions'
    retention_days INTEGER NOT NULL,
    purge_action TEXT NOT NULL DEFAULT 'hard_delete', -- 'hard_delete', 'anonymize', 'archive_cold_storage'
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(tenant_id, data_classification, target_resource_type),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_retention_tenant ON data_retention_policies(tenant_id);

CREATE TABLE IF NOT EXISTS governance_purge_audit (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    policy_id TEXT NOT NULL,
    target_resource_type TEXT NOT NULL,
    records_evaluated INTEGER NOT NULL,
    records_purged INTEGER NOT NULL,
    status TEXT NOT NULL, -- 'completed', 'failed'
    executed_at TEXT NOT NULL,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_purge_tenant ON governance_purge_audit(tenant_id, executed_at);

INSERT INTO _schema_migrations (version, name, applied_at) VALUES ('021', 'enterprise_governance_schema', CURRENT_TIMESTAMP) ON CONFLICT (version) DO NOTHING;

-- Migration 022: platform_administration_schema
-- Migration 022: Platform Administration Schema
-- Operator Control Plane, Tenant Lifecycle, Fleet Health & Node Diagnostics, and System Announcements.

CREATE TABLE IF NOT EXISTS operator_audit_logs (
    id TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL,
    target_tenant_id TEXT,
    action_type TEXT NOT NULL, -- 'tenant_provision', 'tenant_suspend', 'tenant_reactivate', 'tenant_delete', 'quota_override', 'maintenance_mode_toggle', 'global_announcement_broadcast', 'emergency_kill_switch'
    reason TEXT NOT NULL,
    metadata_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_operator_logs_target ON operator_audit_logs(target_tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_operator_logs_action ON operator_audit_logs(action_type, created_at);

CREATE TABLE IF NOT EXISTS node_fleet_heartbeats (
    id TEXT PRIMARY KEY,
    node_id TEXT NOT NULL UNIQUE,
    cluster_region TEXT NOT NULL,
    status TEXT NOT NULL, -- 'healthy', 'degraded', 'draining', 'offline'
    cpu_usage_pct REAL NOT NULL,
    memory_usage_pct REAL NOT NULL,
    active_worker_threads INTEGER NOT NULL,
    active_agent_executions INTEGER NOT NULL,
    last_heartbeat_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fleet_status ON node_fleet_heartbeats(status, last_heartbeat_at);

CREATE TABLE IF NOT EXISTS system_announcements (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    severity TEXT NOT NULL, -- 'info', 'warning', 'critical', 'maintenance'
    is_active INTEGER NOT NULL DEFAULT 1,
    target_tenant_ids_json TEXT NOT NULL, -- '["*"]' for all or specific tenant IDs
    starts_at TEXT NOT NULL,
    expires_at TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_announcements_active ON system_announcements(is_active, starts_at);

CREATE TABLE IF NOT EXISTS platform_maintenance_state (
    id TEXT PRIMARY KEY,
    is_maintenance_active INTEGER NOT NULL DEFAULT 0,
    maintenance_message TEXT,
    read_only_mode INTEGER NOT NULL DEFAULT 0,
    emergency_kill_active INTEGER NOT NULL DEFAULT 0,
    activated_by TEXT,
    activated_at TEXT,
    updated_at TEXT NOT NULL
);

INSERT INTO _schema_migrations (version, name, applied_at) VALUES ('022', 'platform_administration_schema', CURRENT_TIMESTAMP) ON CONFLICT (version) DO NOTHING;

-- Migration 023: billing_and_usage_schema
-- 023_billing_and_usage_schema.sql
-- Subsystem: Billing, Usage Metering, Channel Pricing, and Invoicing

CREATE TABLE IF NOT EXISTS billing_plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  plan_tier TEXT NOT NULL, -- starter, growth, enterprise, custom
  channel_plan TEXT NOT NULL, -- digital_only, voice_only, combined
  base_price_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  billing_interval TEXT NOT NULL DEFAULT 'month', -- month, year
  included_tokens INTEGER NOT NULL DEFAULT 0,
  included_voice_minutes INTEGER NOT NULL DEFAULT 0,
  included_workflow_executions INTEGER NOT NULL DEFAULT 0,
  included_agents INTEGER NOT NULL DEFAULT 1,
  token_overage_rate_cents_per_k REAL NOT NULL DEFAULT 0.0,
  voice_minute_overage_rate_cents REAL NOT NULL DEFAULT 0.0,
  workflow_overage_rate_cents REAL NOT NULL DEFAULT 0.0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tenant_subscriptions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  status TEXT NOT NULL, -- active, past_due, canceled, trialing
  current_period_start TEXT NOT NULL,
  current_period_end TEXT NOT NULL,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (plan_id) REFERENCES billing_plans(id)
);

CREATE TABLE IF NOT EXISTS usage_meter_records (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  metric_type TEXT NOT NULL, -- tokens, voice_minutes, workflow_executions, agent_seat_hours, api_calls, vector_storage_mb
  quantity REAL NOT NULL,
  idempotency_key TEXT UNIQUE,
  recorded_at TEXT NOT NULL,
  metadata TEXT,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  subscription_id TEXT,
  billing_period_start TEXT NOT NULL,
  billing_period_end TEXT NOT NULL,
  subtotal_amount_cents INTEGER NOT NULL,
  tax_rate_pct REAL NOT NULL DEFAULT 0.0,
  tax_amount_cents INTEGER NOT NULL DEFAULT 0,
  discount_amount_cents INTEGER NOT NULL DEFAULT 0,
  total_amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL, -- draft, open, paid, void, uncollectible
  stripe_payment_intent_id TEXT,
  paid_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE TABLE IF NOT EXISTS invoice_line_items (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL,
  item_type TEXT NOT NULL, -- base_subscription, token_overage, voice_overage, workflow_overage, discount, tax
  description TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1.0,
  unit_price_cents INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_usage_meter_tenant_date ON usage_meter_records(tenant_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_usage_meter_metric ON usage_meter_records(tenant_id, metric_type, recorded_at);
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_period ON invoices(tenant_id, billing_period_start, billing_period_end);
CREATE INDEX IF NOT EXISTS idx_tenant_subscriptions_tenant ON tenant_subscriptions(tenant_id);

INSERT INTO _schema_migrations (version, name, applied_at) VALUES ('023', 'billing_and_usage_schema', CURRENT_TIMESTAMP) ON CONFLICT (version) DO NOTHING;

-- Migration 024: production_infrastructure_schema
-- 024_production_infrastructure_schema.sql
-- Subsystem: Production Infrastructure, Asynchronous Worker Queues, Connection Pool Diagnostics, and Secret Auditing

CREATE TABLE IF NOT EXISTS async_job_queue (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  queue_name TEXT NOT NULL DEFAULT 'default', -- high, default, low, batch
  job_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 50, -- 1 (lowest) to 100 (highest)
  status TEXT NOT NULL DEFAULT 'pending', -- pending, running, completed, failed, dead_letter
  max_retries INTEGER NOT NULL DEFAULT 3,
  retry_count INTEGER NOT NULL DEFAULT 0,
  run_at TEXT NOT NULL,
  locked_by_worker TEXT,
  locked_until TEXT,
  error_message TEXT,
  result_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE TABLE IF NOT EXISTS scheduled_jobs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  cron_expression TEXT NOT NULL, -- e.g., '0 * * * *' (hourly) or '*/15 * * * *'
  job_type TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  last_run_at TEXT,
  next_run_at TEXT,
  last_status TEXT, -- success, failure, skipped
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS secret_audit_records (
  id TEXT PRIMARY KEY,
  scan_type TEXT NOT NULL, -- config_env, database_credentials, agent_tokens
  secrets_scanned_count INTEGER NOT NULL,
  vulnerabilities_found_count INTEGER NOT NULL,
  audit_report_json TEXT NOT NULL,
  scanned_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_async_job_queue_status_priority ON async_job_queue(queue_name, status, priority DESC, run_at ASC);
CREATE INDEX IF NOT EXISTS idx_async_job_queue_tenant ON async_job_queue(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_active ON scheduled_jobs(is_active, next_run_at);

INSERT INTO _schema_migrations (version, name, applied_at) VALUES ('024', 'production_infrastructure_schema', CURRENT_TIMESTAMP) ON CONFLICT (version) DO NOTHING;

-- Migration 025: observability_sre_schema
-- 025_observability_sre_schema.sql
-- Subsystem: Site Reliability Engineering (SRE), Service Level Objectives (SLO), Error Budget Burn Rates & Alert Dispatchers

CREATE TABLE IF NOT EXISTS slo_definitions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  service_name TEXT NOT NULL,
  target_metric TEXT NOT NULL, -- availability, p95_latency_ms, p99_latency_ms, error_rate, workflow_success_rate
  target_threshold REAL NOT NULL, -- e.g. 99.9 for availability, 500 for p95_latency_ms
  window_days INTEGER NOT NULL DEFAULT 30,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS slo_evaluations (
  id TEXT PRIMARY KEY,
  slo_id TEXT NOT NULL,
  evaluation_timestamp TEXT NOT NULL,
  actual_metric_value REAL NOT NULL,
  is_compliant INTEGER NOT NULL,
  error_budget_total_pct REAL NOT NULL,
  error_budget_remaining_pct REAL NOT NULL,
  burn_rate_1h REAL NOT NULL DEFAULT 1.0,
  burn_rate_24h REAL NOT NULL DEFAULT 1.0,
  alert_status TEXT NOT NULL DEFAULT 'normal', -- normal, warning, critical
  FOREIGN KEY (slo_id) REFERENCES slo_definitions(id)
);

CREATE TABLE IF NOT EXISTS sre_alerts (
  id TEXT PRIMARY KEY,
  slo_id TEXT,
  severity TEXT NOT NULL, -- P1_CRITICAL, P2_HIGH, P3_MEDIUM, P4_LOW
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  channels_json TEXT NOT NULL, -- ["slack", "pagerduty", "webhook"]
  status TEXT NOT NULL DEFAULT 'firing', -- firing, acknowledged, resolved
  dispatched_at TEXT NOT NULL,
  acknowledged_at TEXT,
  resolved_at TEXT,
  metadata_json TEXT,
  FOREIGN KEY (slo_id) REFERENCES slo_definitions(id)
);

CREATE INDEX IF NOT EXISTS idx_slo_evaluations_slo_ts ON slo_evaluations(slo_id, evaluation_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_sre_alerts_status ON sre_alerts(status, severity);

INSERT INTO _schema_migrations (version, name, applied_at) VALUES ('025', 'observability_sre_schema', CURRENT_TIMESTAMP) ON CONFLICT (version) DO NOTHING;

-- Migration 026: deployment_release_schema
-- ============================================================================
-- Migration 026: Deployment & Release Engineering Schema
-- Phase 29 of Xylarc AI Autonomous Business Workforce
-- ============================================================================

-- 1. Release Deployments Table
CREATE TABLE IF NOT EXISTS release_deployments (
    id VARCHAR(36) PRIMARY KEY,
    version_tag VARCHAR(50) NOT NULL,
    environment VARCHAR(30) NOT NULL DEFAULT 'production', -- 'staging', 'production', 'canary'
    status VARCHAR(30) NOT NULL DEFAULT 'pending', -- 'pending', 'canary', 'promoted', 'rolled_back'
    canary_weight_pct INTEGER NOT NULL DEFAULT 0, -- 0 to 100
    gate_verdict VARCHAR(30) NOT NULL DEFAULT 'pending', -- 'approved', 'blocked', 'conditional'
    gate_details_json TEXT NOT NULL DEFAULT '{}',
    deployed_by VARCHAR(100) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    promoted_at TIMESTAMP,
    rolled_back_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_deployments_env ON release_deployments(environment);
CREATE INDEX IF NOT EXISTS idx_deployments_status ON release_deployments(status);
CREATE INDEX IF NOT EXISTS idx_deployments_version ON release_deployments(version_tag);

-- 2. Feature Flags Table
CREATE TABLE IF NOT EXISTS feature_flags (
    id VARCHAR(36) PRIMARY KEY,
    flag_key VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    is_enabled BOOLEAN NOT NULL DEFAULT false,
    allowed_tenants_json TEXT NOT NULL DEFAULT '[]',
    allowed_roles_json TEXT NOT NULL DEFAULT '[]',
    rollout_pct INTEGER NOT NULL DEFAULT 0, -- 0 to 100
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_feature_flags_key ON feature_flags(flag_key);
CREATE INDEX IF NOT EXISTS idx_feature_flags_enabled ON feature_flags(is_enabled);

-- 3. Schema Transitions Table (Expand / Migrate / Contract Zero-Downtime Pipeline)
CREATE TABLE IF NOT EXISTS schema_transitions (
    id VARCHAR(36) PRIMARY KEY,
    table_name VARCHAR(100) NOT NULL,
    version VARCHAR(50) NOT NULL,
    phase VARCHAR(30) NOT NULL, -- 'expand', 'migrate', 'contract'
    status VARCHAR(30) NOT NULL DEFAULT 'pending', -- 'pending', 'running', 'completed', 'failed'
    details_json TEXT NOT NULL DEFAULT '{}',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_schema_transitions_table ON schema_transitions(table_name);
CREATE INDEX IF NOT EXISTS idx_schema_transitions_phase ON schema_transitions(phase);
CREATE INDEX IF NOT EXISTS idx_schema_transitions_status ON schema_transitions(status);

INSERT INTO _schema_migrations (version, name, applied_at) VALUES ('026', 'deployment_release_schema', CURRENT_TIMESTAMP) ON CONFLICT (version) DO NOTHING;

-- Migration 027: production_hardening_schema
-- ============================================================================
-- Migration 027: Production Hardening, Chaos & Red-Team Audit Schema
-- Phase 30 of Xylarc AI Autonomous Business Workforce
-- ============================================================================

-- 1. Hardening Stress Test Runs Table
CREATE TABLE IF NOT EXISTS hardening_stress_runs (
    id VARCHAR(36) PRIMARY KEY,
    run_name VARCHAR(100) NOT NULL,
    concurrency_level INTEGER NOT NULL,
    total_requests INTEGER NOT NULL,
    successful_requests INTEGER NOT NULL,
    failed_requests INTEGER NOT NULL,
    throughput_rps REAL NOT NULL,
    p50_latency_ms REAL NOT NULL,
    p95_latency_ms REAL NOT NULL,
    p99_latency_ms REAL NOT NULL,
    cross_tenant_leakage_detected BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_stress_runs_created ON hardening_stress_runs(created_at);

-- 2. Chaos Injection Experiments Table
CREATE TABLE IF NOT EXISTS chaos_experiments (
    id VARCHAR(36) PRIMARY KEY,
    experiment_name VARCHAR(100) NOT NULL,
    fault_type VARCHAR(50) NOT NULL, -- 'latency', 'network_error', 'db_pool_exhaustion', 'rate_limit'
    injected_count INTEGER NOT NULL,
    survived_count INTEGER NOT NULL,
    recovery_time_ms INTEGER NOT NULL,
    status VARCHAR(30) NOT NULL, -- 'passed', 'failed'
    details_json TEXT NOT NULL DEFAULT '{}',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_chaos_fault ON chaos_experiments(fault_type);
CREATE INDEX IF NOT EXISTS idx_chaos_status ON chaos_experiments(status);

-- 3. Red-Team Adversarial Audits Table
CREATE TABLE IF NOT EXISTS red_team_audits (
    id VARCHAR(36) PRIMARY KEY,
    audit_name VARCHAR(100) NOT NULL,
    total_probes INTEGER NOT NULL,
    attacks_blocked INTEGER NOT NULL,
    vulnerabilities_found INTEGER NOT NULL,
    threat_score REAL NOT NULL, -- 0.0 to 10.0
    status VARCHAR(30) NOT NULL, -- 'passed', 'failed'
    findings_json TEXT NOT NULL DEFAULT '[]',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_red_team_status ON red_team_audits(status);

-- 4. Production Readiness Verification Table
CREATE TABLE IF NOT EXISTS production_readiness_checks (
    id VARCHAR(36) PRIMARY KEY,
    check_category VARCHAR(50) NOT NULL,
    check_name VARCHAR(100) NOT NULL,
    status VARCHAR(30) NOT NULL, -- 'passed', 'warning', 'failed'
    evidence TEXT NOT NULL,
    evaluated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_readiness_category ON production_readiness_checks(check_category);
CREATE INDEX IF NOT EXISTS idx_readiness_status ON production_readiness_checks(status);

INSERT INTO _schema_migrations (version, name, applied_at) VALUES ('027', 'production_hardening_schema', CURRENT_TIMESTAMP) ON CONFLICT (version) DO NOTHING;

-- Migration 028: tenant_elevation_schema
-- Migration 028: Tenant Elevation & Extended Enterprise Provisioning Schema (§2, §17.1, §17.2, §17.6)
-- Supports owner-plane provisioning, temporary operator elevation sessions, and strict governance fields.

CREATE TABLE IF NOT EXISTS tenant_elevation_sessions (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    operator_id TEXT NOT NULL,
    operator_name TEXT,
    reason TEXT NOT NULL,
    duration_minutes INTEGER NOT NULL,
    starts_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_elevation_tenant_active ON tenant_elevation_sessions(tenant_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_elevation_operator ON tenant_elevation_sessions(operator_id, created_at);

-- Add extended fields to tenants table safely if not already present
-- SQLite allows adding columns with ALTER TABLE
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS industry TEXT DEFAULT 'general';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS region TEXT DEFAULT 'ap-south-1';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS languages_json TEXT DEFAULT '["en", "hi"]';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'Asia/Kolkata';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS dna_profile_id TEXT DEFAULT 'dna_general_service';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS brain_supply_mode TEXT DEFAULT 'byo'; -- 'byo' or 'managed' (§9.5)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS quotas_json TEXT DEFAULT '{"max_concurrent_tasks":10,"monthly_budget_inr":10000}';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS autonomy_ceiling TEXT DEFAULT 'L2'; -- 'L1', 'L2', 'L3', 'L4'

INSERT INTO _schema_migrations (version, name, applied_at) VALUES ('028', 'tenant_elevation_schema', CURRENT_TIMESTAMP) ON CONFLICT (version) DO NOTHING;

-- Migration 029: business_dna_roster_schema
-- Migration 029: Business DNA Profiles & Versioned Roster Manifests Schema (§3, §4, §23)
-- Supports type-adaptive configuration, agent roster moulding, and rollback-able roster manifests.

CREATE TABLE IF NOT EXISTS dna_profiles (
    id TEXT PRIMARY KEY,
    version TEXT NOT NULL,
    business_type TEXT NOT NULL,
    display_name TEXT NOT NULL,
    description TEXT,
    lifecycle_model_json TEXT NOT NULL,
    entity_vocabulary_json TEXT NOT NULL,
    capabilities_json TEXT NOT NULL,
    required_agents_json TEXT NOT NULL,
    optional_agents_json TEXT NOT NULL,
    forbidden_actions_json TEXT NOT NULL,
    compliance_profile_json TEXT NOT NULL,
    default_kpis_json TEXT NOT NULL,
    knowledge_schema_json TEXT NOT NULL,
    escalation_defaults_json TEXT NOT NULL,
    skill_grants_json TEXT NOT NULL,
    external_retrieval_policy_json TEXT NOT NULL,
    min_tier_requirements_json TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dna_profiles_type ON dna_profiles(business_type);

CREATE TABLE IF NOT EXISTS tenant_roster_manifests (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    dna_profile_id TEXT NOT NULL,
    dna_profile_version TEXT NOT NULL,
    entity_vocabulary_json TEXT NOT NULL,
    capabilities_json TEXT NOT NULL,
    lifecycle_stages_json TEXT NOT NULL,
    agents_json TEXT NOT NULL,
    checksum TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active', -- 'active', 'superseded', 'rolled_back'
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    rolled_back_from_version INTEGER,
    FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY(dna_profile_id) REFERENCES dna_profiles(id)
);

CREATE INDEX IF NOT EXISTS idx_manifests_tenant_ver ON tenant_roster_manifests(tenant_id, version);
CREATE INDEX IF NOT EXISTS idx_manifests_tenant_active ON tenant_roster_manifests(tenant_id, status);

-- Seed Profile 1: Retail & Digital Commerce (Meridian Retail Pilot)
INSERT INTO dna_profiles (
    id, version, business_type, display_name, description,
    lifecycle_model_json, entity_vocabulary_json, capabilities_json,
    required_agents_json, optional_agents_json, forbidden_actions_json,
    compliance_profile_json, default_kpis_json, knowledge_schema_json,
    escalation_defaults_json, skill_grants_json, external_retrieval_policy_json,
    min_tier_requirements_json, is_active, created_at, updated_at
) VALUES (
    'dna_retail_commerce',
    '1.0.0',
    'retail_commerce',
    'Retail & Digital Commerce',
    'Omnichannel retail and D2C commerce operations, catalog search, order tracking, returns management, and cart recovery.',
    '{"stages":["discovery","evaluation","order_placed","fulfillment","post_purchase","repeat_buyer","dormant"],"initial_stage":"discovery","terminal_stages":["dormant","repeat_buyer"]}',
    '{"customer":"Shopper","customer_plural":"Shoppers","item":"Product","item_plural":"Products","transaction":"Order","transaction_plural":"Orders","appointment":"Delivery Slot","agent_term":"Store Assistant","custom_labels":{"cart":"Shopping Bag","return":"Return Request","catalog":"Product Catalog"}}',
    '["product_catalog","order_tracking","returns_management","cart_recovery","lead_qualification","whatsapp_commerce","promotions"]',
    '[{"id":"agent_retail_support","slug":"customer_support","name":"Store & Order Assistant","role":"Customer Support Specialist","description":"Handles product inquiries, order tracking, and return requests.","min_model_tier":"T2","ceiling_autonomy":"L2","skills":["catalog_search","order_status_lookup","return_policy_check"],"tools":["inventory_lookup","order_tracking_api"],"forbidden_actions":["override_product_price","process_unverified_refund"]},{"id":"agent_retail_logistics","slug":"order_tracking","name":"Logistics & Delivery Specialist","role":"Fulfillment Specialist","description":"Tracks logistics shipments and handles delivery rescheduling.","min_model_tier":"T1","ceiling_autonomy":"L3","skills":["shipping_carrier_track","delivery_window_reschedule"],"tools":["carrier_api"],"forbidden_actions":["reroute_package_cross_border"]},{"id":"agent_retail_sales","slug":"lead_qualification","name":"Sales & Personal Shopper","role":"Lead Qualification Specialist","description":"Qualifies high-intent shoppers and provides personalized recommendations.","min_model_tier":"T2","ceiling_autonomy":"L2","skills":["product_recommendation","bant_scoring"],"tools":["crm_create_lead"],"forbidden_actions":["apply_unapproved_coupon"]}]',
    '[{"id":"agent_retail_retention","slug":"reactivation_retention","name":"VIP Win-Back & Retention","role":"Retention Specialist","description":"Re-engages dormant shoppers with targeted loyalty offers.","min_model_tier":"T3","ceiling_autonomy":"L1","skills":["cart_abandonment_incentive","vip_loyalty_outreach"],"tools":["discount_coupon_issuer"],"forbidden_actions":["discount_exceeding_20pct"]}]',
    '["modify_catalog_pricing","process_unverified_refund","cancel_supplier_po","exceed_max_promotional_discount"]',
    '{"consumer_protection":"e_commerce_rules_2020","data_retention_days":180,"tax_regime":"GST_IN"}',
    '[{"id":"gmv_daily","label":"Daily GMV","unit":"₹","format":"currency"},{"id":"order_fulfillment_sla","label":"Fulfillment SLA","unit":"%","format":"percent"},{"id":"return_rate_pct","label":"Return Rate","unit":"%","format":"percent"},{"id":"cart_conversion_pct","label":"Cart Conversion","unit":"%","format":"percent"}]',
    '["product_catalog_tsv","return_refund_policy_pdf","shipping_sla_matrix","promotional_terms_doc"]',
    '["chargeback_dispute","damaged_goods_claim_exceeding_5000","abusive_customer_sentiment"]',
    '["catalog_search","order_status_lookup","return_policy_check","shipping_carrier_track","product_recommendation","bant_scoring"]',
    '{"allowed":true,"allowed_domains":["shiprocket.in","delhivery.com","bluedart.com"]}',
    '{"customer_support":"T2","order_tracking":"T1","lead_qualification":"T2","reactivation_retention":"T3"}',
    1,
    '2026-08-20T00:00:00.000Z',
    '2026-08-20T00:00:00.000Z'
) ON CONFLICT (id) DO NOTHING;

-- Seed Profile 2: Automotive Dealership & Service (Kaveri Motors Pilot)
INSERT INTO dna_profiles (
    id, version, business_type, display_name, description,
    lifecycle_model_json, entity_vocabulary_json, capabilities_json,
    required_agents_json, optional_agents_json, forbidden_actions_json,
    compliance_profile_json, default_kpis_json, knowledge_schema_json,
    escalation_defaults_json, skill_grants_json, external_retrieval_policy_json,
    min_tier_requirements_json, is_active, created_at, updated_at
) VALUES (
    'dna_automotive_dealership',
    '1.0.0',
    'automotive_dealership',
    'Automotive Dealership & Service',
    'Automotive sales, test drive scheduling, vehicle inventory lookup, service appointment booking, and trade-in inquiries.',
    '{"stages":["inquiry","test_drive_scheduled","quote_negotiation","vehicle_delivered","service_active","trade_in_ready","dormant"],"initial_stage":"inquiry","terminal_stages":["dormant","trade_in_ready"]}',
    '{"customer":"Vehicle Owner","customer_plural":"Vehicle Owners","item":"Vehicle","item_plural":"Vehicles","transaction":"Deal","transaction_plural":"Deals","appointment":"Test Drive / Service Booking","agent_term":"Dealership Concierge","custom_labels":{"service_bay":"Workshop Bay","inventory":"Showroom Inventory","test_drive":"Test Drive Slot"}}',
    '["vehicle_inventory","test_drive_scheduling","service_appointment_booking","lead_qualification","voice_dispatch","quote_generation","service_reminders"]',
    '[{"id":"agent_auto_sales","slug":"lead_qualification","name":"Showroom Sales Consultant","role":"Lead Qualification Specialist","description":"Assists with vehicle selection, feature comparisons, and financing eligibility.","min_model_tier":"T2","ceiling_autonomy":"L2","skills":["vehicle_spec_matching","financing_estimation","bant_scoring"],"tools":["inventory_lookup","crm_create_lead"],"forbidden_actions":["promise_delivery_date_unconfirmed","commit_cash_discount"]},{"id":"agent_auto_booking","slug":"calendar_booking","name":"Test Drive & Service Scheduler","role":"Calendar Booking Specialist","description":"Coordinates demo vehicle test drives and service bay slots.","min_model_tier":"T2","ceiling_autonomy":"L3","skills":["calendar_slot_allocation","service_bay_scheduling"],"tools":["dealership_calendar_api"],"forbidden_actions":["double_book_demo_vehicle"]},{"id":"agent_auto_support","slug":"customer_support","name":"Service Center Advisor","role":"Customer Support Specialist","description":"Provides repair status updates, maintenance cost estimates, and warranty advice.","min_model_tier":"T2","ceiling_autonomy":"L2","skills":["job_card_status","service_cost_estimator"],"tools":["dms_service_api"],"forbidden_actions":["waive_inspection_fee_unapproved"]}]',
    '[{"id":"agent_auto_voice","slug":"voice_outbound_dispatch","name":"Service Reminder & Follow-Up Concierge","role":"Outbound Specialist","description":"Executes automated service schedule reminders and post-delivery satisfaction calls.","min_model_tier":"T3","ceiling_autonomy":"L2","skills":["service_reminder_call","post_service_feedback"],"tools":["voice_gateway_dialer"],"forbidden_actions":["call_outside_business_hours"]}]',
    '["commit_vehicle_discount_exceeding_10pct","waive_service_warranty_fee_unapproved","release_vehicle_without_gatepass","promise_unverified_trade_in_value"]',
    '{"motor_vehicles_act":"form_20_21_compliance","data_retention_days":365,"tax_regime":"GST_IN"}',
    '[{"id":"test_drives_booked","label":"Test Drives Booked","unit":"count","format":"number"},{"id":"service_bay_utilization","label":"Service Bay Utilization","unit":"%","format":"percent"},{"id":"lead_response_time_sec","label":"Lead Response Time","unit":"s","format":"duration"},{"id":"test_drive_to_sale_pct","label":"Test Drive to Sale","unit":"%","format":"percent"}]',
    '["vehicle_specs_matrix","service_rate_card","warranty_terms_pdf","dealership_location_hours","trade_in_valuation_guide"]',
    '["trade_in_valuation_dispute","vehicle_breakdown_emergency","service_billing_discrepancy"]',
    '["vehicle_spec_matching","financing_estimation","bant_scoring","calendar_slot_allocation","service_bay_scheduling","job_card_status","service_cost_estimator"]',
    '{"allowed":true,"allowed_domains":["vahan.parivahan.gov.in","carwale.com","bikewale.com"]}',
    '{"lead_qualification":"T2","calendar_booking":"T2","customer_support":"T2","voice_outbound_dispatch":"T3"}',
    1,
    '2026-08-20T00:00:00.000Z',
    '2026-08-20T00:00:00.000Z'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO _schema_migrations (version, name, applied_at) VALUES ('029', 'business_dna_roster_schema', CURRENT_TIMESTAMP) ON CONFLICT (version) DO NOTHING;

-- Migration 030: context_memory_schema
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

INSERT INTO _schema_migrations (version, name, applied_at) VALUES ('030', 'context_memory_schema', CURRENT_TIMESTAMP) ON CONFLICT (version) DO NOTHING;
