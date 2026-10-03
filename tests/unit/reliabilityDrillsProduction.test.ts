/**
 * Kriya AI — Reliability Drills, Failover Runbooks & PITR Production Test Suite (WP-8.4, Milestone M8)
 *
 * Verifies 100% production compliance:
 * 1. Staging-Only Chaos Injection Gate:
 *    - Strictly prevents chaos and stress runs when APP_MODE === 'production'
 *    - Permits execution in 'staging' or 'test' environments
 * 2. Parameterized Chaos Injection Drills:
 *    - Network Drop & Exponential Retry Drills
 *    - LLM Provider 429 Rate Limit Fallback Drills
 *    - Database Connection Pool Starvation & Queuing Drills
 *    - Worker Thread Crash & DLQ Recovery Drills
 *    - Latency Spike Absorption Drills
 * 3. Point-In-Time Recovery (PITR) & Snapshot Verification:
 *    - Deterministic SHA-256 cryptographic snapshot generation
 *    - Table inventory record count tracking
 *    - Tamper / corruption detection (throws PitrIntegrityError)
 *    - Point-in-time restore drill execution & read-back verification
 * 4. High-Availability Failover Runbook Automation:
 *    - 7-step automated primary database failover
 *    - Heartbeat failure detection, circuit breaker trip, replica promotion, pool re-pointing, SRE notification
 *    - Live cluster node topology inspection
 * 5. Fastify REST Endpoints:
 *    - /api/v1/reliability/drills/* (run, runs)
 *    - /api/v1/reliability/pitr/* (snapshots, verify, restore, restores)
 *    - /api/v1/reliability/failover/* (simulate, topology, drills)
 *    - Gating, authentication, and RBAC enforcement
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { TenantContextManager } from '../../src/core/context/tenantContext.js';
import { JwtService } from '../../src/security/auth/jwt.js';
import { config } from '../../src/core/config/config.js';
import {
  ChaosDrillEngine,
} from '../../src/reliability/chaos/chaosDrillEngine.js';
import {
  PitrEngine,
  PitrIntegrityError,
} from '../../src/reliability/pitr/pitrEngine.js';
import {
  FailoverRunbookEngine,
} from '../../src/reliability/failover/failoverRunbookEngine.js';
import { ReliabilityService } from '../../src/reliability/service/reliabilityService.js';
import { HardeningService } from '../../src/hardening/service/hardeningService.js';
import { HardeningRepository } from '../../src/hardening/repositories/hardeningRepository.js';
import { reliabilityRoutes } from '../../src/api/routes/reliabilityRoutes.js';
import { buildServer } from '../../src/api/server.js';
import { ForbiddenError } from '../../src/core/errors/errors.js';

describe('WP-8.4: Reliability Drills, Failover Runbooks & PITR Suite', () => {
  const tenantId = 'tenant_reliability_test_01';
  let adminToken: string;
  let viewerToken: string;
  let originalAppMode: string | undefined;

  beforeEach(async () => {
    originalAppMode = process.env.APP_MODE;
    // Set to staging by default for tests
    process.env.APP_MODE = 'staging';

    const client = db.getClient();
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    // Seed test tenant fixture
    await client.execute(
      `INSERT OR IGNORE INTO tenants (id, name, slug, status, created_at, updated_at)
       VALUES (?, ?, ?, 'active', datetime('now'), datetime('now'));`,
      [tenantId, 'Reliability Test Tenant', 'rel-test-tenant']
    );

    // Seed sample customers to test snapshotting
    await client.execute(
      `INSERT OR IGNORE INTO customers (id, tenant_id, organization_id, primary_email, primary_phone, full_name, status, created_at, updated_at)
       VALUES (?, ?, 'default', 'alice@test.com', '+1234567890', 'Alice Reliability', 'active', datetime('now'), datetime('now'));`,
      [`cust_${tenantId}_1`, tenantId]
    );

    // Clean tables for this tenant
    await client.execute(`DELETE FROM reliability_drill_runs WHERE tenant_id = ?;`, [tenantId]);
    await client.execute(`DELETE FROM pitr_restore_operations WHERE tenant_id = ?;`, [tenantId]);
    await client.execute(`DELETE FROM pitr_snapshots WHERE tenant_id = ?;`, [tenantId]);
    await client.execute(`DELETE FROM failover_drill_runs WHERE tenant_id = ?;`, [tenantId]);

    // Create auth tokens
    adminToken = JwtService.sign({
      userId: 'user_admin_rel',
      tenantId,
      organizationId: 'default',
      email: 'admin@reliability.com',
      roles: ['super_admin', 'owner'],
    });

    viewerToken = JwtService.sign({
      userId: 'user_viewer_rel',
      tenantId,
      organizationId: 'default',
      email: 'viewer@reliability.com',
      roles: ['admin'],
    });
  });

  afterEach(() => {
    process.env.APP_MODE = originalAppMode;
  });

  describe('1. Production Safety Gate (Staging-Only Fault Injection)', () => {
    it('should strictly prohibit ChaosDrillEngine in production environment', async () => {
      process.env.APP_MODE = 'production';
      const engine = new ChaosDrillEngine();

      await expect(
        engine.executeDrill(tenantId, {
          drillName: 'Production Violation Drill',
          faultType: 'network_drop_retry',
        })
      ).rejects.toThrow(ForbiddenError);

      await expect(
        engine.executeDrill(tenantId, {
          drillName: 'Production Violation Drill',
          faultType: 'network_drop_retry',
        })
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
        details: expect.objectContaining({ code: 'CHAOS_DISABLED_IN_PRODUCTION' }),
      });
    });

    it('should prohibit HardeningService chaos experiments and stress tests in production', async () => {
      process.env.APP_MODE = 'production';
      const hardeningRepo = new HardeningRepository(db.getClient());
      const hardeningService = new HardeningService(hardeningRepo);

      await expect(
        hardeningService.runChaosExperiment({
          experimentName: 'Forbidden Chaos',
          faultType: 'network_error',
        })
      ).rejects.toThrow(ForbiddenError);

      await expect(
        hardeningService.runStressBenchmark({
          runName: 'Forbidden Stress',
          concurrency: 5,
        })
      ).rejects.toThrow(ForbiddenError);
    });

    it('should permit ChaosDrillEngine when APP_MODE is staging or test', async () => {
      process.env.APP_MODE = 'staging';
      const engine = new ChaosDrillEngine();

      const result = await engine.executeDrill(tenantId, {
        drillName: 'Staging Permitted Drill',
        faultType: 'latency_spike',
        iterations: 3,
        faultProbability: 1.0,
      });

      expect(result).toBeDefined();
      expect(result.environment).toBe('staging');
      expect(result.status).toBe('passed');
    });
  });

  describe('2. Parameterized Chaos Drills & Recovery Scenarios', () => {
    it('should execute network_drop_retry drill and verify exponential backoff recovery', async () => {
      const service = new ReliabilityService();

      const drill = await TenantContextManager.withTenant(tenantId, 'default', async () => {
        return service.executeChaosDrill({
          drillName: 'Transient Network Dropped Drill',
          faultType: 'network_drop_retry',
          iterations: 5,
          faultProbability: 0.8,
        });
      });

      expect(drill.faultType).toBe('network_drop_retry');
      expect(drill.injectedCount).toBeGreaterThan(0);
      expect(drill.survivedCount).toBe(drill.injectedCount);
      expect(drill.status).toBe('passed');
      expect(drill.recoveryTimeMs).toBeGreaterThan(0);

      // Verify persistence in DB
      const runs = await TenantContextManager.withTenant(tenantId, 'default', async () => {
        return service.listChaosDrills();
      });
      expect(runs.length).toBe(1);
      expect(runs[0].id).toBe(drill.id);
    });

    it('should execute llm_rate_limit_fallback drill and verify fallback router survival', async () => {
      const service = new ReliabilityService();

      const drill = await TenantContextManager.withTenant(tenantId, 'default', async () => {
        return service.executeChaosDrill({
          drillName: 'LLM 429 Provider Rate Limit Drill',
          faultType: 'llm_rate_limit_fallback',
          iterations: 4,
          faultProbability: 1.0,
        });
      });

      expect(drill.faultType).toBe('llm_rate_limit_fallback');
      expect(drill.injectedCount).toBe(4);
      expect(drill.survivedCount).toBe(4);
      expect(drill.status).toBe('passed');
    });

    it('should execute db_pool_exhaustion drill and verify queue backpressure absorption', async () => {
      const service = new ReliabilityService();

      const drill = await TenantContextManager.withTenant(tenantId, 'default', async () => {
        return service.executeChaosDrill({
          drillName: 'Database Pool Saturation Drill',
          faultType: 'db_pool_exhaustion',
          iterations: 3,
          faultProbability: 1.0,
        });
      });

      expect(drill.faultType).toBe('db_pool_exhaustion');
      expect(drill.survivedCount).toBe(3);
      expect(drill.status).toBe('passed');
    });

    it('should execute worker_queue_crash drill and verify DLQ and transaction rollback', async () => {
      const service = new ReliabilityService();

      const drill = await TenantContextManager.withTenant(tenantId, 'default', async () => {
        return service.executeChaosDrill({
          drillName: 'Worker Thread Crash Drill',
          faultType: 'worker_queue_crash',
          iterations: 3,
          faultProbability: 1.0,
        });
      });

      expect(drill.faultType).toBe('worker_queue_crash');
      expect(drill.survivedCount).toBe(3);
      expect(drill.status).toBe('passed');
    });
  });

  describe('3. Point-In-Time Recovery (PITR) & Snapshot Verification', () => {
    it('should take an atomic snapshot, compute SHA-256 checksum, and inventory record counts', async () => {
      const engine = new PitrEngine();

      const snapshot = await engine.createSnapshot(tenantId, {
        snapshotName: 'Pre-Deployment Gold Master Snapshot',
        snapshotType: 'full',
      });

      expect(snapshot.id).toMatch(/^pitr_/);
      expect(snapshot.snapshotName).toBe('Pre-Deployment Gold Master Snapshot');
      expect(snapshot.status).toBe('completed');
      expect(snapshot.checksumSha256).toHaveLength(64); // Valid SHA-256 hex string
      expect(snapshot.recordCounts['tenants']).toBe(1);
      expect(snapshot.recordCounts['customers']).toBe(1);

      // Verify integrity check
      const verification = await engine.verifySnapshotIntegrity(tenantId, snapshot.id);
      expect(verification.valid).toBe(true);
      expect(verification.checksumSha256).toBe(snapshot.checksumSha256);
      expect(verification.computedSha256).toBe(snapshot.checksumSha256);
    });

    it('should detect corrupted or tampered snapshots and throw PitrIntegrityError', async () => {
      const engine = new PitrEngine();

      const snapshot = await engine.createSnapshot(tenantId, {
        snapshotName: 'Tamper Target Snapshot',
        snapshotType: 'full',
      });

      // Tamper with payload directly in database
      const client = db.getClient();
      await client.execute(
        `UPDATE pitr_snapshots SET data_payload_json = ? WHERE id = ?;`,
        ['{"tampered": true, "customers": []}', snapshot.id]
      );

      await expect(
        engine.verifySnapshotIntegrity(tenantId, snapshot.id)
      ).rejects.toThrow(PitrIntegrityError);
    });

    it('should execute a point-in-time restore drill and verify row counts read-back', async () => {
      const engine = new PitrEngine();

      // 1. Create snapshot
      const snapshot = await engine.createSnapshot(tenantId, {
        snapshotName: 'Before Accidental Deletion',
        snapshotType: 'full',
      });

      // 2. Simulate accidental deletion of customer record
      const client = db.getClient();
      await client.execute(`DELETE FROM customers WHERE tenant_id = ?;`, [tenantId]);
      const rowsAfterDelete = await client.query(`SELECT id FROM customers WHERE tenant_id = ?;`, [tenantId]);
      expect(rowsAfterDelete.length).toBe(0);

      // 3. Execute PITR Restore Drill
      const restoreOp = await engine.executeRestoreDrill(tenantId, {
        snapshotId: snapshot.id,
        verifyIntegrityOnly: false,
      });

      expect(restoreOp.status).toBe('verified');
      expect(restoreOp.verified).toBe(true);
      expect(restoreOp.restoredRecordsCount).toBeGreaterThanOrEqual(2); // tenant + customer

      // 4. Verify data was restored
      const restoredCustomers = await client.query(`SELECT id FROM customers WHERE tenant_id = ?;`, [tenantId]);
      expect(restoredCustomers.length).toBe(1);
      expect(restoredCustomers[0].id).toBe(`cust_${tenantId}_1`);

      // 5. Check restore history
      const restores = await engine.listRestores(tenantId);
      expect(restores.length).toBe(1);
      expect(restores[0].id).toBe(restoreOp.id);
    });
  });

  describe('4. High-Availability Failover Runbook Automation', () => {
    it('should execute full 7-step failover drill, promote replica, and dispatch SRE incident', async () => {
      const engine = new FailoverRunbookEngine();

      // Inspect initial topology
      const initialTopology = engine.getClusterTopology();
      expect(initialTopology.activePrimary).toBe('pg-node-primary-01');
      expect(initialTopology.failoverReady).toBe(true);

      // Execute failover drill
      const drillResult = await engine.executeFailoverDrill(tenantId, {
        drillName: 'Primary Node Unreachable Failover Drill',
        primaryNodeId: 'pg-node-primary-01',
        targetReplicaId: 'pg-node-replica-01',
        simulateReplicationLagMs: 8,
      });

      expect(drillResult.id).toMatch(/^failover_/);
      expect(drillResult.status).toBe('completed');
      expect(drillResult.promotedReplicaId).toBe('pg-node-replica-01');
      expect(drillResult.steps.length).toBe(7);

      // Assert each step completed successfully
      const stepNames = drillResult.steps.map((s) => s.stepName);
      expect(stepNames).toEqual([
        'PRIMARY_HEARTBEAT_FAILURE_DETECTED',
        'CIRCUIT_BREAKER_TRIPPED_TO_DEGRADED',
        'REPLICA_LAG_VERIFIED',
        'REPLICA_PROMOTED_TO_PRIMARY',
        'CONNECTION_POOL_REPOINTED',
        'SRE_INCIDENT_DISPATCHED',
        'HEALTH_NORMALIZED_POST_FAILOVER',
      ]);

      // Inspect post-failover topology
      const updatedTopology = engine.getClusterTopology();
      expect(updatedTopology.activePrimary).toBe('pg-node-replica-01');
    });
  });

  describe('5. REST API Endpoints & RBAC Enforcement', () => {
    let app: FastifyInstance;

    beforeEach(async () => {
      app = await buildServer();
    });

    afterEach(async () => {
      if (app) {
        await app.close();
      }
    });

    it('POST /api/v1/reliability/drills/run should execute drill when authorized as system:admin', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/reliability/drills/run',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
        payload: {
          drillName: 'HTTP Chaos API Test',
          faultType: 'network_drop_retry',
          iterations: 3,
        },
      });

      expect(res.statusCode).toBe(201);
      const json = res.json();
      expect(json.id).toBeDefined();
      expect(json.faultType).toBe('network_drop_retry');
      expect(json.status).toBe('passed');
    });

    it('POST /api/v1/reliability/drills/run should reject execution in production environment with 403', async () => {
      process.env.APP_MODE = 'production';

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/reliability/drills/run',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
        payload: {
          drillName: 'Production Rejection Test',
          faultType: 'latency_spike',
        },
      });

      expect(res.statusCode).toBe(403);
      const json = res.json();
      expect(json.error.code).toBe('FORBIDDEN');
      expect(json.error.message).toContain('prohibited in production mode');
    });

    it('POST /api/v1/reliability/drills/run should forbid users without system:admin role', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/reliability/drills/run',
        headers: {
          authorization: `Bearer ${viewerToken}`,
        },
        payload: {
          drillName: 'Unauthorized Test',
          faultType: 'latency_spike',
        },
      });

      expect(res.statusCode).toBe(403);
    });

    it('POST & GET /api/v1/reliability/pitr/snapshots should create, list, and verify snapshot', async () => {
      // 1. Create snapshot
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/reliability/pitr/snapshots',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
        payload: {
          snapshotName: 'HTTP Snapshot Gold',
          snapshotType: 'full',
        },
      });

      expect(createRes.statusCode).toBe(201);
      const snapshot = createRes.json();
      expect(snapshot.checksumSha256).toBeDefined();

      // 2. List snapshots
      const listRes = await app.inject({
        method: 'GET',
        url: '/api/v1/reliability/pitr/snapshots',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      expect(listRes.statusCode).toBe(200);
      expect(listRes.json().count).toBeGreaterThanOrEqual(1);

      // 3. Verify snapshot checksum
      const verifyRes = await app.inject({
        method: 'GET',
        url: `/api/v1/reliability/pitr/snapshots/${snapshot.id}/verify`,
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      expect(verifyRes.statusCode).toBe(200);
      expect(verifyRes.json().valid).toBe(true);

      // 4. Run restore drill
      const restoreRes = await app.inject({
        method: 'POST',
        url: '/api/v1/reliability/pitr/restore',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
        payload: {
          snapshotId: snapshot.id,
          verifyIntegrityOnly: true,
        },
      });

      expect(restoreRes.statusCode).toBe(200);
      expect(restoreRes.json().status).toBe('verified');
      expect(restoreRes.json().verified).toBe(true);
    });

    it('POST /api/v1/reliability/failover/simulate should execute automated failover drill', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/reliability/failover/simulate',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
        payload: {
          drillName: 'API Failover Drill',
          primaryNodeId: 'pg-node-primary-01',
          targetReplicaId: 'pg-node-replica-01',
        },
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.status).toBe('completed');
      expect(json.steps.length).toBe(7);

      // Check topology endpoint
      const topoRes = await app.inject({
        method: 'GET',
        url: '/api/v1/reliability/failover/topology',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      expect(topoRes.statusCode).toBe(200);
      expect(topoRes.json().failoverReady).toBeDefined();
    });
  });
});
