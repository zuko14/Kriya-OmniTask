import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteDatabaseClient } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';

describe('Schema Migrations Integration', () => {
  let client: SQLiteDatabaseClient;

  beforeEach(() => {
    client = new SQLiteDatabaseClient(':memory:');
  });

  afterEach(async () => {
    await client.close();
  });

  it('should initialize _schema_migrations and apply migration files idempotently', async () => {
    const migrator = new SchemaMigrator(client);
    
    // First run
    const applied1 = await migrator.applyMigrations();
    expect(applied1.length).toBeGreaterThan(0);
    expect(applied1).toContain('001_initial_schema.sql');

    // Verify tables exist
    const tables = await client.query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';"
    );
    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain('tenants');
    expect(tableNames).toContain('organizations');
    expect(tableNames).toContain('workspaces');
    expect(tableNames).toContain('users');
    expect(tableNames).toContain('roles');
    expect(tableNames).toContain('audit_logs');
    expect(tableNames).toContain('_schema_migrations');

    // Second run should apply 0 migrations (idempotent)
    const applied2 = await migrator.applyMigrations();
    expect(applied2.length).toBe(0);
  });
});
