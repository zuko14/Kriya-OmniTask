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
