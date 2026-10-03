-- Migration 039: Kriya Proof — signed, hash-chained action receipts (docs/kriya WP-3.3, 02 §7)

-- Public halves of the platform signing keys, kept forever so old receipts stay verifiable offline.
CREATE TABLE IF NOT EXISTS proof_signing_keys (
  key_id TEXT PRIMARY KEY,
  algorithm TEXT NOT NULL DEFAULT 'ed25519',
  public_key_pem TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS proof_receipts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  run_id TEXT,
  node_id TEXT,
  action_type TEXT NOT NULL,
  risk_tier TEXT NOT NULL,
  body_json TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL,
  key_id TEXT NOT NULL,
  signature TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  UNIQUE (tenant_id, sequence),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (key_id) REFERENCES proof_signing_keys(key_id)
);

CREATE INDEX IF NOT EXISTS idx_proof_receipts_run ON proof_receipts(tenant_id, run_id);
