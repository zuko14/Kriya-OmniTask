-- ============================================================================
-- Migration 035: Real-Time Data Layer Stream Schema (§19 of CLAUDE1.md)
-- Monotonic Event Ledger for Live Workforce Activity & SSE Streaming
-- ============================================================================

CREATE TABLE IF NOT EXISTS realtime_event_stream (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
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
