/**
 * Xylarc AI — Transactional Schema Migrator
 * Applies and tracks SQL DDL migrations with versioning and idempotency.
 */

import { DatabaseClient, SQLiteDatabaseClient, PostgresDatabaseClient, translateDdlForPostgres } from '../db.js';
import { logger } from '../../core/logger/logger.js';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface MigrationRecord {
  version: string;
  name: string;
  applied_at: string;
}

export class SchemaMigrator {
  private client: DatabaseClient;
  private migrationsDir: string;

  constructor(client: DatabaseClient, migrationsDir?: string) {
    this.client = client;
    this.migrationsDir = migrationsDir || __dirname;
  }

  public get isPostgres(): boolean {
    return this.client instanceof PostgresDatabaseClient || ('getPool' in (this.client as any));
  }

  public async initialize(): Promise<void> {
    const initSql = `
      CREATE TABLE IF NOT EXISTS _schema_migrations (
        version TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `;
    if ('execRaw' in this.client && typeof (this.client as any).execRaw === 'function') {
      await (this.client as any).execRaw(initSql);
    } else {
      await this.client.execute(initSql);
    }
  }

  public async getAppliedMigrations(): Promise<MigrationRecord[]> {
    await this.initialize();
    return this.client.query<MigrationRecord>(
      'SELECT version, name, applied_at FROM _schema_migrations ORDER BY version ASC;'
    );
  }

  public async applyMigrations(): Promise<string[]> {
    await this.initialize();
    const applied = await this.getAppliedMigrations();
    const appliedSet = new Set(applied.map((m) => m.version));

    let dir = this.migrationsDir;
    let sqlFiles = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.sql')) : [];

    if (sqlFiles.length === 0) {
      const candidates = [
        join(process.cwd(), 'src', 'storage', 'migrations'),
        join(process.cwd(), 'dist', 'storage', 'migrations'),
        join(__dirname, '..', '..', '..', 'src', 'storage', 'migrations'),
      ];
      for (const cand of candidates) {
        if (existsSync(cand)) {
          const found = readdirSync(cand).filter((f) => f.endsWith('.sql'));
          if (found.length > 0) {
            dir = cand;
            sqlFiles = found;
            break;
          }
        }
      }
    }

    const files = sqlFiles.sort();

    const executed: string[] = [];
    const isPg = this.client instanceof PostgresDatabaseClient || ('getPool' in this.client);

    for (const file of files) {
      const match = file.match(/^(\d+)_(.+)\.sql$/);
      if (!match) continue;

      const version = match[1];
      const name = match[2];

      if (!appliedSet.has(version)) {
        logger.info(`Applying migration ${version}: ${name}`);
        const sqlPath = join(dir, file);
        const rawSql = readFileSync(sqlPath, 'utf8');
        const sql = isPg ? translateDdlForPostgres(rawSql) : rawSql;

        await this.client.transaction(async (tx) => {
          if ('execRaw' in tx && typeof (tx as any).execRaw === 'function') {
            await (tx as any).execRaw(sql);
          } else {
            const statements = sql.split(';').map((s) => s.trim()).filter((s) => s.length > 0);
            for (const statement of statements) {
              await tx.execute(statement);
            }
          }

          await tx.execute(
            'INSERT INTO _schema_migrations (version, name, applied_at) VALUES (?, ?, ?);',
            [version, name, new Date().toISOString()]
          );
        });

        executed.push(file);
        logger.info(`Successfully applied migration ${version}: ${name}`);
      }
    }

    return executed;
  }
}
