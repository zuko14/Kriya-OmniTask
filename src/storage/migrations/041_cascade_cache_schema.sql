-- Migration 041: L1 cascade cache (docs/kriya WP-2.4, 02 §5.1)
-- Accepted model answers per tenant, keyed by a hash of (schema, knowledge version, normalised input, context).
-- Survives restarts and is shared by every instance on the same database. Expired rows are pruned on write.

CREATE TABLE IF NOT EXISTS cascade_cache (
  tenant_id TEXT NOT NULL,
  cache_key TEXT NOT NULL,
  schema_name TEXT NOT NULL,
  value_json TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, cache_key),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_cascade_cache_expiry ON cascade_cache(tenant_id, expires_at);
