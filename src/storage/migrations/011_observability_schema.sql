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
    drift_detected BOOLEAN NOT NULL DEFAULT 0,
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
