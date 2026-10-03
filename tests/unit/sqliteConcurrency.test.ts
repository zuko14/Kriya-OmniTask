/**
 * Kriya Omnitask — S35 regression: one shared SQLite connection, many concurrent callers.
 * Before the fix, a concurrent caller's write landed inside another caller's open transaction
 * (and vanished on its rollback), and a second BEGIN threw "cannot start a transaction within a transaction".
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db, SQLiteDatabaseClient } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { TenantContextManager } from '../../src/core/context/tenantContext.js';
import { TenantRepository } from '../../src/storage/repositories/tenantRepository.js';
import { GraphExecutor } from '../../src/runtime/graph/executor.js';
import { GraphRunRepository } from '../../src/runtime/graph/graphRunRepository.js';
import { createRuntimeHandlers } from '../../src/runtime/graph/handlers.js';
import { GraphDefinition } from '../../src/runtime/graph/types.js';

const tick = () => new Promise((r) => setTimeout(r, 5));

describe('SQLite client under concurrency (S35)', () => {
  let client: SQLiteDatabaseClient;

  beforeEach(async () => {
    client = new SQLiteDatabaseClient(':memory:');
    await client.execute('CREATE TABLE t (v TEXT)');
  });

  afterEach(async () => {
    await client.close();
  });

  it("a rolled-back transaction never takes a concurrent caller's write with it", async () => {
    const failing = client
      .transaction(async (tx) => {
        await tx.execute("INSERT INTO t VALUES ('a')");
        await tick(); // the other caller runs now
        throw new Error('boom');
      })
      .catch((e: Error) => e.message);
    const other = client.execute("INSERT INTO t VALUES ('b')");
    expect(await failing).toBe('boom');
    await other;
    expect((await client.query<{ v: string }>('SELECT v FROM t')).map((r) => r.v)).toEqual(['b']);
  });

  it('concurrent transactions both commit instead of colliding', async () => {
    await Promise.all(
      ['x', 'y', 'z'].map((v) =>
        client.transaction(async (tx) => {
          await tx.execute('INSERT INTO t VALUES (?)', [v]);
          await tick();
          await tx.execute('INSERT INTO t VALUES (?)', [`${v}2`]);
        })
      )
    );
    expect((await client.query('SELECT v FROM t')).length).toBe(6);
  });

  it('a nested transaction is a savepoint: its failure rolls back only itself', async () => {
    await client.transaction(async (tx) => {
      await tx.execute("INSERT INTO t VALUES ('outer')");
      await tx
        .transaction(async (inner) => {
          await inner.execute("INSERT INTO t VALUES ('inner')");
          throw new Error('inner fails');
        })
        .catch(() => undefined);
      // code inside the transaction may also use the shared client directly without deadlocking
      await client.execute("INSERT INTO t VALUES ('direct')");
    });
    expect((await client.query<{ v: string }>('SELECT v FROM t ORDER BY v')).map((r) => r.v)).toEqual(['direct', 'outer']);
  });

  it('concurrent graph runs on one connection all complete', async () => {
    db.setClientForTesting(client);
    await new SchemaMigrator(client).applyMigrations();
    const tenantId = (await new TenantRepository(client).create({ name: 'C', slug: 'conc', plan_tier: 'enterprise', channel_plan: 'combined' })).id;
    const graph: GraphDefinition = {
      id: 'conc', version: '1.0.0', entry: 'a', maxSteps: 10,
      nodes: [
        { id: 'a', kind: 'rule', config: { rule: 'slow' } },
        { id: 'b', kind: 'rule', config: { rule: 'slow' } },
        { id: 'done', kind: 'end', outcome: 'informed', config: {} },
      ],
      edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'done' }],
    };
    const { handlers, compensator } = createRuntimeHandlers({ agentSlug: 't', rules: { slow: async (s) => (await tick(), { n: Number(s.n ?? 0) + 1 }) } });
    const exec = new GraphExecutor(handlers, new GraphRunRepository(client), compensator);
    const results = await TenantContextManager.withTenant(tenantId, 'default', () => Promise.all(Array.from({ length: 8 }, () => exec.start(graph, {}))));
    expect(results.map((r) => [r.outcome, r.state.n])).toEqual(Array.from({ length: 8 }, () => ['informed', 2]));
  });
});
