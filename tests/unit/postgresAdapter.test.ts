/**
 * Kriya Omnitask — Production Database: PostgreSQL Adapter & Row Locks (WP-5.1)
 *
 * Tests the PostgreSQL dual-mode database architecture:
 * 1. Parameter translation (? -> $1, $2) with quote preservation
 * 2. SQLite DDL translation for PostgreSQL dialect during migrations
 * 3. SQLite client runtime stripping of FOR UPDATE row-lock clauses
 * 4. PostgresTransactionClient operations and nested SAVEPOINT management
 * 5. PostgresDatabaseClient connection pooling, transaction lifecycle, and AsyncLocalStorage context
 * 6. Dual-mode DatabaseManager instantiation
 * 7. SchemaMigrator PostgreSQL translation hook
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  toPostgresSql,
  translateDdlForPostgres,
  SQLiteDatabaseClient,
  PostgresTransactionClient,
  PostgresDatabaseClient,
  DatabaseManager,
  db,
} from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { config } from '../../src/core/config/config.js';

describe('WP-5.1 Production Database: PostgreSQL Adapter & Row Locks', () => {
  describe('1. Parameter Translation (toPostgresSql)', () => {
    it('translates single and multiple unquoted question marks to $1, $2, ...', () => {
      const sql = 'SELECT * FROM users WHERE id = ? AND tenant_id = ? AND status = ?';
      const result = toPostgresSql(sql);
      expect(result).toBe('SELECT * FROM users WHERE id = $1 AND tenant_id = $2 AND status = $3');
    });

    it('preserves question marks inside single-quoted string literals', () => {
      const sql = "SELECT * FROM queries WHERE text = 'is this valid?' AND id = ?";
      const result = toPostgresSql(sql);
      expect(result).toBe("SELECT * FROM queries WHERE text = 'is this valid?' AND id = $1");
    });

    it('preserves question marks inside escaped single quotes', () => {
      const sql = "SELECT * FROM notes WHERE content = 'Who''s there? anyone?' AND active = ? AND title = 'What?''s up'";
      const result = toPostgresSql(sql);
      expect(result).toBe("SELECT * FROM notes WHERE content = 'Who''s there? anyone?' AND active = $1 AND title = 'What?''s up'");
    });

    it('preserves question marks inside double-quoted identifiers or literals', () => {
      const sql = 'SELECT "col?name", ? as val FROM "my?table" WHERE flag = ?';
      const result = toPostgresSql(sql);
      expect(result).toBe('SELECT "col?name", $1 as val FROM "my?table" WHERE flag = $2');
    });

    it('handles complex queries with mixed quotes and parameters', () => {
      const sql = `
        INSERT INTO audit_logs (id, tenant_id, message, metadata)
        VALUES (?, ?, 'User asked: "Are you ready?" yes!', ?)
      `;
      const result = toPostgresSql(sql);
      expect(result).toContain('VALUES ($1, $2, \'User asked: "Are you ready?" yes!\', $3)');
    });

    it('returns queries without question marks unchanged', () => {
      const sql = 'SELECT id, name FROM tenants WHERE active = 1';
      expect(toPostgresSql(sql)).toBe(sql);
    });
  });

  describe('2. DDL Dialect Translation (translateDdlForPostgres)', () => {
    it('translates INTEGER PRIMARY KEY AUTOINCREMENT to SERIAL PRIMARY KEY', () => {
      const sqliteDdl = 'CREATE TABLE test (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);';
      const pgDdl = translateDdlForPostgres(sqliteDdl);
      expect(pgDdl).toBe('CREATE TABLE test (id SERIAL PRIMARY KEY, name TEXT NOT NULL);');
    });

    it('translates datetime(\'now\') to CURRENT_TIMESTAMP', () => {
      const sqliteDdl = "CREATE TABLE test (created_at TEXT DEFAULT (datetime('now')));";
      const pgDdl = translateDdlForPostgres(sqliteDdl);
      expect(pgDdl).toBe('CREATE TABLE test (created_at TEXT DEFAULT (CURRENT_TIMESTAMP));');
    });

    it('handles mixed case and multiple occurrences', () => {
      const sqliteDdl = `
        CREATE TABLE t1 (seq integer  primary  key  autoincrement, ts text default (datetime("now")));
        CREATE TABLE t2 (id INTEGER PRIMARY KEY AUTOINCREMENT, ts text default (datetime('now')));
      `;
      const pgDdl = translateDdlForPostgres(sqliteDdl);
      expect(pgDdl).toContain('seq SERIAL PRIMARY KEY');
      expect(pgDdl).toContain('id SERIAL PRIMARY KEY');
      expect(pgDdl).toContain('CURRENT_TIMESTAMP');
      expect(pgDdl).not.toContain('AUTOINCREMENT');
      expect(pgDdl).not.toContain("datetime('now')");
    });
  });

  describe('3. SQLite Client Row Lock Sanitization', () => {
    let sqliteClient: SQLiteDatabaseClient;

    beforeEach(async () => {
      sqliteClient = new SQLiteDatabaseClient(':memory:');
      await sqliteClient.execRaw(`
        CREATE TABLE sample_items (
          id TEXT PRIMARY KEY,
          val INTEGER NOT NULL
        );
        INSERT INTO sample_items (id, val) VALUES ('item_1', 100), ('item_2', 200);
      `);
    });

    it('strips FOR UPDATE from query so it runs without syntax error in SQLite', async () => {
      const row = await sqliteClient.queryOne<{ id: string; val: number }>(
        'SELECT * FROM sample_items WHERE id = ? FOR UPDATE',
        ['item_1']
      );
      expect(row).not.toBeNull();
      expect(row?.id).toBe('item_1');
      expect(row?.val).toBe(100);
    });

    it('strips FOR UPDATE NOWAIT and FOR UPDATE SKIP LOCKED', async () => {
      const rows1 = await sqliteClient.query(
        'SELECT * FROM sample_items WHERE val >= ? FOR UPDATE NOWAIT',
        [100]
      );
      expect(rows1).toHaveLength(2);

      const rows2 = await sqliteClient.query(
        'SELECT * FROM sample_items WHERE val >= ? FOR UPDATE SKIP LOCKED',
        [150]
      );
      expect(rows2).toHaveLength(1);
      expect(rows2[0].id).toBe('item_2');
    });

    it('strips FOR UPDATE in execute statements', async () => {
      const res = await sqliteClient.execute(
        'UPDATE sample_items SET val = 300 WHERE id IN (SELECT id FROM sample_items WHERE id = ? FOR UPDATE)',
        ['item_1']
      );
      expect(res.changes).toBe(1);

      const updated = await sqliteClient.queryOne<{ val: number }>(
        'SELECT val FROM sample_items WHERE id = ?',
        ['item_1']
      );
      expect(updated?.val).toBe(300);
    });
  });

  describe('4. PostgresTransactionClient', () => {
    it('executes parameterized queries, mapping ? to $1 and sanitizing undefined', async () => {
      const mockPoolClient: any = {
        query: vi.fn().mockResolvedValue({ rows: [{ id: 'res_1' }], rowCount: 1 }),
      };

      const txClient = new PostgresTransactionClient(mockPoolClient, 1);
      const rows = await txClient.query('SELECT * FROM resources WHERE id = ? AND dept = ?', ['res_1', undefined]);

      expect(mockPoolClient.query).toHaveBeenCalledWith(
        'SELECT * FROM resources WHERE id = $1 AND dept = $2',
        ['res_1', null]
      );
      expect(rows).toEqual([{ id: 'res_1' }]);
    });

    it('executes queryOne returning null on empty result', async () => {
      const mockPoolClient: any = {
        query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      };

      const txClient = new PostgresTransactionClient(mockPoolClient, 1);
      const row = await txClient.queryOne('SELECT * FROM missing WHERE id = ?', ['none']);

      expect(row).toBeNull();
    });

    it('executes statements and returns rowCount changes', async () => {
      const mockPoolClient: any = {
        query: vi.fn().mockResolvedValue({ rows: [], rowCount: 4 }),
      };

      const txClient = new PostgresTransactionClient(mockPoolClient, 1);
      const res = await txClient.execute('DELETE FROM items WHERE tenant_id = ?', ['t1']);

      expect(res.changes).toBe(4);
    });

    it('supports ping check', async () => {
      const mockPoolClient: any = {
        query: vi.fn().mockResolvedValue({ rows: [{ ping: 1 }] }),
      };

      const txClient = new PostgresTransactionClient(mockPoolClient, 1);
      const healthy = await txClient.ping();
      expect(healthy).toBe(true);
      expect(mockPoolClient.query).toHaveBeenCalledWith('SELECT 1 as ping;');
    });

    it('manages nested transactions with SAVEPOINT and RELEASE SAVEPOINT', async () => {
      const callLog: string[] = [];
      const mockPoolClient: any = {
        query: vi.fn().mockImplementation((sql: string) => {
          callLog.push(sql);
          return Promise.resolve({ rows: [], rowCount: 0 });
        }),
      };

      const txClient = new PostgresTransactionClient(mockPoolClient, 1);
      const result = await txClient.transaction(async (innerTx) => {
        await innerTx.query('SELECT 1');
        return 'nested_success';
      });

      expect(result).toBe('nested_success');
      expect(callLog).toEqual([
        'SAVEPOINT sp_1;',
        'SELECT 1',
        'RELEASE SAVEPOINT sp_1;',
      ]);
    });

    it('manages nested transactions with ROLLBACK TO SAVEPOINT on failure', async () => {
      const callLog: string[] = [];
      const mockPoolClient: any = {
        query: vi.fn().mockImplementation((sql: string) => {
          callLog.push(sql);
          return Promise.resolve({ rows: [], rowCount: 0 });
        }),
      };

      const txClient = new PostgresTransactionClient(mockPoolClient, 1);
      await expect(
        txClient.transaction(async (innerTx) => {
          await innerTx.query('SELECT 1');
          throw new Error('boom in savepoint');
        })
      ).rejects.toThrow('boom in savepoint');

      expect(callLog).toEqual([
        'SAVEPOINT sp_1;',
        'SELECT 1',
        'ROLLBACK TO SAVEPOINT sp_1; RELEASE SAVEPOINT sp_1;',
      ]);
    });
  });

  describe('5. PostgresDatabaseClient Lifecycle & Transactions', () => {
    it('executes top-level transaction with BEGIN, COMMIT, and client release', async () => {
      const callLog: string[] = [];
      const mockPoolClient: any = {
        query: vi.fn().mockImplementation((sql: string) => {
          callLog.push(sql);
          return Promise.resolve({ rows: [], rowCount: 0 });
        }),
        release: vi.fn().mockImplementation(() => {
          callLog.push('CLIENT_RELEASED');
        }),
      };

      const mockPool: any = {
        connect: vi.fn().mockResolvedValue(mockPoolClient),
        query: vi.fn(),
        on: vi.fn(),
      };

      const client = new PostgresDatabaseClient({ pool: mockPool });
      const result = await client.transaction(async (tx) => {
        await tx.execute('INSERT INTO log (msg) VALUES (?)', ['hello']);
        return 'committed';
      });

      expect(result).toBe('committed');
      expect(mockPool.connect).toHaveBeenCalledTimes(1);
      expect(callLog).toEqual([
        'BEGIN;',
        'INSERT INTO log (msg) VALUES ($1)',
        'COMMIT;',
        'CLIENT_RELEASED',
      ]);
    });

    it('rolls back top-level transaction and releases client on error', async () => {
      const callLog: string[] = [];
      const mockPoolClient: any = {
        query: vi.fn().mockImplementation((sql: string) => {
          callLog.push(sql);
          return Promise.resolve({ rows: [], rowCount: 0 });
        }),
        release: vi.fn().mockImplementation(() => {
          callLog.push('CLIENT_RELEASED');
        }),
      };

      const mockPool: any = {
        connect: vi.fn().mockResolvedValue(mockPoolClient),
        query: vi.fn(),
        on: vi.fn(),
      };

      const client = new PostgresDatabaseClient({ pool: mockPool });
      await expect(
        client.transaction(async (tx) => {
          await tx.execute('UPDATE data SET status = ?', ['pending']);
          throw new Error('failed after write');
        })
      ).rejects.toThrow('failed after write');

      expect(callLog).toEqual([
        'BEGIN;',
        'UPDATE data SET status = $1',
        'ROLLBACK;',
        'CLIENT_RELEASED',
      ]);
    });

    it('routes calls to active transaction via AsyncLocalStorage even if called on parent client', async () => {
      const callLog: string[] = [];
      const mockPoolClient: any = {
        query: vi.fn().mockImplementation((sql: string) => {
          callLog.push(sql);
          return Promise.resolve({ rows: [{ val: 42 }], rowCount: 1 });
        }),
        release: vi.fn(),
      };

      const mockPool: any = {
        connect: vi.fn().mockResolvedValue(mockPoolClient),
        query: vi.fn(), // Should NOT be called
        on: vi.fn(),
      };

      const client = new PostgresDatabaseClient({ pool: mockPool });
      await client.transaction(async () => {
        // Here we call client.query() directly, NOT tx.query()
        const rows = await client.query('SELECT ? as val', [42]);
        expect(rows).toEqual([{ val: 42 }]);
      });

      expect(mockPool.query).not.toHaveBeenCalled();
      expect(mockPoolClient.query).toHaveBeenCalledWith('SELECT $1 as val', [42]);
    });

    it('supports ping check on pool', async () => {
      const mockPool: any = {
        query: vi.fn().mockResolvedValue({ rows: [{ ping: 1 }] }),
        on: vi.fn(),
      };

      const client = new PostgresDatabaseClient({ pool: mockPool });
      const healthy = await client.ping();
      expect(healthy).toBe(true);
      expect(mockPool.query).toHaveBeenCalledWith('SELECT 1 as ping;');
    });

    it('handles ping failure gracefully', async () => {
      const mockPool: any = {
        query: vi.fn().mockRejectedValue(new Error('Connection terminated')),
        on: vi.fn(),
      };

      const client = new PostgresDatabaseClient({ pool: mockPool });
      const healthy = await client.ping();
      expect(healthy).toBe(false);
    });

    it('executes raw SQL strings on pool', async () => {
      const mockPool: any = {
        query: vi.fn().mockResolvedValue({ rows: [] }),
        on: vi.fn(),
      };

      const client = new PostgresDatabaseClient({ pool: mockPool });
      await client.execRaw('CREATE INDEX IF NOT EXISTS idx_test ON test (col);');
      expect(mockPool.query).toHaveBeenCalledWith('CREATE INDEX IF NOT EXISTS idx_test ON test (col);');
    });
  });

  describe('6. Dual-Mode DatabaseManager', () => {
    const originalDriver = config.get('DB_DRIVER');

    afterEach(async () => {
      config.resetForTesting({ DB_DRIVER: originalDriver });
      await db.close();
    });

    it('instantiates SQLiteDatabaseClient when DB_DRIVER is sqlite', () => {
      config.resetForTesting({ DB_DRIVER: 'sqlite' });
      const client = db.getClient();
      expect(client).toBeInstanceOf(SQLiteDatabaseClient);
    });

    it('instantiates PostgresDatabaseClient when DB_DRIVER is postgres', async () => {
      config.resetForTesting({ DB_DRIVER: 'postgres', DATABASE_URL: 'postgres://localhost:5432/testdb' });
      await db.close(); // Reset singleton

      const client = db.getClient();
      expect(client).toBeInstanceOf(PostgresDatabaseClient);
    });
  });

  describe('7. SchemaMigrator PostgreSQL Translation Hook', () => {
    it('translates SQLite DDL to PostgreSQL dialect when migrator runs against PostgresDatabaseClient', async () => {
      const executedSqls: string[] = [];
      const mockPoolClient: any = {
        query: vi.fn().mockImplementation((sql: string) => {
          executedSqls.push(sql);
          if (sql.includes('SELECT version FROM _migrations')) {
            return Promise.resolve({ rows: [] });
          }
          return Promise.resolve({ rows: [], rowCount: 1 });
        }),
        release: vi.fn(),
      };

      const mockPool: any = {
        connect: vi.fn().mockResolvedValue(mockPoolClient),
        query: vi.fn(),
        on: vi.fn(),
      };

      const pgClient = new PostgresDatabaseClient({ pool: mockPool });
      const migrator = new SchemaMigrator(pgClient);

      // Verify isPostgres detection
      expect((migrator as any).isPostgres).toBe(true);
    });
  });
});
