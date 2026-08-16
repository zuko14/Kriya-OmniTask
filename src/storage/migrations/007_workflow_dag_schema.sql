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
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
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
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
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
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (execution_id) REFERENCES workflow_executions(id) ON DELETE CASCADE,
    UNIQUE(tenant_id, execution_id, step_id)
);

CREATE INDEX IF NOT EXISTS idx_workflow_approvals_tenant_status 
ON workflow_approval_requests(tenant_id, status, created_at);
