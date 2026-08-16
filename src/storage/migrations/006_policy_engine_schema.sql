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
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
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
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_policy_evaluations_tenant_result
ON policy_evaluations(tenant_id, evaluation_result, created_at);
