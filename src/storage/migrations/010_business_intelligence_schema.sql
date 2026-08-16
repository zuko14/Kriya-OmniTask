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
