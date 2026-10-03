/**
 * Kriya AI — Unified Database Driver & Connection Abstraction
 * Supports SQLite (via native node:sqlite for embedded/test environments)
 * and PostgreSQL adapter with connection pooling, statement timeouts,
 * transaction savepoints, and row locking for enterprise production deployments (§WP-5.1).
 */

import { DatabaseSync } from 'node:sqlite';
import { AsyncLocalStorage } from 'node:async_hooks';
import pg from 'pg';
const { Pool } = pg;
import { config } from '../core/config/config.js';
import { logger } from '../core/logger/logger.js';
import { AppError } from '../core/errors/errors.js';

export class DatabaseError extends AppError {
  public readonly code = 'DATABASE_ERROR';
  public readonly statusCode = 500;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details, true);
  }
}

export interface QueryResult {
  changes: number;
  lastInsertRowid?: number | bigint;
}

export interface DatabaseClient {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  queryOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>;
  execute(sql: string, params?: unknown[]): Promise<QueryResult>;
  transaction<T>(fn: (client: DatabaseClient) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  execRaw?(sql: string): Promise<void>;
  ping?(): Promise<boolean>;
  readonly driver?: 'postgres' | 'sqlite';
}

/**
 * Checks whether a database client is connected to PostgreSQL.
 */
export function isPostgres(client: DatabaseClient): boolean {
  return client.driver === 'postgres' || client instanceof PostgresDatabaseClient || ('getPool' in (client as any));
}

/**
 * Translates unquoted '?' query parameter placeholders to PostgreSQL '$1, $2, ...'.
 * Accurately skips literal '?' characters inside single quotes ('...'), double quotes ("..."),
 * and escaped quotes ('' or \').
 */
export function toPostgresSql(sql: string): string {
  let paramIndex = 1;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let result = '';

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];

    if (ch === "'" && !inDoubleQuote) {
      if (inSingleQuote && i + 1 < sql.length && sql[i + 1] === "'") {
        result += "''";
        i++;
        continue;
      }
      inSingleQuote = !inSingleQuote;
      result += ch;
    } else if (ch === '"' && !inSingleQuote) {
      if (inDoubleQuote && i + 1 < sql.length && sql[i + 1] === '"') {
        result += '""';
        i++;
        continue;
      }
      inDoubleQuote = !inDoubleQuote;
      result += ch;
    } else if (ch === '?' && !inSingleQuote && !inDoubleQuote) {
      result += `$${paramIndex++}`;
    } else {
      result += ch;
    }
  }

  return result;
}

/**
 * Translates SQLite DDL syntax into PostgreSQL dialect during migrations.
 * Also activates PostgreSQL-specific DDL lines prefixed with '-- PG:' or '-- POSTGRES:'.
 */
export function translateDdlForPostgres(sql: string): string {
  let translated = sql
    .replace(/\bINTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT\b/gi, 'SERIAL PRIMARY KEY')
    .replace(/\bdatetime\s*\(\s*['"]now['"]\s*\)/gi, 'CURRENT_TIMESTAMP');

  // Uncomment lines prefixed with -- PG: or -- POSTGRES: for PostgreSQL execution
  translated = translated.replace(/^[ \t]*--\s*(?:PG|POSTGRES):\s*(.+)$/gim, '$1');
  return translated;
}

/**
 * One SQLite connection shared by callers. Statements and transactions are serialised;
 * code running inside a transaction (tracked per async context) goes straight through,
 * and a nested transaction becomes a SAVEPOINT.
 * Strips 'FOR UPDATE' row-lock directives so queries written with row locks execute in SQLite without syntax error.
 */
export class SQLiteDatabaseClient implements DatabaseClient {
  public readonly driver = 'sqlite' as const;
  private db: DatabaseSync;
  private lock: Promise<void> = Promise.resolve();
  private readonly txDepth = new AsyncLocalStorage<number>();
  private savepointSeq = 0;

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    if (this.txDepth.getStore()) return fn();
    const prev = this.lock;
    let release!: () => void;
    this.lock = new Promise<void>((r) => (release = r));
    return prev.then(fn).finally(release);
  }

  constructor(location = ':memory:') {
    try {
      this.db = new DatabaseSync(location);
      if (location !== ':memory:') {
        this.db.exec('PRAGMA journal_mode = WAL;');
      }
      this.db.exec('PRAGMA foreign_keys = ON;');
    } catch (err) {
      logger.error('Failed to initialize SQLite database', err, { location });
      throw new DatabaseError('Failed to initialize SQLite database', { error: String(err) });
    }
  }

  private sanitizeSql(sql: string): string {
    return sql.replace(/\s+FOR\s+UPDATE(\s+OF\s+[\w,\s]+)?(\s+NOWAIT|\s+SKIP\s+LOCKED)?/gi, '');
  }

  public query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.exclusive(async () => this.querySync<T>(sql, params));
  }

  private querySync<T>(sql: string, params: unknown[]): T[] {
    try {
      const sanitizedSql = this.sanitizeSql(sql);
      const sanitizedParams = params.map((p) => (p === undefined ? null : p));
      const stmt = this.db.prepare(sanitizedSql);
      const rows = stmt.all(...(sanitizedParams as any[]));
      return rows as T[];
    } catch (err) {
      logger.error('Database query execution error', err, { sql, params });
      throw new DatabaseError(`Query execution failed: ${err instanceof Error ? err.message : String(err)}`, { sql });
    }
  }

  public async queryOne<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows.length > 0 ? rows[0] : null;
  }

  public execute(sql: string, params: unknown[] = []): Promise<QueryResult> {
    return this.exclusive(async () => this.executeSync(sql, params));
  }

  private executeSync(sql: string, params: unknown[]): QueryResult {
    try {
      const sanitizedSql = this.sanitizeSql(sql);
      const sanitizedParams = params.map((p) => (p === undefined ? null : p));
      const stmt = this.db.prepare(sanitizedSql);
      const result = stmt.run(...(sanitizedParams as any[]));
      return {
        changes: Number(result.changes),
        lastInsertRowid: result.lastInsertRowid !== undefined ? Number(result.lastInsertRowid) : undefined,
      };
    } catch (err) {
      logger.error('Database statement execution error', err, { sql, params });
      throw new DatabaseError(`Statement execution failed: ${err instanceof Error ? err.message : String(err)}`, { sql });
    }
  }

  public execRaw(sql: string): Promise<void> {
    return this.exclusive(async () => {
      try {
        this.db.exec(sql);
      } catch (err) {
        logger.error('Database raw exec error', err, { sql });
        throw new DatabaseError(`Raw script execution failed: ${err instanceof Error ? err.message : String(err)}`, { sql });
      }
    });
  }

  public transaction<T>(fn: (client: DatabaseClient) => Promise<T>): Promise<T> {
    const depth = this.txDepth.getStore() ?? 0;
    if (depth > 0) {
      const sp = `sp_${++this.savepointSeq}`;
      this.db.exec(`SAVEPOINT ${sp};`);
      return this.txDepth.run(depth + 1, () => fn(this)).then(
        (result) => (this.db.exec(`RELEASE ${sp};`), result),
        (err) => {
          this.db.exec(`ROLLBACK TO ${sp}; RELEASE ${sp};`);
          throw err;
        }
      );
    }
    return this.exclusive(async () => {
      this.db.exec('BEGIN TRANSACTION;');
      try {
        const result = await this.txDepth.run(1, () => fn(this));
        this.db.exec('COMMIT;');
        return result;
      } catch (err) {
        this.db.exec('ROLLBACK;');
        throw err;
      }
    });
  }

  public async close(): Promise<void> {
    try {
      this.db.close();
    } catch (err) {
      logger.error('Error closing database connection', err);
    }
  }

  public async ping(): Promise<boolean> {
    try {
      const rows = this.querySync<{ ping: number }>('SELECT 1 as ping;', []);
      return rows.length > 0 && rows[0].ping === 1;
    } catch {
      return false;
    }
  }
}

// ============================================================================
// PostgreSQL Client Implementation (WP-5.1)
// ============================================================================

export interface PostgresClientOptions {
  connectionString?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  ssl?: boolean | { rejectUnauthorized?: boolean };
  minPoolSize?: number;
  maxPoolSize?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
  statementTimeoutMillis?: number;
  pool?: pg.Pool;
}

export class PostgresTransactionClient implements DatabaseClient {
  public readonly driver = 'postgres' as const;
  constructor(
    private readonly client: pg.PoolClient,
    private depth: number = 1
  ) {}

  public async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    try {
      const pgSql = toPostgresSql(sql);
      const sanitized = params.map((p) => (p === undefined ? null : p));
      const res = await this.client.query(pgSql, sanitized);
      return res.rows as T[];
    } catch (err) {
      logger.error('Postgres transaction query error', err, { sql, params });
      throw new DatabaseError(`Query execution failed: ${err instanceof Error ? err.message : String(err)}`, { sql });
    }
  }

  public async queryOne<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows.length > 0 ? rows[0] : null;
  }

  public async execute(sql: string, params: unknown[] = []): Promise<QueryResult> {
    try {
      const pgSql = toPostgresSql(sql);
      const sanitized = params.map((p) => (p === undefined ? null : p));
      const res = await this.client.query(pgSql, sanitized);
      return {
        changes: res.rowCount ?? 0,
      };
    } catch (err) {
      logger.error('Postgres transaction statement error', err, { sql, params });
      throw new DatabaseError(`Statement execution failed: ${err instanceof Error ? err.message : String(err)}`, { sql });
    }
  }

  public async execRaw(sql: string): Promise<void> {
    try {
      await this.client.query(sql);
    } catch (err) {
      logger.error('Postgres transaction raw exec error', err, { sql });
      throw new DatabaseError(`Raw script execution failed: ${err instanceof Error ? err.message : String(err)}`, { sql });
    }
  }

  public async transaction<T>(fn: (client: DatabaseClient) => Promise<T>): Promise<T> {
    const sp = `sp_${this.depth++}`;
    await this.client.query(`SAVEPOINT ${sp};`);
    try {
      const result = await fn(this);
      await this.client.query(`RELEASE SAVEPOINT ${sp};`);
      return result;
    } catch (err) {
      await this.client.query(`ROLLBACK TO SAVEPOINT ${sp}; RELEASE SAVEPOINT ${sp};`);
      throw err;
    } finally {
      this.depth--;
    }
  }

  public async close(): Promise<void> {
    // Transaction client lifecycle is managed by parent transaction() block
  }

  public async ping(): Promise<boolean> {
    try {
      const res = await this.client.query('SELECT 1 as ping;');
      return res.rows.length === 1;
    } catch {
      return false;
    }
  }
}

export class PostgresDatabaseClient implements DatabaseClient {
  public readonly driver = 'postgres' as const;
  private pool: pg.Pool;
  private readonly txContext = new AsyncLocalStorage<DatabaseClient>();

  constructor(options: string | PostgresClientOptions = {}) {
    if (typeof options === 'string') {
      this.pool = new Pool({
        connectionString: options,
        max: config.get('DB_POOL_MAX') ?? 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
        statement_timeout: 30000,
      });
    } else if (options.pool) {
      this.pool = options.pool;
    } else {
      this.pool = new Pool({
        connectionString: options.connectionString,
        host: options.host,
        port: options.port,
        user: options.user,
        password: options.password,
        database: options.database,
        ssl: options.ssl,
        min: options.minPoolSize ?? config.get('DB_POOL_MIN') ?? 2,
        max: options.maxPoolSize ?? config.get('DB_POOL_MAX') ?? 10,
        idleTimeoutMillis: options.idleTimeoutMillis ?? 30000,
        connectionTimeoutMillis: options.connectionTimeoutMillis ?? 5000,
        statement_timeout: options.statementTimeoutMillis ?? 30000,
      });
    }

    this.pool.on('error', (err) => {
      logger.error('Unexpected error on idle PostgreSQL client pool', err);
    });
  }

  public getPool(): pg.Pool {
    return this.pool;
  }

  public async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const active = this.txContext.getStore();
    if (active) return active.query<T>(sql, params);

    try {
      const pgSql = toPostgresSql(sql);
      const sanitized = params.map((p) => (p === undefined ? null : p));
      const res = await this.pool.query(pgSql, sanitized);
      return res.rows as T[];
    } catch (err) {
      logger.error('Database query execution error (Postgres)', err, { sql, params });
      throw new DatabaseError(`Query execution failed: ${err instanceof Error ? err.message : String(err)}`, { sql });
    }
  }

  public async queryOne<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows.length > 0 ? rows[0] : null;
  }

  public async execute(sql: string, params: unknown[] = []): Promise<QueryResult> {
    const active = this.txContext.getStore();
    if (active) return active.execute(sql, params);

    try {
      const pgSql = toPostgresSql(sql);
      const sanitized = params.map((p) => (p === undefined ? null : p));
      const res = await this.pool.query(pgSql, sanitized);
      return {
        changes: res.rowCount ?? 0,
      };
    } catch (err) {
      logger.error('Database statement execution error (Postgres)', err, { sql, params });
      throw new DatabaseError(`Statement execution failed: ${err instanceof Error ? err.message : String(err)}`, { sql });
    }
  }

  public async execRaw(sql: string): Promise<void> {
    const active = this.txContext.getStore();
    if (active && 'execRaw' in active && typeof (active as any).execRaw === 'function') {
      return (active as any).execRaw(sql);
    }

    try {
      await this.pool.query(sql);
    } catch (err) {
      logger.error('Database raw script error (Postgres)', err, { sql });
      throw new DatabaseError(`Raw script execution failed: ${err instanceof Error ? err.message : String(err)}`, { sql });
    }
  }

  public async transaction<T>(fn: (client: DatabaseClient) => Promise<T>): Promise<T> {
    const active = this.txContext.getStore();
    if (active) {
      return active.transaction(fn);
    }

    const poolClient = await this.pool.connect();
    let released = false;
    const releaseOnce = () => {
      if (!released) {
        released = true;
        poolClient.release();
      }
    };

    const txClient = new PostgresTransactionClient(poolClient, 1);
    try {
      await poolClient.query('BEGIN;');
      const result = await this.txContext.run(txClient, () => fn(txClient));
      await poolClient.query('COMMIT;');
      return result;
    } catch (err) {
      try {
        await poolClient.query('ROLLBACK;');
      } catch (rbErr) {
        logger.error('Error during transaction rollback (Postgres)', rbErr);
      }
      throw err;
    } finally {
      releaseOnce();
    }
  }

  public async close(): Promise<void> {
    try {
      await this.pool.end();
    } catch (err) {
      logger.error('Error closing Postgres pool', err);
    }
  }

  public async ping(): Promise<boolean> {
    try {
      const res = await this.pool.query('SELECT 1 as ping;');
      return res.rows.length === 1;
    } catch {
      return false;
    }
  }
}

// ============================================================================
// Database Singleton Manager
// ============================================================================

export class DatabaseManager {
  private static instance: DatabaseManager;
  private client: DatabaseClient | null = null;

  public static getInstance(): DatabaseManager {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new DatabaseManager();
    }
    return DatabaseManager.instance;
  }

  public getClient(): DatabaseClient {
    if (!this.client) {
      const driver = config.get('DB_DRIVER');
      const url = config.get('DATABASE_URL');
      if (driver === 'sqlite') {
        this.client = new SQLiteDatabaseClient(url);
      } else if (driver === 'postgres') {
        if (!url || url === ':memory:') {
          throw new DatabaseError(
            'Refusing to fall back to in-memory SQLite when DB_DRIVER=postgres. Configure a valid PostgreSQL DATABASE_URL.',
            { driver, url }
          );
        }
        const poolMin = config.get('DB_POOL_MIN');
        const poolMax = config.get('DB_POOL_MAX');
        const sslMode = config.get('PGSSLMODE');
        this.client = new PostgresDatabaseClient({
          connectionString: url,
          minPoolSize: poolMin,
          maxPoolSize: poolMax,
          ssl: sslMode && sslMode !== 'disable' ? { rejectUnauthorized: sslMode === 'verify-full' } : undefined,
        });
      } else {
        throw new DatabaseError(
          `DB_DRIVER='${driver}' is unsupported. Expected 'sqlite' or 'postgres'.`,
          { driver }
        );
      }
    }
    return this.client;
  }

  public setClientForTesting(client: DatabaseClient): void {
    this.client = client;
  }

  public async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
  }
}

export const db = DatabaseManager.getInstance();
