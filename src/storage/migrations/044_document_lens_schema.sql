-- Migration 044: Document (Lens) Schema (docs/kriya WP-4.5)
-- Zero-retention document extraction metadata, structured fields, and verification hashes.

CREATE TABLE IF NOT EXISTS parsed_documents (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  run_id TEXT,
  document_type TEXT NOT NULL,
  sha256_hash TEXT NOT NULL,
  extraction_method TEXT NOT NULL CHECK (extraction_method IN ('L0_deterministic', 'L2_fast_model', 'L3_reasoning_model')),
  confidence REAL NOT NULL DEFAULT 1.0,
  is_valid INTEGER NOT NULL DEFAULT 1,
  structured_data_json TEXT NOT NULL,
  validation_errors_json TEXT,
  status TEXT NOT NULL CHECK (status IN ('verified', 'low_confidence', 'unsupported_template', 'failed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_parsed_docs_tenant_hash ON parsed_documents(tenant_id, sha256_hash);
CREATE INDEX IF NOT EXISTS idx_parsed_docs_tenant_corr ON parsed_documents(tenant_id, correlation_id);
CREATE INDEX IF NOT EXISTS idx_parsed_docs_tenant_status ON parsed_documents(tenant_id, status);
