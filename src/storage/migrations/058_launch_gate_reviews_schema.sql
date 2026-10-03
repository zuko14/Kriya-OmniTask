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
