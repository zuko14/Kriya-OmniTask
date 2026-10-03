
-- Migration 046: durable_job_queue_schema
-- Migration 046: Durable Job Queue & Scheduling Engine Extensions (docs/kriya WP-5.9)
-- Subsystem: Priority Queues, Dead Letter Queue (DLQ), Concurrency Locks, and Timezone/Quiet Hours Governance

ALTER TABLE async_job_queue ADD COLUMN IF NOT EXISTS correlation_id TEXT;
ALTER TABLE async_job_queue ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE async_job_queue ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'UTC';
ALTER TABLE async_job_queue ADD COLUMN IF NOT EXISTS quiet_hours_policy TEXT DEFAULT 'none';
ALTER TABLE async_job_queue ADD COLUMN IF NOT EXISTS last_heartbeat_at TEXT;
ALTER TABLE async_job_queue ADD COLUMN IF NOT EXISTS execution_duration_ms INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_async_job_queue_claim ON async_job_queue(queue_name, status, run_at, priority DESC);
CREATE INDEX IF NOT EXISTS idx_async_job_queue_locked ON async_job_queue(status, locked_until);
CREATE INDEX IF NOT EXISTS idx_async_job_queue_idempotency ON async_job_queue(tenant_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_async_job_queue_correlation ON async_job_queue(tenant_id, correlation_id);

INSERT INTO _schema_migrations (version, name, applied_at) VALUES ('046', 'durable_job_queue_schema', CURRENT_TIMESTAMP) ON CONFLICT (version) DO NOTHING;

-- Migration 047: payment_links_and_holds_schema
-- Migration 047: Payment Links, Payment Holds, and Slot Holds Schema (docs/kriya WP-4.4, ADR-011)
-- Subsystem: Payment Collections, Mandate Governed Transactions, and Prepayment Slot Reservations

CREATE TABLE IF NOT EXISTS payment_links (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  customer_ref TEXT NOT NULL,
  customer_name TEXT,
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  description TEXT NOT NULL,
  appointment_id TEXT,
  hold_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('created', 'paid', 'expired', 'cancelled')),
  payment_url TEXT NOT NULL,
  mandate_id TEXT,
  expires_at TEXT NOT NULL,
  paid_at TEXT,
  cancelled_at TEXT,
  cancelled_reason TEXT,
  idempotency_key TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_payment_links_tenant ON payment_links(tenant_id, customer_ref);
CREATE INDEX IF NOT EXISTS idx_payment_links_status ON payment_links(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_payment_links_appt ON payment_links(tenant_id, appointment_id);

CREATE TABLE IF NOT EXISTS payment_holds (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  customer_ref TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  purpose TEXT NOT NULL,
  appointment_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('held', 'captured', 'released', 'expired')),
  expires_at TEXT NOT NULL,
  captured_at TEXT,
  released_at TEXT,
  released_reason TEXT,
  mandate_id TEXT,
  idempotency_key TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_payment_holds_tenant ON payment_holds(tenant_id, customer_ref);
CREATE INDEX IF NOT EXISTS idx_payment_holds_status ON payment_holds(tenant_id, status);

CREATE TABLE IF NOT EXISTS slot_holds (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  customer_ref TEXT NOT NULL,
  customer_name TEXT,
  fee_amount REAL DEFAULT 500.0,
  status TEXT NOT NULL CHECK (status IN ('active', 'released', 'converted', 'expired')),
  expires_at TEXT NOT NULL,
  appointment_id TEXT,
  idempotency_key TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (resource_id) REFERENCES schedule_resources(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_slot_holds_slot ON slot_holds(tenant_id, resource_id, starts_at, status);
CREATE INDEX IF NOT EXISTS idx_slot_holds_cust ON slot_holds(tenant_id, customer_ref, status);

INSERT INTO _schema_migrations (version, name, applied_at) VALUES ('047', 'payment_links_and_holds_schema', CURRENT_TIMESTAMP) ON CONFLICT (version) DO NOTHING;

-- Migration 048: connectors_schema
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
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS external_event_id TEXT;
ALTER TABLE slot_holds ADD COLUMN IF NOT EXISTS external_hold_ref TEXT;

INSERT INTO _schema_migrations (version, name, applied_at) VALUES ('048', 'connectors_schema', CURRENT_TIMESTAMP) ON CONFLICT (version) DO NOTHING;

-- Migration 049: pgvector_schema
-- Kriya Omnitask — Real Embeddings & pgvector Schema (WP-5.8, Blueprint §10, §11, ADR-021)
-- Supports pgvector extension and vector columns on PostgreSQL while maintaining full SQLite in-memory compatibility.

CREATE EXTENSION IF NOT EXISTS vector;

-- Add model and dimension metadata columns to knowledge_chunks
ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS embedding_model TEXT DEFAULT 'text-embedding-3-small';
ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS embedding_dimensions INTEGER DEFAULT 1536;

ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS embedding_vector vector(1536);
CREATE INDEX IF NOT EXISTS idx_kchunks_vector ON knowledge_chunks USING hnsw (embedding_vector vector_cosine_ops);

INSERT INTO _schema_migrations (version, name, applied_at) VALUES ('049', 'pgvector_schema', CURRENT_TIMESTAMP) ON CONFLICT (version) DO NOTHING;

-- Migration 050: reach_browser_schema
-- Kriya Omnitask — Reach Browser Tool Schema (WP-5.5, Blueprint §10, §15, ADR-022)
-- Tracks isolated browser automation sessions, evidence hashes, and Proof linkage across tenants.

CREATE TABLE IF NOT EXISTS reach_sessions (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    run_id TEXT,
    status TEXT NOT NULL, -- 'completed', 'failed', 'killed', 'security_blocked'
    initial_url TEXT NOT NULL,
    final_url TEXT,
    actions_count INTEGER NOT NULL DEFAULT 0,
    proof_receipt_id TEXT,
    evidence_sha256 TEXT,
    error_message TEXT,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_reach_sessions_tenant ON reach_sessions(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_reach_sessions_run ON reach_sessions(run_id);

INSERT INTO _schema_migrations (version, name, applied_at) VALUES ('050', 'reach_browser_schema', CURRENT_TIMESTAMP) ON CONFLICT (version) DO NOTHING;

-- Migration 051: outcome_kpi_instrumentation_schema
-- Migration 051: Outcome Instrumentation & Blueprint KPI Framework (docs/kriya WP-6.1, Blueprint §14, CLAUDE.md §35, §39)
-- Captures ground-truth outcome metrics snapshots and cost cascade (L0-L3) execution events.

CREATE TABLE IF NOT EXISTS outcome_metrics_snapshots (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  window_type TEXT NOT NULL CHECK (window_type IN ('1h', '24h', '7d', '30d', 'custom')),
  window_start TEXT NOT NULL,
  window_end TEXT NOT NULL,
  dimension_type TEXT NOT NULL CHECK (dimension_type IN ('tenant', 'agent', 'workflow', 'overall')),
  dimension_id TEXT NOT NULL DEFAULT 'all',
  metrics_json TEXT NOT NULL,
  calculated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_outcome_snapshots_tenant_dim 
ON outcome_metrics_snapshots(tenant_id, dimension_type, dimension_id, calculated_at);

CREATE TABLE IF NOT EXISTS cascade_execution_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  run_id TEXT,
  correlation_id TEXT,
  agent_id TEXT NOT NULL,
  workflow_id TEXT,
  cascade_level TEXT NOT NULL CHECK (cascade_level IN ('L0_rule', 'L1_cache', 'L2_fast_model', 'L3_reasoning_model', 'human_review')),
  model_id TEXT,
  resolved INTEGER NOT NULL DEFAULT 1,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0.0,
  rule_name TEXT,
  details_json TEXT DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_cascade_events_tenant_time 
ON cascade_execution_events(tenant_id, created_at);

CREATE INDEX IF NOT EXISTS idx_cascade_events_tenant_agent 
ON cascade_execution_events(tenant_id, agent_id, created_at);

CREATE INDEX IF NOT EXISTS idx_cascade_events_tenant_level 
ON cascade_execution_events(tenant_id, cascade_level, created_at);

INSERT INTO _schema_migrations (version, name, applied_at) VALUES ('051', 'outcome_kpi_instrumentation_schema', CURRENT_TIMESTAMP) ON CONFLICT (version) DO NOTHING;

-- Migration 052: evaluation_ci_gates_schema
-- Migration 052: Evals-as-CI & Regression Gating Schema (WP-6.2)
-- Tracks CI evaluation runs, model swap regression gates, and agent charter update gates (§14, §18 of CLAUDE.md)

CREATE TABLE IF NOT EXISTS evaluation_ci_runs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  organization_id TEXT NOT NULL DEFAULT 'default',
  suite_id TEXT NOT NULL,
  agent_slug TEXT NOT NULL,
  evaluation_type TEXT NOT NULL CHECK (evaluation_type IN ('standard_ci', 'model_swap_gate', 'charter_gate')),
  baseline_model_id TEXT,
  candidate_model_id TEXT,
  baseline_pass_rate REAL,
  candidate_pass_rate REAL,
  pass_k_trials INTEGER NOT NULL DEFAULT 1,
  safety_breaches INTEGER NOT NULL DEFAULT 0,
  verdict TEXT NOT NULL CHECK (verdict IN ('release_approved', 'release_blocked_regression', 'conditional_pass')),
  gate_notes_json TEXT NOT NULL DEFAULT '[]',
  report_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_eval_ci_runs_tenant_agent ON evaluation_ci_runs(tenant_id, agent_slug);
CREATE INDEX IF NOT EXISTS idx_eval_ci_runs_tenant_verdict ON evaluation_ci_runs(tenant_id, verdict);

INSERT INTO _schema_migrations (version, name, applied_at) VALUES ('052', 'evaluation_ci_gates_schema', CURRENT_TIMESTAMP) ON CONFLICT (version) DO NOTHING;

-- Migration 053: error_budget_autonomy_throttling_schema
-- Migration 053: Error-Budget Autonomy Throttling Schema (WP-6.3)
-- Implements rolling error budgets, SLA targets, automated step-down throttling,
-- and audited human restoration transitions (CLAUDE.md §15, §37; Blueprint §14; ADR-026)

CREATE TABLE IF NOT EXISTS agent_error_budgets (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  agent_slug TEXT NOT NULL,
  configured_tier_cap TEXT NOT NULL CHECK (configured_tier_cap IN ('T0', 'T1', 'T2', 'T3')),
  effective_tier_cap TEXT NOT NULL CHECK (effective_tier_cap IN ('T0', 'T1', 'T2', 'T3')),
  is_throttled INTEGER NOT NULL DEFAULT 0,
  target_sla_rate REAL NOT NULL DEFAULT 0.99,
  allowed_error_budget REAL NOT NULL DEFAULT 0.01,
  current_error_rate REAL NOT NULL DEFAULT 0.0,
  burned_budget_percent REAL NOT NULL DEFAULT 0.0,
  sample_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  throttled_at TEXT,
  throttled_reason TEXT,
  restored_at TEXT,
  restored_by TEXT,
  last_evaluated_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  UNIQUE(tenant_id, agent_slug)
);

CREATE INDEX IF NOT EXISTS idx_agent_error_budgets_tenant ON agent_error_budgets(tenant_id, agent_slug);
CREATE INDEX IF NOT EXISTS idx_agent_error_budgets_throttled ON agent_error_budgets(tenant_id, is_throttled);

CREATE TABLE IF NOT EXISTS agent_autonomy_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  agent_slug TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('throttled', 'restored', 'budget_warning', 'evaluated')),
  from_tier TEXT NOT NULL CHECK (from_tier IN ('T0', 'T1', 'T2', 'T3')),
  to_tier TEXT NOT NULL CHECK (to_tier IN ('T0', 'T1', 'T2', 'T3')),
  burned_budget_percent REAL NOT NULL,
  reason TEXT NOT NULL,
  actor TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_autonomy_events_tenant ON agent_autonomy_events(tenant_id, agent_slug, created_at);

INSERT INTO _schema_migrations (version, name, applied_at) VALUES ('053', 'error_budget_autonomy_throttling_schema', CURRENT_TIMESTAMP) ON CONFLICT (version) DO NOTHING;

-- Migration 054: dpdp_operations_schema
-- Migration 054: Digital Personal Data Protection (DPDP) Operations Schema (WP-8.2)
-- India DPDP Act 2023 compliance: Consent Ledger (§6, §7), Rights Requests & Erasure Receipts (§11, §12, §13, §14),
-- Automated Data Retention Purges (§8(7)), and Breach Incident Governance (§8(6)).

CREATE TABLE IF NOT EXISTS dpdp_consent_ledger (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  purpose TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('granted', 'withdrawn', 'expired', 'superseded')),
  notice_version TEXT NOT NULL DEFAULT 'v1.0',
  notice_hash TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en',
  valid_until TEXT,
  proof_receipt_id TEXT,
  withdrawn_at TEXT,
  withdrawn_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_dpdp_consent_tenant_customer ON dpdp_consent_ledger(tenant_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_dpdp_consent_purpose ON dpdp_consent_ledger(tenant_id, purpose, status);

CREATE TABLE IF NOT EXISTS dpdp_rights_requests (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  request_type TEXT NOT NULL CHECK (request_type IN ('access', 'correction', 'erasure', 'grievance', 'nominee')),
  status TEXT NOT NULL CHECK (status IN ('submitted', 'in_review', 'completed', 'rejected')),
  payload_json TEXT NOT NULL DEFAULT '{}',
  resolution_notes TEXT,
  erasure_tombstone_hash TEXT,
  proof_receipt_id TEXT,
  sla_expires_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_dpdp_rights_tenant_customer ON dpdp_rights_requests(tenant_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_dpdp_rights_status ON dpdp_rights_requests(tenant_id, status);

CREATE TABLE IF NOT EXISTS dpdp_retention_jobs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  policy_id TEXT,
  target_resource_type TEXT NOT NULL,
  retention_days INTEGER NOT NULL,
  cutoff_timestamp TEXT NOT NULL,
  records_scanned INTEGER NOT NULL DEFAULT 0,
  records_purged INTEGER NOT NULL DEFAULT 0,
  purge_action TEXT NOT NULL CHECK (purge_action IN ('anonymize', 'hard_delete')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  proof_receipt_id TEXT,
  executed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_dpdp_retention_jobs_tenant ON dpdp_retention_jobs(tenant_id, status);

CREATE TABLE IF NOT EXISTS dpdp_breach_incidents (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  incident_name TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')),
  breach_type TEXT NOT NULL CHECK (breach_type IN ('unauthorized_access', 'accidental_exposure', 'ransomware_loss', 'credential_leakage')),
  status TEXT NOT NULL CHECK (status IN ('detected', 'contained', 'notified', 'resolved')),
  affected_principals_count INTEGER NOT NULL DEFAULT 0,
  incident_summary TEXT NOT NULL,
  root_cause TEXT,
  remediation_steps TEXT,
  dpbi_notified_at TEXT,
  dpbi_reference_number TEXT,
  principals_notified_at TEXT,
  dpo_contact TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_dpdp_breach_tenant_status ON dpdp_breach_incidents(tenant_id, status);

INSERT INTO _schema_migrations (version, name, applied_at) VALUES ('054', 'dpdp_operations_schema', CURRENT_TIMESTAMP) ON CONFLICT (version) DO NOTHING;

-- Migration 055: observability_prometheus_and_slo_schema
-- Migration 055: Observability Prometheus & Multi-Window SLO Alert Schema (WP-8.3)
-- Subsystem: Prometheus Metrics Registry, Multi-Window SLO Burn Rate Alerts, Distributed Spans

CREATE TABLE IF NOT EXISTS prometheus_metric_snapshots (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  snapshot_timestamp TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  metric_type TEXT NOT NULL,
  labels_json TEXT NOT NULL DEFAULT '{}',
  value REAL NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_prometheus_metric_snapshots_tenant ON prometheus_metric_snapshots(tenant_id, metric_name, snapshot_timestamp);

CREATE TABLE IF NOT EXISTS slo_alert_incidents (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  slo_id TEXT NOT NULL,
  alert_id TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('P1_CRITICAL', 'P2_HIGH', 'P3_MEDIUM', 'P4_LOW')),
  burn_rate_1h REAL NOT NULL,
  burn_rate_6h REAL NOT NULL DEFAULT 1.0,
  burn_rate_24h REAL NOT NULL,
  remaining_budget_percent REAL NOT NULL,
  escalated_attention_item_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('firing', 'acknowledged', 'resolved')),
  channels_json TEXT NOT NULL DEFAULT '["slack", "pagerduty", "webhook"]',
  incident_summary TEXT NOT NULL,
  dispatched_at TEXT NOT NULL,
  acknowledged_at TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (slo_id) REFERENCES slo_definitions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_slo_alert_incidents_tenant ON slo_alert_incidents(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_slo_alert_incidents_slo ON slo_alert_incidents(slo_id, status);

INSERT INTO _schema_migrations (version, name, applied_at) VALUES ('055', 'observability_prometheus_and_slo_schema', CURRENT_TIMESTAMP) ON CONFLICT (version) DO NOTHING;

-- Migration 056: reliability_drills_and_pitr_schema
-- Migration 056: Reliability Drills, Failover Runbooks & Point-In-Time Recovery Schema (WP-8.4)
-- Subsystem: Chaos Injection Drills (Staging Only), PITR Snapshots/Restores, High-Availability Failovers

CREATE TABLE IF NOT EXISTS reliability_drill_runs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  drill_name TEXT NOT NULL,
  fault_type TEXT NOT NULL CHECK (fault_type IN ('network_drop_retry', 'llm_rate_limit_fallback', 'db_pool_exhaustion', 'worker_queue_crash', 'latency_spike')),
  environment TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('passed', 'failed', 'aborted')),
  injected_count INTEGER NOT NULL,
  survived_count INTEGER NOT NULL,
  recovery_time_ms INTEGER NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_reliability_drill_runs_tenant ON reliability_drill_runs(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS pitr_snapshots (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  snapshot_name TEXT NOT NULL,
  snapshot_type TEXT NOT NULL CHECK (snapshot_type IN ('full', 'incremental', 'wal_checkpoint')),
  checksum_sha256 TEXT NOT NULL,
  record_counts_json TEXT NOT NULL DEFAULT '{}',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  data_payload_json TEXT,
  status TEXT NOT NULL CHECK (status IN ('completed', 'corrupted', 'pending')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pitr_snapshots_tenant ON pitr_snapshots(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS pitr_restore_operations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  target_timestamp TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('completed', 'verified', 'failed', 'in_progress')),
  restored_records_count INTEGER NOT NULL DEFAULT 0,
  verified INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  executed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (snapshot_id) REFERENCES pitr_snapshots(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pitr_restore_operations_tenant ON pitr_restore_operations(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS failover_drill_runs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  drill_name TEXT NOT NULL,
  primary_node_id TEXT NOT NULL,
  promoted_replica_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
  failover_time_ms INTEGER NOT NULL,
  steps_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_failover_drill_runs_tenant ON failover_drill_runs(tenant_id, created_at DESC);

INSERT INTO _schema_migrations (version, name, applied_at) VALUES ('056', 'reliability_drills_and_pitr_schema', CURRENT_TIMESTAMP) ON CONFLICT (version) DO NOTHING;

-- Migration 057: release_canary_rollback_and_hosting_schema
-- ============================================================================
-- Migration 057: Release Gating, Canary Routing, One-Step Rollback & India Hosting Schema
-- Kriya Omnitask — Milestone M8 / WP-8.5
-- ============================================================================

-- 1. API Version Registrations Table
CREATE TABLE IF NOT EXISTS api_version_registrations (
    id VARCHAR(36) PRIMARY KEY,
    api_version VARCHAR(20) NOT NULL UNIQUE,
    status VARCHAR(20) NOT NULL DEFAULT 'active', -- 'active', 'deprecated', 'sunset'
    min_supported_client_version VARCHAR(20) NOT NULL,
    deprecated_at TIMESTAMP,
    sunset_at TIMESTAMP,
    notes TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_api_ver_status ON api_version_registrations(status);

-- 2. Canary Routing Configurations Table
CREATE TABLE IF NOT EXISTS canary_routing_configurations (
    id VARCHAR(36) PRIMARY KEY,
    deployment_id VARCHAR(36) NOT NULL,
    traffic_weight_pct INTEGER NOT NULL DEFAULT 0, -- 0 to 100
    routing_strategy VARCHAR(30) NOT NULL DEFAULT 'tenant_hash', -- 'tenant_hash', 'user_hash', 'random'
    evaluation_interval_seconds INTEGER NOT NULL DEFAULT 60,
    error_rate_threshold_pct REAL NOT NULL DEFAULT 1.0,
    p99_latency_threshold_ms INTEGER NOT NULL DEFAULT 1500,
    consecutive_healthy_evaluations INTEGER NOT NULL DEFAULT 0,
    consecutive_unhealthy_evaluations INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'active', -- 'active', 'paused', 'completed', 'rolled_back'
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_canary_cfg_deployment ON canary_routing_configurations(deployment_id);
CREATE INDEX IF NOT EXISTS idx_canary_cfg_status ON canary_routing_configurations(status);

-- 3. Canary Telemetry Snapshots Table
CREATE TABLE IF NOT EXISTS canary_telemetry_snapshots (
    id VARCHAR(36) PRIMARY KEY,
    deployment_id VARCHAR(36) NOT NULL,
    sample_window_seconds INTEGER NOT NULL,
    total_requests INTEGER NOT NULL,
    error_count INTEGER NOT NULL,
    error_rate_pct REAL NOT NULL,
    p95_latency_ms REAL NOT NULL,
    p99_latency_ms REAL NOT NULL,
    verdict VARCHAR(20) NOT NULL, -- 'healthy', 'warning', 'critical'
    action_taken VARCHAR(20) NOT NULL, -- 'advance', 'hold', 'rollback'
    reason TEXT,
    evaluated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_canary_telemetry_dep ON canary_telemetry_snapshots(deployment_id);
CREATE INDEX IF NOT EXISTS idx_canary_telemetry_eval ON canary_telemetry_snapshots(evaluated_at);

-- 4. Deployment Rollback Events Table
CREATE TABLE IF NOT EXISTS deployment_rollback_events (
    id VARCHAR(36) PRIMARY KEY,
    deployment_id VARCHAR(36) NOT NULL,
    rollback_type VARCHAR(30) NOT NULL, -- 'automated_telemetry', 'manual_operator', 'circuit_breaker'
    trigger_reason TEXT NOT NULL,
    previous_weight_pct INTEGER NOT NULL,
    target_weight_pct INTEGER NOT NULL DEFAULT 0,
    proof_receipt_id VARCHAR(64),
    attention_item_id VARCHAR(64),
    executed_by VARCHAR(100) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rollback_events_dep ON deployment_rollback_events(deployment_id);
CREATE INDEX IF NOT EXISTS idx_rollback_events_type ON deployment_rollback_events(rollback_type);

-- 5. Data Residency Configurations Table (India DPDP & Sovereign Cloud Residency)
CREATE TABLE IF NOT EXISTS data_residency_configs (
    id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL UNIQUE,
    jurisdiction VARCHAR(30) NOT NULL DEFAULT 'IN_DPDP_2023', -- 'IN_DPDP_2023', 'EU_GDPR', 'US_HIPAA', 'GLOBAL'
    primary_region VARCHAR(30) NOT NULL DEFAULT 'ap-south-1', -- 'ap-south-1', 'ap-south-2', 'in-central1'
    allowed_regions_json TEXT NOT NULL DEFAULT '["ap-south-1"]',
    strict_data_localization BOOLEAN NOT NULL DEFAULT true,
    cross_border_transfer_permitted BOOLEAN NOT NULL DEFAULT false,
    approved_llm_inference_regions_json TEXT NOT NULL DEFAULT '["ap-south-1"]',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_data_residency_tenant ON data_residency_configs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_data_residency_jurisdiction ON data_residency_configs(jurisdiction);

INSERT INTO _schema_migrations (version, name, applied_at) VALUES ('057', 'release_canary_rollback_and_hosting_schema', CURRENT_TIMESTAMP) ON CONFLICT (version) DO NOTHING;

-- Migration 058: launch_gate_reviews_schema
-- Migration 058: Launch Gate Reviews Schema (WP-8.6)
-- Persists cryptographic launch sign-off audits, gate checks, and Ed25519 proof receipts.

CREATE TABLE IF NOT EXISTS launch_gate_reviews (
  id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL UNIQUE,
  evaluated_at TEXT NOT NULL,
  overall_status TEXT NOT NULL,
  app_mode TEXT NOT NULL,
  environment TEXT NOT NULL,
  reviewer TEXT NOT NULL,
  proof_receipt_id TEXT,
  gate_checks_json TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  signature TEXT NOT NULL,
  signed_payload_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_launch_gate_reviews_status ON launch_gate_reviews(overall_status);
CREATE INDEX IF NOT EXISTS idx_launch_gate_reviews_evaluated_at ON launch_gate_reviews(evaluated_at);
CREATE INDEX IF NOT EXISTS idx_launch_gate_reviews_proof ON launch_gate_reviews(proof_receipt_id);

INSERT INTO _schema_migrations (version, name, applied_at) VALUES ('058', 'launch_gate_reviews_schema', CURRENT_TIMESTAMP) ON CONFLICT (version) DO NOTHING;
