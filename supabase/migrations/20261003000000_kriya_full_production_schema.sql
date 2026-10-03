-- ==============================================================================
-- KRIYA AI — AUTONOMOUS OPERATIONS RUNTIME (SUPABASE PRODUCTION SCHEMA)
-- Generated on: 2026-10-03
-- Project Ref: dfmdyewhtaolqkjrmdjz
-- Contains all 58 production migrations with pgvector, pgcrypto & uuid-ossp.
-- ==============================================================================

-- 1. Enable Core PostgreSQL Extensions in Supabase
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

-- 2. Schema Migrations Ledger
CREATE TABLE IF NOT EXISTS _schema_migrations (
  version TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);


-- ------------------------------------------------------------------------------
-- MIGRATION 001: initial_schema
-- ------------------------------------------------------------------------------

-- ==============================================================================
-- Xylarc AI Migration 001: Initial Platform Foundation Schema
-- Defines core tenant, identity, workspace, role, and immutable audit structures.
-- ==============================================================================

-- 1. Tenants (Top-level isolation boundary)
CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'active', -- active, suspended, disabled
    plan_tier TEXT NOT NULL DEFAULT 'standard',
    channel_plan TEXT NOT NULL DEFAULT 'combined', -- whatsapp_only, voice_only, combined
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug);
CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status);

-- 2. Organizations (Customer legal / commercial entity within a tenant)
CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_orgs_tenant ON organizations(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orgs_tenant_slug ON organizations(tenant_id, slug);

-- 3. Workspaces (Operational units, branches, or department scopes)
CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    organization_id TEXT NOT NULL,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY(organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_workspaces_tenant ON workspaces(tenant_id);
CREATE INDEX IF NOT EXISTS idx_workspaces_org ON workspaces(organization_id);

-- 4. Users (Administrators, operators, analysts)
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    email TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active', -- active, inactive, locked
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_tenant_email ON users(tenant_id, email);
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);

-- 5. Roles & Permissions
CREATE TABLE IF NOT EXISTS roles (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL, -- null or 'system' for global system roles
    name TEXT NOT NULL,
    description TEXT,
    permissions_json TEXT NOT NULL DEFAULT '[]',
    is_system INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_roles_tenant ON roles(tenant_id);

-- 6. User Roles Mapping
CREATE TABLE IF NOT EXISTS user_roles (
    user_id TEXT NOT NULL,
    role_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, role_id),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(role_id) REFERENCES roles(id) ON DELETE CASCADE,
    FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_roles_tenant ON user_roles(tenant_id);

-- 7. Tenant Configurations (Feature flags, quotas, channel settings)
CREATE TABLE IF NOT EXISTS tenant_configurations (
    tenant_id TEXT PRIMARY KEY,
    settings_json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL,
    FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- 8. Immutable Audit Logs (Cryptographic actor & action ledger)
CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    organization_id TEXT,
    workspace_id TEXT,
    user_id TEXT,
    correlation_id TEXT NOT NULL,
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT,
    details_json TEXT NOT NULL DEFAULT '{}',
    ip_address TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_tenant ON audit_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_correlation ON audit_logs(correlation_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);

-- 9. Seed Default System Roles
INSERT INTO roles (id, tenant_id, name, description, permissions_json, is_system, created_at, updated_at) VALUES
('role-owner', 'system', 'owner', 'Tenant Owner with full administrative authority', '["*"]', 1, '2026-08-15T00:00:00.000Z', '2026-08-15T00:00:00.000Z'),
('role-admin', 'system', 'admin', 'Tenant Administrator', '[]', 1, '2026-08-15T00:00:00.000Z', '2026-08-15T00:00:00.000Z'),
('role-operations_manager', 'system', 'operations_manager', 'Operations Manager', '[]', 1, '2026-08-15T00:00:00.000Z', '2026-08-15T00:00:00.000Z'),
('role-sales_manager', 'system', 'sales_manager', 'Sales Manager', '[]', 1, '2026-08-15T00:00:00.000Z', '2026-08-15T00:00:00.000Z'),
('role-support_manager', 'system', 'support_manager', 'Support Manager', '[]', 1, '2026-08-15T00:00:00.000Z', '2026-08-15T00:00:00.000Z'),
('role-agent_operator', 'system', 'agent_operator', 'Agent Fleet Operator', '[]', 1, '2026-08-15T00:00:00.000Z', '2026-08-15T00:00:00.000Z'),
('role-analyst', 'system', 'analyst', 'Business & Operational Analyst', '[]', 1, '2026-08-15T00:00:00.000Z', '2026-08-15T00:00:00.000Z'),
('role-finance', 'system', 'finance', 'Finance & Billing Manager', '[]', 1, '2026-08-15T00:00:00.000Z', '2026-08-15T00:00:00.000Z'),
('role-read_only', 'system', 'read_only', 'Read-Only Viewer', '[]', 1, '2026-08-15T00:00:00.000Z', '2026-08-15T00:00:00.000Z') ON CONFLICT (id) DO NOTHING;

INSERT INTO _schema_migrations (version, name, applied_at)
VALUES ('001', 'initial_schema', CURRENT_TIMESTAMP)
ON CONFLICT (version) DO NOTHING;

-- ------------------------------------------------------------------------------
-- MIGRATION 002: customer360_schema
-- ------------------------------------------------------------------------------

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

INSERT INTO _schema_migrations (version, name, applied_at)
VALUES ('002', 'customer360_schema', CURRENT_TIMESTAMP)
ON CONFLICT (version) DO NOTHING;

-- ------------------------------------------------------------------------------
-- MIGRATION 003: communication_gateway_schema
-- ------------------------------------------------------------------------------

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

INSERT INTO _schema_migrations (version, name, applied_at)
VALUES ('003', 'communication_gateway_schema', CURRENT_TIMESTAMP)
ON CONFLICT (version) DO NOTHING;

-- ------------------------------------------------------------------------------
-- MIGRATION 004: agent_registry_schema
-- ------------------------------------------------------------------------------

-- ============================================================================
-- Migration 004: Agent Registry, Typed Schemas & Lifecycle States
-- Multi-tenant agent specification, lifecycle state tracking, and execution log.
-- ============================================================================

-- 1. Agents Specification & Registry Table
CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    slug TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    category TEXT NOT NULL, -- orchestrator, manager, specialist, verifier
    department TEXT NOT NULL, -- executive, sales, support, operations, marketing, finance, general
    autonomy_level INTEGER NOT NULL DEFAULT 1, -- 0 (Observe) to 5 (Strategic Autonomy)
    risk_tier TEXT NOT NULL DEFAULT 'LOW', -- LOW, MEDIUM, HIGH, CRITICAL
    status TEXT NOT NULL DEFAULT 'draft', -- draft, idle, active, paused, error
    version TEXT NOT NULL DEFAULT '1.0.0',
    is_system INTEGER NOT NULL DEFAULT 0,
    config_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    UNIQUE(tenant_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_agents_tenant ON agents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_agents_category ON agents(tenant_id, category);

-- 2. Agent Lifecycle Events & Transition Audit Trail
CREATE TABLE IF NOT EXISTS agent_lifecycle_events (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    from_state TEXT NOT NULL,
    to_state TEXT NOT NULL,
    transition TEXT NOT NULL, -- publish, activate, complete, pause, resume, trip_error, recover
    reason TEXT NOT NULL,
    actor_type TEXT NOT NULL, -- human_operator, agent, system, circuit_breaker
    actor_id TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY(agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_lifecycle_agent ON agent_lifecycle_events(tenant_id, agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_lifecycle_created ON agent_lifecycle_events(created_at);

-- 3. Agent Execution Log
CREATE TABLE IF NOT EXISTS agent_executions (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    correlation_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    input_json TEXT NOT NULL,
    output_json TEXT,
    status TEXT NOT NULL DEFAULT 'queued', -- queued, running, completed, failed, escalated
    confidence_score REAL,
    cost_usd REAL NOT NULL DEFAULT 0.0,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY(agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_executions_agent ON agent_executions(tenant_id, agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_executions_task ON agent_executions(tenant_id, task_id);
CREATE INDEX IF NOT EXISTS idx_agent_executions_correlation ON agent_executions(correlation_id);

INSERT INTO _schema_migrations (version, name, applied_at)
VALUES ('004', 'agent_registry_schema', CURRENT_TIMESTAMP)
ON CONFLICT (version) DO NOTHING;

-- ------------------------------------------------------------------------------
-- MIGRATION 005: tool_gateway_schema
-- ------------------------------------------------------------------------------

-- Xylarc AI — Mediated Tool Gateway & Credential Vault Schema Migration 005
-- Implements credential isolation, per-tool permissions, idempotency tracking, and audit ledger (§8.4, §15, §18 of CLAUDE.md)

CREATE TABLE IF NOT EXISTS tenant_credentials (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    service_slug TEXT NOT NULL,
    name TEXT NOT NULL,
    encrypted_data TEXT NOT NULL,
    iv TEXT NOT NULL,
    tag TEXT NOT NULL,
    metadata_json TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    UNIQUE(tenant_id, service_slug)
);

CREATE INDEX IF NOT EXISTS idx_tenant_credentials_tenant_service 
ON tenant_credentials(tenant_id, service_slug);

CREATE TABLE IF NOT EXISTS tool_definitions (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL, -- crm, calendar, communication, payment, webhook, custom
    risk_tier TEXT NOT NULL DEFAULT 'LOW', -- LOW, MEDIUM, HIGH, CRITICAL
    requires_approval INTEGER NOT NULL DEFAULT 0,
    input_schema_json TEXT NOT NULL DEFAULT '{}',
    output_schema_json TEXT NOT NULL DEFAULT '{}',
    is_system INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

CREATE TABLE IF NOT EXISTS tool_permissions (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    agent_id TEXT, -- NULL denotes tenant-wide policy
    tool_slug TEXT NOT NULL,
    is_enabled INTEGER NOT NULL DEFAULT 1,
    daily_quota_limit INTEGER DEFAULT 1000,
    daily_invocation_count INTEGER DEFAULT 0,
    last_invoked_at TEXT,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    UNIQUE(tenant_id, agent_id, tool_slug)
);

CREATE INDEX IF NOT EXISTS idx_tool_permissions_tenant_agent
ON tool_permissions(tenant_id, agent_id, tool_slug);

CREATE TABLE IF NOT EXISTS tool_executions (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    agent_id TEXT,
    tool_slug TEXT NOT NULL,
    idempotency_key TEXT,
    risk_tier TEXT NOT NULL DEFAULT 'LOW',
    status TEXT NOT NULL DEFAULT 'pending', -- pending, executing, completed, failed, needs_approval
    input_json TEXT NOT NULL,
    output_json TEXT,
    error_message TEXT,
    duration_ms INTEGER DEFAULT 0,
    caller_ip TEXT,
    correlation_id TEXT,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    UNIQUE(tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_tool_executions_tenant_tool 
ON tool_executions(tenant_id, tool_slug, created_at);

CREATE INDEX IF NOT EXISTS idx_tool_executions_idempotency 
ON tool_executions(tenant_id, idempotency_key);

INSERT INTO _schema_migrations (version, name, applied_at)
VALUES ('005', 'tool_gateway_schema', CURRENT_TIMESTAMP)
ON CONFLICT (version) DO NOTHING;

-- ------------------------------------------------------------------------------
-- MIGRATION 006: policy_engine_schema
-- ------------------------------------------------------------------------------

-- Xylarc AI — Policy-as-Code Engine & Deterministic Verifier Schema Migration 006
-- Implements declarative business rules, invariant evaluations, and compliance audit ledger (§14, §16 of CLAUDE.md)

CREATE TABLE IF NOT EXISTS policy_rules (
    id TEXT PRIMARY KEY,
    tenant_id TEXT, -- NULL denotes global system default rule
    slug TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL, -- compliance, financial, privacy, channel_governance, operational
    severity TEXT NOT NULL DEFAULT 'BLOCK', -- INFO, WARN, BLOCK, ESCALATE
    action TEXT NOT NULL DEFAULT 'BLOCK_ACTION', -- ALLOW, WARN, BLOCK_ACTION, REQUIRE_APPROVAL, ESCALATE_TO_HUMAN
    condition_json TEXT NOT NULL,
    is_enabled INTEGER NOT NULL DEFAULT 1,
    is_system INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    UNIQUE(tenant_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_policy_rules_tenant_category
ON policy_rules(tenant_id, category, is_enabled);

CREATE TABLE IF NOT EXISTS policy_evaluations (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    action_type TEXT NOT NULL, -- tool_execution, agent_output, outbound_message, financial_transaction, consent_check
    resource_id TEXT,
    actor_type TEXT NOT NULL, -- agent, user, system
    actor_id TEXT,
    evaluation_result TEXT NOT NULL, -- PASS, WARN, BLOCKED, ESCALATED
    violations_json TEXT NOT NULL DEFAULT '[]',
    context_snapshot_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_policy_evaluations_tenant_result
ON policy_evaluations(tenant_id, evaluation_result, created_at);

INSERT INTO _schema_migrations (version, name, applied_at)
VALUES ('006', 'policy_engine_schema', CURRENT_TIMESTAMP)
ON CONFLICT (version) DO NOTHING;

-- ------------------------------------------------------------------------------
-- MIGRATION 007: workflow_dag_schema
-- ------------------------------------------------------------------------------

-- Xylarc AI — Workflow DAG Engine & Approval Step Schema Migration 007
-- Implements multi-step DAG pipelines, branch/join conditionals, and human approval suspension/resume (§13, §15 of CLAUDE.md)

CREATE TABLE IF NOT EXISTS workflow_definitions (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    slug TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    trigger_type TEXT NOT NULL DEFAULT 'manual', -- manual, webhook, event, schedule
    dag_json TEXT NOT NULL, -- JSON definition of steps, dependencies, and conditions
    is_active INTEGER NOT NULL DEFAULT 1,
    version TEXT NOT NULL DEFAULT '1.0.0',
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    UNIQUE(tenant_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_workflow_definitions_tenant 
ON workflow_definitions(tenant_id, slug);

CREATE TABLE IF NOT EXISTS workflow_executions (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    workflow_id TEXT NOT NULL,
    correlation_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending', -- pending, running, waiting_for_approval, completed, failed, cancelled, rejected
    current_step_id TEXT,
    context_data_json TEXT NOT NULL DEFAULT '{}',
    step_results_json TEXT NOT NULL DEFAULT '{}',
    error_message TEXT,
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (workflow_id) REFERENCES workflow_definitions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_workflow_executions_tenant_status 
ON workflow_executions(tenant_id, status, created_at);

CREATE TABLE IF NOT EXISTS workflow_approval_requests (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    execution_id TEXT NOT NULL,
    step_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', -- pending, approved, rejected
    required_role TEXT NOT NULL DEFAULT 'admin',
    step_payload_json TEXT NOT NULL DEFAULT '{}',
    decision_by TEXT,
    decision_notes TEXT,
    decided_at TEXT,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (execution_id) REFERENCES workflow_executions(id) ON DELETE CASCADE,
    UNIQUE(tenant_id, execution_id, step_id)
);

CREATE INDEX IF NOT EXISTS idx_workflow_approvals_tenant_status 
ON workflow_approval_requests(tenant_id, status, created_at);

INSERT INTO _schema_migrations (version, name, applied_at)
VALUES ('007', 'workflow_dag_schema', CURRENT_TIMESTAMP)
ON CONFLICT (version) DO NOTHING;

-- ------------------------------------------------------------------------------
-- MIGRATION 008: knowledge_fabric_schema
-- ------------------------------------------------------------------------------

-- ============================================================================
-- Migration 008: Knowledge Fabric, Vector / Relational Ingestion & Lineage Schema
-- Phase 11 of Xylarc AI Autonomous Business Workforce (§10, §11, §12 of CLAUDE.md)
-- ============================================================================

-- 1. Knowledge Documents Table
CREATE TABLE IF NOT EXISTS knowledge_documents (
    id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(36) NOT NULL,
    organization_id VARCHAR(36) NOT NULL DEFAULT 'default',
    title VARCHAR(255) NOT NULL,
    source_type VARCHAR(50) NOT NULL, -- 'pdf', 'docx', 'markdown', 'text', 'web_crawl', 'structured_json', 'faq', 'policy_sop'
    source_uri VARCHAR(512),
    mime_type VARCHAR(100) NOT NULL DEFAULT 'text/plain',
    content_raw TEXT NOT NULL,
    content_normalized TEXT NOT NULL,
    summary TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    is_active INTEGER NOT NULL DEFAULT 1, -- 1 = active, 0 = inactive / archived
    quality_status VARCHAR(50) NOT NULL DEFAULT 'UNVERIFIED', -- 'VERIFIED', 'UNVERIFIED', 'STALE', 'CONFLICTING', 'UNKNOWN'
    stale_after_days INTEGER NOT NULL DEFAULT 90,
    provenance_json TEXT NOT NULL DEFAULT '{}', -- author, uploaded_by, source_system, content_hash, verified_at, verified_by
    access_scope_json TEXT NOT NULL DEFAULT '{"allowedRoles":["admin","support_agent"],"allowedAgents":["*"],"isPublicToTenant":true}',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_kdocuments_tenant ON knowledge_documents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_kdocuments_tenant_status ON knowledge_documents(tenant_id, is_active, quality_status);
CREATE INDEX IF NOT EXISTS idx_kdocuments_tenant_source ON knowledge_documents(tenant_id, source_type);

-- 2. Knowledge Chunks Table (Dense Vector + Full Text / Metadata Index)
CREATE TABLE IF NOT EXISTS knowledge_chunks (
    id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(36) NOT NULL,
    document_id VARCHAR(36) NOT NULL,
    chunk_index INTEGER NOT NULL,
    heading_context VARCHAR(255) NOT NULL DEFAULT '',
    content TEXT NOT NULL,
    token_count INTEGER NOT NULL DEFAULT 0,
    embedding_json TEXT, -- JSON array of floating-point numbers (e.g. 128 / 768 / 1536 dims)
    quality_status VARCHAR(50) NOT NULL DEFAULT 'UNVERIFIED',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (document_id) REFERENCES knowledge_documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_kchunks_tenant_doc ON knowledge_chunks(tenant_id, document_id);
CREATE INDEX IF NOT EXISTS idx_kchunks_tenant ON knowledge_chunks(tenant_id);

-- 3. Knowledge Lineage Events Table (Immutable Provenance Ledger)
CREATE TABLE IF NOT EXISTS knowledge_lineage_events (
    id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(36) NOT NULL,
    document_id VARCHAR(36) NOT NULL,
    event_type VARCHAR(50) NOT NULL, -- 'ingested', 'chunked', 'embedded', 'updated', 'verified', 'invalidated', 'retrieved'
    actor_type VARCHAR(50) NOT NULL, -- 'user', 'agent', 'system'
    actor_id VARCHAR(100) NOT NULL,
    agent_id VARCHAR(100),
    query_text TEXT,
    details_json TEXT NOT NULL DEFAULT '{}',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_klineage_tenant_doc ON knowledge_lineage_events(tenant_id, document_id);
CREATE INDEX IF NOT EXISTS idx_klineage_tenant_event ON knowledge_lineage_events(tenant_id, event_type);

INSERT INTO _schema_migrations (version, name, applied_at)
VALUES ('008', 'knowledge_fabric_schema', CURRENT_TIMESTAMP)
ON CONFLICT (version) DO NOTHING;

-- ------------------------------------------------------------------------------
-- MIGRATION 009: digital_twin_schema
-- ------------------------------------------------------------------------------

-- ============================================================================
-- Migration 009: Business Digital Twin & Organization KPI Model Schema
-- Phase 12 of Xylarc AI Autonomous Business Workforce (§13, §14, §15 of CLAUDE.md)
-- ============================================================================

-- 1. Digital Twin Entities Table (Departments, Locations, Products, Services, Schedules)
CREATE TABLE IF NOT EXISTS digital_twin_entities (
    id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(36) NOT NULL,
    organization_id VARCHAR(36) NOT NULL DEFAULT 'default',
    entity_type VARCHAR(50) NOT NULL, -- 'department', 'location', 'product', 'service', 'employee_role', 'operating_schedule', 'business_goal', 'system_integration'
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL,
    description TEXT,
    parent_entity_id VARCHAR(36),
    properties_json TEXT NOT NULL DEFAULT '{}',
    status VARCHAR(50) NOT NULL DEFAULT 'active', -- 'active', 'inactive', 'deprecated'
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_dtentities_tenant ON digital_twin_entities(tenant_id);
CREATE INDEX IF NOT EXISTS idx_dtentities_tenant_type ON digital_twin_entities(tenant_id, entity_type);
CREATE INDEX IF NOT EXISTS idx_dtentities_tenant_parent ON digital_twin_entities(tenant_id, parent_entity_id);

-- 2. Digital Twin Relationships Table (Graph Adjacency Edges)
CREATE TABLE IF NOT EXISTS digital_twin_relationships (
    id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(36) NOT NULL,
    source_entity_id VARCHAR(36) NOT NULL,
    target_entity_id VARCHAR(36) NOT NULL,
    relationship_type VARCHAR(50) NOT NULL, -- 'contains', 'reports_to', 'operates_in', 'produces', 'delivers', 'governed_by', 'assigned_to', 'depends_on'
    properties_json TEXT NOT NULL DEFAULT '{}',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (source_entity_id) REFERENCES digital_twin_entities(id) ON DELETE CASCADE,
    FOREIGN KEY (target_entity_id) REFERENCES digital_twin_entities(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_dtrel_tenant ON digital_twin_relationships(tenant_id);
CREATE INDEX IF NOT EXISTS idx_dtrel_source ON digital_twin_relationships(tenant_id, source_entity_id);
CREATE INDEX IF NOT EXISTS idx_dtrel_target ON digital_twin_relationships(tenant_id, target_entity_id);

-- 3. Organization KPIs Table (Metric Trees, Target vs Actual, Financials)
CREATE TABLE IF NOT EXISTS organization_kpis (
    id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(36) NOT NULL,
    organization_id VARCHAR(36) NOT NULL DEFAULT 'default',
    entity_id VARCHAR(36), -- Optional linked department, service, or agent
    kpi_name VARCHAR(255) NOT NULL,
    kpi_key VARCHAR(100) NOT NULL, -- 'lead_conversion_rate', 'fcr_rate', 'avg_response_time_seconds', 'customer_acquisition_cost', 'monthly_recurring_revenue'
    category VARCHAR(50) NOT NULL, -- 'financial', 'operational', 'customer_experience', 'agent_workforce', 'growth'
    target_value REAL NOT NULL,
    actual_value REAL NOT NULL DEFAULT 0.0,
    unit VARCHAR(30) NOT NULL DEFAULT 'ratio', -- 'usd', 'percent', 'count', 'seconds', 'ratio'
    status VARCHAR(50) NOT NULL DEFAULT 'on_track', -- 'on_track', 'at_risk', 'critical', 'exceeded'
    timeframe VARCHAR(50) NOT NULL DEFAULT 'monthly', -- 'daily', 'weekly', 'monthly', 'quarterly', 'yearly'
    calculation_method_json TEXT NOT NULL DEFAULT '{}',
    last_evaluated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_orgkpis_tenant ON organization_kpis(tenant_id);
CREATE INDEX IF NOT EXISTS idx_orgkpis_tenant_key ON organization_kpis(tenant_id, kpi_key);
CREATE INDEX IF NOT EXISTS idx_orgkpis_tenant_status ON organization_kpis(tenant_id, status);

-- 4. Operational Bottlenecks & Revenue Leaks Table
CREATE TABLE IF NOT EXISTS operational_bottlenecks (
    id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(36) NOT NULL,
    organization_id VARCHAR(36) NOT NULL DEFAULT 'default',
    bottleneck_type VARCHAR(50) NOT NULL, -- 'sla_breach', 'queue_congestion', 'capacity_overload', 'revenue_leak', 'escalation_spike', 'churn_cluster'
    entity_id VARCHAR(36),
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    severity VARCHAR(20) NOT NULL DEFAULT 'MEDIUM', -- 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'
    impact_estimate_usd REAL NOT NULL DEFAULT 0.0,
    recommendation TEXT NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'detected', -- 'detected', 'acknowledged', 'mitigating', 'resolved'
    detected_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_bottlenecks_tenant ON operational_bottlenecks(tenant_id);
CREATE INDEX IF NOT EXISTS idx_bottlenecks_tenant_status ON operational_bottlenecks(tenant_id, status);

INSERT INTO _schema_migrations (version, name, applied_at)
VALUES ('009', 'digital_twin_schema', CURRENT_TIMESTAMP)
ON CONFLICT (version) DO NOTHING;

-- ------------------------------------------------------------------------------
-- MIGRATION 010: business_intelligence_schema
-- ------------------------------------------------------------------------------

-- ============================================================================
-- Migration 010: Business Intelligence & Executive Daily Briefing Schema
-- Phase 13 of Xylarc AI Autonomous Business Workforce (§13, §14 of CLAUDE.md)
-- ============================================================================

CREATE TABLE IF NOT EXISTS executive_briefings (
    id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(36) NOT NULL,
    organization_id VARCHAR(36) NOT NULL DEFAULT 'default',
    briefing_date VARCHAR(10) NOT NULL, -- 'YYYY-MM-DD'
    briefing_type VARCHAR(50) NOT NULL DEFAULT 'daily_executive', -- 'daily_executive', 'weekly_commercial', 'support_health', 'custom'
    title VARCHAR(255) NOT NULL,
    summary_markdown TEXT NOT NULL,
    metrics_snapshot_json TEXT NOT NULL DEFAULT '{}',
    key_highlights_json TEXT NOT NULL DEFAULT '[]',
    attention_items_json TEXT NOT NULL DEFAULT '[]',
    roi_metrics_json TEXT NOT NULL DEFAULT '{}',
    whatsapp_formatted_text TEXT NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'generated', -- 'generated', 'delivered', 'reviewed'
    delivered_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_briefings_tenant_date ON executive_briefings(tenant_id, briefing_date);
CREATE INDEX IF NOT EXISTS idx_briefings_tenant_type ON executive_briefings(tenant_id, briefing_type);
CREATE INDEX IF NOT EXISTS idx_briefings_tenant_status ON executive_briefings(tenant_id, status);

INSERT INTO _schema_migrations (version, name, applied_at)
VALUES ('010', 'business_intelligence_schema', CURRENT_TIMESTAMP)
ON CONFLICT (version) DO NOTHING;

-- ------------------------------------------------------------------------------
-- MIGRATION 011: observability_schema
-- ------------------------------------------------------------------------------

-- ============================================================================
-- Migration 011: Agent Observability, Tracing & Drift Detection Schema
-- Phase 14 of Xylarc AI Autonomous Business Workforce (§14, §16 of CLAUDE.md)
-- ============================================================================

-- 1. Execution Traces Table (Root Agent Interactions & Distributed Sessions)
CREATE TABLE IF NOT EXISTS execution_traces (
    id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(36) NOT NULL,
    organization_id VARCHAR(36) NOT NULL DEFAULT 'default',
    correlation_id VARCHAR(64) NOT NULL,
    root_agent_id VARCHAR(100) NOT NULL,
    customer_id VARCHAR(36),
    channel VARCHAR(30) NOT NULL DEFAULT 'api',
    status VARCHAR(30) NOT NULL DEFAULT 'running', -- 'running', 'completed', 'failed', 'escalated'
    total_latency_ms INTEGER NOT NULL DEFAULT 0,
    total_tokens_input INTEGER NOT NULL DEFAULT 0,
    total_tokens_output INTEGER NOT NULL DEFAULT 0,
    total_cost_usd REAL NOT NULL DEFAULT 0.0,
    grounding_score REAL NOT NULL DEFAULT 1.0, -- 0.0 to 1.0
    drift_detected BOOLEAN NOT NULL DEFAULT false,
    drift_reasons_json TEXT NOT NULL DEFAULT '[]',
    started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_traces_tenant ON execution_traces(tenant_id);
CREATE INDEX IF NOT EXISTS idx_traces_tenant_corr ON execution_traces(tenant_id, correlation_id);
CREATE INDEX IF NOT EXISTS idx_traces_tenant_agent ON execution_traces(tenant_id, root_agent_id);
CREATE INDEX IF NOT EXISTS idx_traces_tenant_status ON execution_traces(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_traces_tenant_drift ON execution_traces(tenant_id, drift_detected);

-- 2. Execution Spans Table (Fine-grained Sub-steps: Model, Tool, Retrieval, Policy, Verification)
CREATE TABLE IF NOT EXISTS execution_spans (
    id VARCHAR(36) PRIMARY KEY,
    trace_id VARCHAR(36) NOT NULL,
    tenant_id VARCHAR(36) NOT NULL,
    parent_span_id VARCHAR(36),
    span_name VARCHAR(255) NOT NULL,
    agent_id VARCHAR(100) NOT NULL,
    step_type VARCHAR(50) NOT NULL, -- 'model_inference', 'tool_execution', 'retrieval', 'policy_check', 'verification', 'orchestration'
    model_id VARCHAR(100),
    tool_name VARCHAR(100),
    status VARCHAR(30) NOT NULL DEFAULT 'completed', -- 'completed', 'error'
    latency_ms INTEGER NOT NULL DEFAULT 0,
    tokens_input INTEGER NOT NULL DEFAULT 0,
    tokens_output INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0.0,
    input_summary TEXT,
    output_summary TEXT,
    attributes_json TEXT NOT NULL DEFAULT '{}',
    started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (trace_id) REFERENCES execution_traces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_spans_tenant_trace ON execution_spans(tenant_id, trace_id);
CREATE INDEX IF NOT EXISTS idx_spans_trace_parent ON execution_spans(trace_id, parent_span_id);
CREATE INDEX IF NOT EXISTS idx_spans_step_type ON execution_spans(tenant_id, step_type);

INSERT INTO _schema_migrations (version, name, applied_at)
VALUES ('011', 'observability_schema', CURRENT_TIMESTAMP)
ON CONFLICT (version) DO NOTHING;

-- ------------------------------------------------------------------------------
-- MIGRATION 012: verification_quality_schema
-- ------------------------------------------------------------------------------

-- Migration 012: Deterministic Verification & Quality Reviewer Schema
-- Tracks pre-flight/post-flight verifications, quality evaluations, and verdicts (§14, §15 of CLAUDE.md)

CREATE TABLE IF NOT EXISTS quality_reviews (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  organization_id TEXT NOT NULL DEFAULT 'default',
  correlation_id TEXT NOT NULL,
  trace_id TEXT,
  agent_id TEXT NOT NULL,
  target_content TEXT NOT NULL,
  retrieved_evidence_json TEXT NOT NULL DEFAULT '[]',
  verdict TEXT NOT NULL CHECK (verdict IN ('approved', 'revise', 'reject_escalate')),
  faithfulness_score REAL NOT NULL DEFAULT 1.0,
  policy_compliance_score REAL NOT NULL DEFAULT 1.0,
  tone_clarity_score REAL NOT NULL DEFAULT 1.0,
  overall_score REAL NOT NULL DEFAULT 1.0,
  flagged_issues_json TEXT NOT NULL DEFAULT '[]',
  corrected_content TEXT,
  reviewer_type TEXT NOT NULL CHECK (reviewer_type IN ('deterministic_rule', 'dual_pass_judge', 'hybrid')),
  reviewed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_quality_reviews_tenant ON quality_reviews(tenant_id);
CREATE INDEX IF NOT EXISTS idx_quality_reviews_agent ON quality_reviews(tenant_id, agent_id);
CREATE INDEX IF NOT EXISTS idx_quality_reviews_verdict ON quality_reviews(tenant_id, verdict);
CREATE INDEX IF NOT EXISTS idx_quality_reviews_correlation ON quality_reviews(tenant_id, correlation_id);

INSERT INTO _schema_migrations (version, name, applied_at)
VALUES ('012', 'verification_quality_schema', CURRENT_TIMESTAMP)
ON CONFLICT (version) DO NOTHING;

-- ------------------------------------------------------------------------------
-- MIGRATION 013: human_attention_schema
-- ------------------------------------------------------------------------------

-- Migration 013: Human Attention Center & Priority Exception Queue Schema
-- Tracks human escalations, exception resolution workflows, and live conversation takeovers (§14, §16 of CLAUDE.md)

CREATE TABLE IF NOT EXISTS attention_items (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  organization_id TEXT NOT NULL DEFAULT 'default',
  correlation_id TEXT NOT NULL,
  trace_id TEXT,
  customer_id TEXT,
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  source_agent_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  reason_category TEXT NOT NULL CHECK (reason_category IN (
    'policy_violation',
    'low_confidence',
    'financial_threshold',
    'sensitive_complaint',
    'security_anomaly',
    'agent_disagreement',
    'workflow_suspended',
    'manual_flag',
    'slo_burn'
  )),
  priority TEXT NOT NULL CHECK (priority IN ('P0_CRITICAL', 'P1_HIGH', 'P2_MEDIUM', 'P3_LOW')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'claimed', 'resolved', 'dismissed', 'timed_out')),
  assigned_user_id TEXT,
  context_data_json TEXT NOT NULL DEFAULT '{}',
  recommended_action TEXT,
  resolution_action TEXT CHECK (resolution_action IN ('approved', 'rejected', 'overridden', 'taken_over', 'dismissed')),
  resolution_notes TEXT,
  sla_expires_at TEXT NOT NULL,
  resolved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_attention_items_tenant_status ON attention_items(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_attention_items_tenant_priority ON attention_items(tenant_id, priority);
CREATE INDEX IF NOT EXISTS idx_attention_items_tenant_customer ON attention_items(tenant_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_attention_items_tenant_assigned ON attention_items(tenant_id, assigned_user_id);

CREATE TABLE IF NOT EXISTS conversation_takeovers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  organization_id TEXT NOT NULL DEFAULT 'default',
  customer_id TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  taken_over_by_user_id TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  reason TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_takeovers_tenant_customer ON conversation_takeovers(tenant_id, customer_id, is_active);

INSERT INTO _schema_migrations (version, name, applied_at)
VALUES ('013', 'human_attention_schema', CURRENT_TIMESTAMP)
ON CONFLICT (version) DO NOTHING;

-- ------------------------------------------------------------------------------
-- MIGRATION 014: simulation_sandbox_schema
-- ------------------------------------------------------------------------------

-- Migration 014: Agent Simulation & Dry-Run Sandbox Schema
-- Tracks simulation scenarios, dry-run sandbox executions, and behavioral regression reports (§14, §17 of CLAUDE.md)

CREATE TABLE IF NOT EXISTS simulation_scenarios (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  organization_id TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN (
    'lead_qualification',
    'customer_support',
    'calendar_booking',
    'reactivation',
    'adversarial_test',
    'edge_case'
  )),
  target_agent_id TEXT NOT NULL,
  mock_customer_json TEXT NOT NULL DEFAULT '{}',
  initial_message TEXT NOT NULL,
  conversation_history_json TEXT NOT NULL DEFAULT '[]',
  mock_tool_responses_json TEXT NOT NULL DEFAULT '{}',
  expected_outcomes_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sim_scenarios_tenant ON simulation_scenarios(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sim_scenarios_category ON simulation_scenarios(tenant_id, category);
CREATE INDEX IF NOT EXISTS idx_sim_scenarios_agent ON simulation_scenarios(tenant_id, target_agent_id);

CREATE TABLE IF NOT EXISTS simulation_runs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  organization_id TEXT NOT NULL DEFAULT 'default',
  scenario_id TEXT NOT NULL,
  run_mode TEXT NOT NULL CHECK (run_mode IN ('dry_run', 'replay', 'synthetic')),
  status TEXT NOT NULL CHECK (status IN ('running', 'passed', 'failed', 'regression_detected')),
  simulated_output TEXT NOT NULL,
  simulated_tool_calls_json TEXT NOT NULL DEFAULT '[]',
  policy_verdicts_json TEXT NOT NULL DEFAULT '[]',
  comparison_report_json TEXT NOT NULL DEFAULT '{}',
  latency_ms INTEGER NOT NULL DEFAULT 0,
  tokens_used INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0.0,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (scenario_id) REFERENCES simulation_scenarios(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sim_runs_tenant_scenario ON simulation_runs(tenant_id, scenario_id);
CREATE INDEX IF NOT EXISTS idx_sim_runs_tenant_status ON simulation_runs(tenant_id, status);

INSERT INTO _schema_migrations (version, name, applied_at)
VALUES ('014', 'simulation_sandbox_schema', CURRENT_TIMESTAMP)
ON CONFLICT (version) DO NOTHING;

-- ------------------------------------------------------------------------------
-- MIGRATION 015: evaluation_benchmark_schema
-- ------------------------------------------------------------------------------

-- Migration 015: Agent Evaluation Benchmark & Golden Test Suite Schema
-- Tracks golden datasets, batch evaluation benchmarks, and release gating verdicts (§14, §18 of CLAUDE.md)

CREATE TABLE IF NOT EXISTS evaluation_datasets (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  organization_id TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '1.0.0',
  target_agent_id TEXT NOT NULL,
  test_cases_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_eval_datasets_tenant ON evaluation_datasets(tenant_id);
CREATE INDEX IF NOT EXISTS idx_eval_datasets_agent ON evaluation_datasets(tenant_id, target_agent_id);

CREATE TABLE IF NOT EXISTS evaluation_benchmarks (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  organization_id TEXT NOT NULL DEFAULT 'default',
  dataset_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  prompt_version TEXT NOT NULL DEFAULT 'v1',
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  verdict TEXT NOT NULL CHECK (verdict IN ('release_approved', 'release_blocked_regression', 'conditional_pass')),
  total_test_cases INTEGER NOT NULL DEFAULT 0,
  passed_test_cases INTEGER NOT NULL DEFAULT 0,
  failed_test_cases INTEGER NOT NULL DEFAULT 0,
  pass_rate REAL NOT NULL DEFAULT 0.0,
  avg_faithfulness REAL NOT NULL DEFAULT 0.0,
  avg_latency_ms INTEGER NOT NULL DEFAULT 0,
  total_cost_usd REAL NOT NULL DEFAULT 0.0,
  detailed_results_json TEXT NOT NULL DEFAULT '[]',
  started_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (dataset_id) REFERENCES evaluation_datasets(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_eval_benchmarks_tenant_dataset ON evaluation_benchmarks(tenant_id, dataset_id);
CREATE INDEX IF NOT EXISTS idx_eval_benchmarks_tenant_status ON evaluation_benchmarks(tenant_id, status);

INSERT INTO _schema_migrations (version, name, applied_at)
VALUES ('015', 'evaluation_benchmark_schema', CURRENT_TIMESTAMP)
ON CONFLICT (version) DO NOTHING;

-- ------------------------------------------------------------------------------
-- MIGRATION 016: multilingual_schema
-- ------------------------------------------------------------------------------

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

INSERT INTO _schema_migrations (version, name, applied_at)
VALUES ('016', 'multilingual_schema', CURRENT_TIMESTAMP)
ON CONFLICT (version) DO NOTHING;

-- ------------------------------------------------------------------------------
-- MIGRATION 017: security_hardening_schema
-- ------------------------------------------------------------------------------

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

INSERT INTO _schema_migrations (version, name, applied_at)
VALUES ('017', 'security_hardening_schema', CURRENT_TIMESTAMP)
ON CONFLICT (version) DO NOTHING;

-- ------------------------------------------------------------------------------
-- MIGRATION 018: reliability_engineering_schema
-- ------------------------------------------------------------------------------

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

INSERT INTO _schema_migrations (version, name, applied_at)
VALUES ('018', 'reliability_engineering_schema', CURRENT_TIMESTAMP)
ON CONFLICT (version) DO NOTHING;

-- ------------------------------------------------------------------------------
-- MIGRATION 019: model_resilience_schema
-- ------------------------------------------------------------------------------

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

INSERT INTO _schema_migrations (version, name, applied_at)
VALUES ('019', 'model_resilience_schema', CURRENT_TIMESTAMP)
ON CONFLICT (version) DO NOTHING;

-- ------------------------------------------------------------------------------
-- MIGRATION 020: cost_intelligence_schema
-- ------------------------------------------------------------------------------

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

INSERT INTO _schema_migrations (version, name, applied_at)
VALUES ('020', 'cost_intelligence_schema', CURRENT_TIMESTAMP)
ON CONFLICT (version) DO NOTHING;

-- ------------------------------------------------------------------------------
-- MIGRATION 021: enterprise_governance_schema
-- ------------------------------------------------------------------------------

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

INSERT INTO _schema_migrations (version, name, applied_at)
VALUES ('021', 'enterprise_governance_schema', CURRENT_TIMESTAMP)
ON CONFLICT (version) DO NOTHING;

-- ------------------------------------------------------------------------------
-- MIGRATION 022: platform_administration_schema
-- ------------------------------------------------------------------------------

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

INSERT INTO _schema_migrations (version, name, applied_at)
VALUES ('022', 'platform_administration_schema', CURRENT_TIMESTAMP)
ON CONFLICT (version) DO NOTHING;

-- ------------------------------------------------------------------------------
-- MIGRATION 023: billing_and_usage_schema
-- ------------------------------------------------------------------------------

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

INSERT INTO _schema_migrations (version, name, applied_at)
VALUES ('023', 'billing_and_usage_schema', CURRENT_TIMESTAMP)
ON CONFLICT (version) DO NOTHING;

-- ------------------------------------------------------------------------------
-- MIGRATION 024: production_infrastructure_schema
-- ------------------------------------------------------------------------------

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

INSERT INTO _schema_migrations (version, name, applied_at)
VALUES ('024', 'production_infrastructure_schema', CURRENT_TIMESTAMP)
ON CONFLICT (version) DO NOTHING;

-- ------------------------------------------------------------------------------
-- MIGRATION 025: observability_sre_schema
-- ------------------------------------------------------------------------------

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

INSERT INTO _schema_migrations (version, name, applied_at)
VALUES ('025', 'observability_sre_schema', CURRENT_TIMESTAMP)
ON CONFLICT (version) DO NOTHING;

-- ------------------------------------------------------------------------------
-- MIGRATION 026: deployment_release_schema
-- ------------------------------------------------------------------------------

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

INSERT INTO _schema_migrations (version, name, applied_at)
VALUES ('026', 'deployment_release_schema', CURRENT_TIMESTAMP)
ON CONFLICT (version) DO NOTHING;

-- ------------------------------------------------------------------------------
-- MIGRATION 027: production_hardening_schema
-- ------------------------------------------------------------------------------

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

INSERT INTO _schema_migrations (version, name, applied_at)
VALUES ('027', 'production_hardening_schema', CURRENT_TIMESTAMP)
ON CONFLICT (version) DO NOTHING;

-- ------------------------------------------------------------------------------
-- MIGRATION 028: tenant_elevation_schema
-- ------------------------------------------------------------------------------

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

INSERT INTO _schema_migrations (version, name, applied_at)
VALUES ('028', 'tenant_elevation_schema', CURRENT_TIMESTAMP)
ON CONFLICT (version) DO NOTHING;

-- ------------------------------------------------------------------------------
-- MIGRATION 029: business_dna_roster_schema
-- ------------------------------------------------------------------------------

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

INSERT INTO _schema_migrations (version, name, applied_at)
VALUES ('029', 'business_dna_roster_schema', CURRENT_TIMESTAMP)
ON CONFLICT (version) DO NOTHING;

-- ------------------------------------------------------------------------------
-- MIGRATION 030: context_memory_schema
-- ------------------------------------------------------------------------------

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

INSERT INTO _schema_migrations (version, name, applied_at)
VALUES ('030', 'context_memory_schema', CURRENT_TIMESTAMP)
ON CONFLICT (version) DO NOTHING;

-- ------------------------------------------------------------------------------
-- MIGRATION 031: model_certification_skills_schema
-- ------------------------------------------------------------------------------

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

INSERT INTO _schema_migrations (version, name, applied_at)
VALUES ('031', 'model_certification_skills_schema', CURRENT_TIMESTAMP)
ON CONFLICT (version) DO NOTHING;

-- ------------------------------------------------------------------------------
-- MIGRATION 032: failure_escalation_schema
-- ------------------------------------------------------------------------------

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

INSERT INTO _schema_migrations (version, name, applied_at)
VALUES ('032', 'failure_escalation_schema', CURRENT_TIMESTAMP)
ON CONFLICT (version) DO NOTHING;

-- ------------------------------------------------------------------------------
-- MIGRATION 033: brain_supply_schema
-- ------------------------------------------------------------------------------

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

INSERT INTO _schema_migrations (version, name, applied_at)
VALUES ('033', 'brain_supply_schema', CURRENT_TIMESTAMP)
ON CONFLICT (version) DO NOTHING;

-- ------------------------------------------------------------------------------
-- MIGRATION 034: secured_external_retrieval_schema
-- ------------------------------------------------------------------------------

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

INSERT INTO _schema_migrations (version, name, applied_at)
VALUES ('034', 'secured_external_retrieval_schema', CURRENT_TIMESTAMP)
ON CONFLICT (version) DO NOTHING;

-- ------------------------------------------------------------------------------
-- MIGRATION 035: realtime_data_layer_schema
-- ------------------------------------------------------------------------------

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

INSERT INTO _schema_migrations (version, name, applied_at)
VALUES ('035', 'realtime_data_layer_schema', CURRENT_TIMESTAMP)
ON CONFLICT (version) DO NOTHING;

-- ------------------------------------------------------------------------------
-- MIGRATION 036: governed_adaptation_schema
-- ------------------------------------------------------------------------------

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

INSERT INTO _schema_migrations (version, name, applied_at)
VALUES ('036', 'governed_adaptation_schema', CURRENT_TIMESTAMP)
ON CONFLICT (version) DO NOTHING;

-- ------------------------------------------------------------------------------
-- MIGRATION 037: graph_runtime_schema
-- ------------------------------------------------------------------------------

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

INSERT INTO _schema_migrations (version, name, applied_at)
VALUES ('037', 'graph_runtime_schema', CURRENT_TIMESTAMP)
ON CONFLICT (version) DO NOTHING;

-- ------------------------------------------------------------------------------
-- MIGRATION 038: mandate_schema
-- ------------------------------------------------------------------------------

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

INSERT INTO _schema_migrations (version, name, applied_at)
VALUES ('038', 'mandate_schema', CURRENT_TIMESTAMP)
ON CONFLICT (version) DO NOTHING;

-- ------------------------------------------------------------------------------
-- MIGRATION 039: proof_receipts_schema
-- ------------------------------------------------------------------------------

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

INSERT INTO _schema_migrations (version, name, applied_at)
VALUES ('039', 'proof_receipts_schema', CURRENT_TIMESTAMP)
ON CONFLICT (version) DO NOTHING;

-- ------------------------------------------------------------------------------
-- MIGRATION 040: agent_charters_schema
-- ------------------------------------------------------------------------------

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

INSERT INTO _schema_migrations (version, name, applied_at)
VALUES ('040', 'agent_charters_schema', CURRENT_TIMESTAMP)
ON CONFLICT (version) DO NOTHING;

-- ------------------------------------------------------------------------------
-- MIGRATION 041: cascade_cache_schema
-- ------------------------------------------------------------------------------

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

INSERT INTO _schema_migrations (version, name, applied_at)
VALUES ('041', 'cascade_cache_schema', CURRENT_TIMESTAMP)
ON CONFLICT (version) DO NOTHING;

-- ------------------------------------------------------------------------------
-- MIGRATION 042: appointment_book_schema
-- ------------------------------------------------------------------------------

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

INSERT INTO _schema_migrations (version, name, applied_at)
VALUES ('042', 'appointment_book_schema', CURRENT_TIMESTAMP)
ON CONFLICT (version) DO NOTHING;

-- ------------------------------------------------------------------------------
-- MIGRATION 043: attention_routing_and_verification_schema
-- ------------------------------------------------------------------------------

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

INSERT INTO _schema_migrations (version, name, applied_at)
VALUES ('043', 'attention_routing_and_verification_schema', CURRENT_TIMESTAMP)
ON CONFLICT (version) DO NOTHING;

-- ------------------------------------------------------------------------------
-- MIGRATION 044: document_lens_schema
-- ------------------------------------------------------------------------------

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

INSERT INTO _schema_migrations (version, name, applied_at)
VALUES ('044', 'document_lens_schema', CURRENT_TIMESTAMP)
ON CONFLICT (version) DO NOTHING;

-- ------------------------------------------------------------------------------
-- MIGRATION 045: refunds_and_leave_workflow_schema
-- ------------------------------------------------------------------------------

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

INSERT INTO _schema_migrations (version, name, applied_at)
VALUES ('045', 'refunds_and_leave_workflow_schema', CURRENT_TIMESTAMP)
ON CONFLICT (version) DO NOTHING;

-- ------------------------------------------------------------------------------
-- MIGRATION 046: durable_job_queue_schema
-- ------------------------------------------------------------------------------

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

INSERT INTO _schema_migrations (version, name, applied_at)
VALUES ('046', 'durable_job_queue_schema', CURRENT_TIMESTAMP)
ON CONFLICT (version) DO NOTHING;

-- ------------------------------------------------------------------------------
-- MIGRATION 047: payment_links_and_holds_schema
-- ------------------------------------------------------------------------------

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

INSERT INTO _schema_migrations (version, name, applied_at)
VALUES ('047', 'payment_links_and_holds_schema', CURRENT_TIMESTAMP)
ON CONFLICT (version) DO NOTHING;

-- ------------------------------------------------------------------------------
-- MIGRATION 048: connectors_schema
-- ------------------------------------------------------------------------------

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

INSERT INTO _schema_migrations (version, name, applied_at)
VALUES ('048', 'connectors_schema', CURRENT_TIMESTAMP)
ON CONFLICT (version) DO NOTHING;

-- ------------------------------------------------------------------------------
-- MIGRATION 049: pgvector_schema
-- ------------------------------------------------------------------------------

-- Kriya Omnitask — Real Embeddings & pgvector Schema (WP-5.8, Blueprint §10, §11, ADR-021)
-- Supports pgvector extension and vector columns on PostgreSQL while maintaining full SQLite in-memory compatibility.

CREATE EXTENSION IF NOT EXISTS vector;

-- Add model and dimension metadata columns to knowledge_chunks
ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS embedding_model TEXT DEFAULT 'text-embedding-3-small';
ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS embedding_dimensions INTEGER DEFAULT 1536;

ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS embedding_vector vector(1536);
CREATE INDEX IF NOT EXISTS idx_kchunks_vector ON knowledge_chunks USING hnsw (embedding_vector vector_cosine_ops);

INSERT INTO _schema_migrations (version, name, applied_at)
VALUES ('049', 'pgvector_schema', CURRENT_TIMESTAMP)
ON CONFLICT (version) DO NOTHING;

-- ------------------------------------------------------------------------------
-- MIGRATION 050: reach_browser_schema
-- ------------------------------------------------------------------------------

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

INSERT INTO _schema_migrations (version, name, applied_at)
VALUES ('050', 'reach_browser_schema', CURRENT_TIMESTAMP)
ON CONFLICT (version) DO NOTHING;

-- ------------------------------------------------------------------------------
-- MIGRATION 051: outcome_kpi_instrumentation_schema
-- ------------------------------------------------------------------------------

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

INSERT INTO _schema_migrations (version, name, applied_at)
VALUES ('051', 'outcome_kpi_instrumentation_schema', CURRENT_TIMESTAMP)
ON CONFLICT (version) DO NOTHING;

-- ------------------------------------------------------------------------------
-- MIGRATION 052: evaluation_ci_gates_schema
-- ------------------------------------------------------------------------------

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

INSERT INTO _schema_migrations (version, name, applied_at)
VALUES ('052', 'evaluation_ci_gates_schema', CURRENT_TIMESTAMP)
ON CONFLICT (version) DO NOTHING;

-- ------------------------------------------------------------------------------
-- MIGRATION 053: error_budget_autonomy_throttling_schema
-- ------------------------------------------------------------------------------

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

INSERT INTO _schema_migrations (version, name, applied_at)
VALUES ('053', 'error_budget_autonomy_throttling_schema', CURRENT_TIMESTAMP)
ON CONFLICT (version) DO NOTHING;

-- ------------------------------------------------------------------------------
-- MIGRATION 054: dpdp_operations_schema
-- ------------------------------------------------------------------------------

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

INSERT INTO _schema_migrations (version, name, applied_at)
VALUES ('054', 'dpdp_operations_schema', CURRENT_TIMESTAMP)
ON CONFLICT (version) DO NOTHING;

-- ------------------------------------------------------------------------------
-- MIGRATION 055: observability_prometheus_and_slo_schema
-- ------------------------------------------------------------------------------

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

INSERT INTO _schema_migrations (version, name, applied_at)
VALUES ('055', 'observability_prometheus_and_slo_schema', CURRENT_TIMESTAMP)
ON CONFLICT (version) DO NOTHING;

-- ------------------------------------------------------------------------------
-- MIGRATION 056: reliability_drills_and_pitr_schema
-- ------------------------------------------------------------------------------

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

INSERT INTO _schema_migrations (version, name, applied_at)
VALUES ('056', 'reliability_drills_and_pitr_schema', CURRENT_TIMESTAMP)
ON CONFLICT (version) DO NOTHING;

-- ------------------------------------------------------------------------------
-- MIGRATION 057: release_canary_rollback_and_hosting_schema
-- ------------------------------------------------------------------------------

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

INSERT INTO _schema_migrations (version, name, applied_at)
VALUES ('057', 'release_canary_rollback_and_hosting_schema', CURRENT_TIMESTAMP)
ON CONFLICT (version) DO NOTHING;

-- ------------------------------------------------------------------------------
-- MIGRATION 058: launch_gate_reviews_schema
-- ------------------------------------------------------------------------------

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

INSERT INTO _schema_migrations (version, name, applied_at)
VALUES ('058', 'launch_gate_reviews_schema', CURRENT_TIMESTAMP)
ON CONFLICT (version) DO NOTHING;
