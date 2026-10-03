import fs from 'node:fs';
import path from 'node:path';

function translateDdlForPostgres(sql) {
  let translated = sql
    .replace(/\bINTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT\b/gi, 'SERIAL PRIMARY KEY')
    .replace(/\bdatetime\s*\(\s*['"]now['"]\s*\)/gi, 'CURRENT_TIMESTAMP')
    .replace(/\bBOOLEAN\s+NOT\s+NULL\s+DEFAULT\s+0\b/gi, 'BOOLEAN NOT NULL DEFAULT false')
    .replace(/\bBOOLEAN\s+NOT\s+NULL\s+DEFAULT\s+1\b/gi, 'BOOLEAN NOT NULL DEFAULT true')
    .replace(/\bBOOLEAN\s+DEFAULT\s+0\b/gi, 'BOOLEAN DEFAULT false')
    .replace(/\bBOOLEAN\s+DEFAULT\s+1\b/gi, 'BOOLEAN DEFAULT true')
    .replace(/\bALTER\s+TABLE\s+([a-zA-Z0-9_]+)\s+ADD\s+COLUMN\s+(?!IF\s+NOT\s+EXISTS\b)/gi, 'ALTER TABLE $1 ADD COLUMN IF NOT EXISTS ')
    .replace(/\bINSERT\s+OR\s+REPLACE\s+INTO\s+/gi, 'INSERT INTO ')
    .replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\s+/gi, 'INSERT INTO ');

  translated = translated.replace(
    /(INSERT\s+INTO\s+dna_profiles\s*\([^)]+\)\s*VALUES\s*\([\s\S]+?\))\s*;/gi,
    (match, p1) => match.includes('ON CONFLICT') ? match : `${p1} ON CONFLICT (id) DO NOTHING;`
  );
  translated = translated.replace(
    /(INSERT\s+INTO\s+brain_catalogue\s*\([^)]+\)\s*VALUES\s*[\s\S]+?\))\s*;/gi,
    (match, p1) => match.includes('ON CONFLICT') ? match : `${p1} ON CONFLICT (id) DO NOTHING;`
  );
  translated = translated.replace(
    /(INSERT\s+INTO\s+roles\s*\([^)]+\)\s*VALUES\s*[\s\S]+?\))\s*;/gi,
    (match, p1) => match.includes('ON CONFLICT') ? match : `${p1} ON CONFLICT (id) DO NOTHING;`
  );

  // Uncomment lines prefixed with -- PG: or -- POSTGRES:
  translated = translated.replace(/^[ \t]*--\s*(?:PG|POSTGRES):\s*(.+)$/gim, '$1');
  return translated;
}

const rootDir = process.cwd();
const migrationsDir = path.join(rootDir, 'src', 'storage', 'migrations');
const supabaseDir = path.join(rootDir, 'supabase');
const supabaseMigrationsDir = path.join(supabaseDir, 'migrations');

if (!fs.existsSync(supabaseMigrationsDir)) {
  fs.mkdirSync(supabaseMigrationsDir, { recursive: true });
}

const files = fs.readdirSync(migrationsDir)
  .filter(f => f.match(/^\d+_.+\.sql$/))
  .sort();

console.log(`Processing ${files.length} migrations for Supabase PostgreSQL...`);

let combinedSql = `-- ==============================================================================
-- KRIYA AI — AUTONOMOUS OPERATIONS RUNTIME (SUPABASE PRODUCTION SCHEMA)
-- Generated on: 2026-10-03
-- Project Ref: dfmdyewhtaolqkjrmdjz
-- Contains all 58 production migrations with pgvector, pgcrypto & uuid-ossp.
-- ==============================================================================

-- 1. Enable Core PostgreSQL Extensions in Supabase
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

-- 2. Schema Migrations Ledger
CREATE TABLE IF NOT EXISTS _schema_migrations (
  version TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

`;

for (const file of files) {
  const match = file.match(/^(\d+)_(.+)\.sql$/);
  if (!match) continue;
  const [_, version, name] = match;

  const rawSql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
  const pgSql = translateDdlForPostgres(rawSql);

  combinedSql += `\n-- ------------------------------------------------------------------------------\n`;
  combinedSql += `-- MIGRATION ${version}: ${name}\n`;
  combinedSql += `-- ------------------------------------------------------------------------------\n\n`;
  combinedSql += pgSql.trim();
  combinedSql += `\n\nINSERT INTO _schema_migrations (version, name, applied_at)
VALUES ('${version}', '${name}', CURRENT_TIMESTAMP)
ON CONFLICT (version) DO NOTHING;\n`;
}

// 1. Write the consolidated migration for Supabase CLI
const migrationFile = path.join(supabaseMigrationsDir, '20261003000000_kriya_full_production_schema.sql');
fs.writeFileSync(migrationFile, combinedSql, 'utf8');
console.log(`✅ Generated Supabase CLI migration: ${migrationFile}`);

// 2. Write full_production_schema.sql for Supabase Dashboard SQL Editor
const fullSchemaFile = path.join(supabaseDir, 'full_production_schema.sql');
fs.writeFileSync(fullSchemaFile, combinedSql, 'utf8');
console.log(`✅ Generated SQL Editor script: ${fullSchemaFile}`);

// 3. Write supabase/config.toml
const configToml = `project_id = "dfmdyewhtaolqkjrmdjz"

[api]
enabled = true
port = 54321
schemas = ["public", "storage", "graphql_public"]
extra_search_path = ["public", "extensions"]
max_rows = 1000

[db]
port = 54322
major_version = 15

[storage]
enabled = true
file_size_limit = "50MiB"
`;

fs.writeFileSync(path.join(supabaseDir, 'config.toml'), configToml, 'utf8');
console.log(`✅ Generated Supabase CLI config: supabase/config.toml`);
