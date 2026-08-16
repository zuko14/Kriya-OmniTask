/**
 * Xylarc AI — Unified Database Driver & Connection Abstraction
 * Supports SQLite (via native node:sqlite for embedded/test environments)
 * and PostgreSQL adapter interface for enterprise production deployments.
 */

import { DatabaseSync } from 'node:sqlite';
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
}

export class SQLiteDatabaseClient implements DatabaseClient {
  private db: DatabaseSync;

  constructor(location = ':memory:') {
    try {
      this.db = new DatabaseSync(location);
      // Enable WAL mode and foreign keys for SQLite
      if (location !== ':memory:') {
        this.db.exec('PRAGMA journal_mode = WAL;');
      }
      this.db.exec('PRAGMA foreign_keys = ON;');
    } catch (err) {
      logger.error('Failed to initialize SQLite database', err, { location });
      throw new DatabaseError('Failed to initialize SQLite database', { error: String(err) });
    }
  }

  public async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    try {
      const sanitizedParams = params.map((p) => (p === undefined ? null : p));
      const stmt = this.db.prepare(sql);
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

  public async execute(sql: string, params: unknown[] = []): Promise<QueryResult> {
    try {
      const sanitizedParams = params.map((p) => (p === undefined ? null : p));
      const stmt = this.db.prepare(sql);
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

  public async execRaw(sql: string): Promise<void> {
    try {
      this.db.exec(sql);
    } catch (err) {
      logger.error('Database raw exec error', err, { sql });
      throw new DatabaseError(`Raw script execution failed: ${err instanceof Error ? err.message : String(err)}`, { sql });
    }
  }

  public async transaction<T>(fn: (client: DatabaseClient) => Promise<T>): Promise<T> {
    this.db.exec('BEGIN TRANSACTION;');
    try {
      const result = await fn(this);
      this.db.exec('COMMIT;');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK;');
      throw err;
    }
  }

  public async close(): Promise<void> {
    try {
      this.db.close();
    } catch (err) {
      logger.error('Error closing database connection', err);
    }
  }
}

class DatabaseManager {
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
      } else {
        // Fallback or future Postgres adapter
        this.client = new SQLiteDatabaseClient(':memory:');
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
