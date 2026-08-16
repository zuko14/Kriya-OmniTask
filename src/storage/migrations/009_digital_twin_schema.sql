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
