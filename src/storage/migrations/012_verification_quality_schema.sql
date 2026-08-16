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
