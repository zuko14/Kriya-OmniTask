
-- Migration 002: customer360_schema
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

INSERT INTO _schema_migrations (version, name, applied_at) VALUES ('002', 'customer360_schema', CURRENT_TIMESTAMP) ON CONFLICT (version) DO NOTHING;

-- Migration 003: communication_gateway_schema
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

INSERT INTO _schema_migrations (version, name, applied_at) VALUES ('003', 'communication_gateway_schema', CURRENT_TIMESTAMP) ON CONFLICT (version) DO NOTHING;

-- Migration 004: agent_registry_schema
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

INSERT INTO _schema_migrations (version, name, applied_at) VALUES ('004', 'agent_registry_schema', CURRENT_TIMESTAMP) ON CONFLICT (version) DO NOTHING;

-- Migration 005: tool_gateway_schema
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

INSERT INTO _schema_migrations (version, name, applied_at) VALUES ('005', 'tool_gateway_schema', CURRENT_TIMESTAMP) ON CONFLICT (version) DO NOTHING;

-- Migration 006: policy_engine_schema
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

INSERT INTO _schema_migrations (version, name, applied_at) VALUES ('006', 'policy_engine_schema', CURRENT_TIMESTAMP) ON CONFLICT (version) DO NOTHING;

-- Migration 007: workflow_dag_schema
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

INSERT INTO _schema_migrations (version, name, applied_at) VALUES ('007', 'workflow_dag_schema', CURRENT_TIMESTAMP) ON CONFLICT (version) DO NOTHING;

-- Migration 008: knowledge_fabric_schema
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

INSERT INTO _schema_migrations (version, name, applied_at) VALUES ('008', 'knowledge_fabric_schema', CURRENT_TIMESTAMP) ON CONFLICT (version) DO NOTHING;

-- Migration 009: digital_twin_schema
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

INSERT INTO _schema_migrations (version, name, applied_at) VALUES ('009', 'digital_twin_schema', CURRENT_TIMESTAMP) ON CONFLICT (version) DO NOTHING;

-- Migration 010: business_intelligence_schema
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

INSERT INTO _schema_migrations (version, name, applied_at) VALUES ('010', 'business_intelligence_schema', CURRENT_TIMESTAMP) ON CONFLICT (version) DO NOTHING;

-- Migration 011: observability_schema
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

INSERT INTO _schema_migrations (version, name, applied_at) VALUES ('011', 'observability_schema', CURRENT_TIMESTAMP) ON CONFLICT (version) DO NOTHING;

-- Migration 012: verification_quality_schema
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

INSERT INTO _schema_migrations (version, name, applied_at) VALUES ('012', 'verification_quality_schema', CURRENT_TIMESTAMP) ON CONFLICT (version) DO NOTHING;

-- Migration 013: human_attention_schema
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

INSERT INTO _schema_migrations (version, name, applied_at) VALUES ('013', 'human_attention_schema', CURRENT_TIMESTAMP) ON CONFLICT (version) DO NOTHING;

-- Migration 014: simulation_sandbox_schema
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

INSERT INTO _schema_migrations (version, name, applied_at) VALUES ('014', 'simulation_sandbox_schema', CURRENT_TIMESTAMP) ON CONFLICT (version) DO NOTHING;

-- Migration 015: evaluation_benchmark_schema
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

INSERT INTO _schema_migrations (version, name, applied_at) VALUES ('015', 'evaluation_benchmark_schema', CURRENT_TIMESTAMP) ON CONFLICT (version) DO NOTHING;
