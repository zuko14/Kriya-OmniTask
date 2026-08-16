-- Migration 016: Multilingual System (Indic & Global Languages) Schema
-- Tracks customer language profiles, code-switching preferences, and translation caches (§14, §19 of CLAUDE.md)

CREATE TABLE IF NOT EXISTS language_profiles (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  organization_id TEXT NOT NULL DEFAULT 'default',
  customer_id TEXT NOT NULL,
  primary_language TEXT NOT NULL,
  detected_languages_json TEXT NOT NULL DEFAULT '[]',
  preferred_script TEXT NOT NULL DEFAULT 'Latin',
  is_code_switched INTEGER NOT NULL DEFAULT 0,
  confidence_score REAL NOT NULL DEFAULT 1.0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lang_profiles_tenant_customer ON language_profiles(tenant_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_lang_profiles_tenant_lang ON language_profiles(tenant_id, primary_language);

CREATE TABLE IF NOT EXISTS multilingual_translations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  organization_id TEXT NOT NULL DEFAULT 'default',
  source_text TEXT NOT NULL,
  source_language TEXT NOT NULL,
  target_language TEXT NOT NULL,
  translated_text TEXT NOT NULL,
  quality_score REAL NOT NULL DEFAULT 1.0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_translations_lookup ON multilingual_translations(tenant_id, source_language, target_language);
