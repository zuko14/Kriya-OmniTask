import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server.js';
import { db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { JwtService } from '../../src/security/auth/jwt.js';

describe('Production Hardening, Chaos & Red-Team REST Integration Tests', () => {
  let app: FastifyInstance;
  const tenantId = 'tenant_hardening_int';
  let operatorToken: string;

  beforeAll(async () => {
    app = await buildServer();
    await app.ready();

    const client = db.getClient();
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    const now = new Date().toISOString();
    await client.execute(
      'INSERT OR IGNORE INTO tenants (id, name, slug, status, plan_tier, channel_plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?);',
      [tenantId, 'Hardening Enterprise Systems', 'hardening-org', 'active', 'enterprise', 'combined', now, now]
    );

    operatorToken = JwtService.sign({
      userId: 'usr_hardening_lead',
      tenantId,
      email: 'lead@hardening.com',
      roles: ['system'],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('should run multi-tenant stress benchmarks, chaos experiments, red-team scans, and obtain production readiness certificate', async () => {
    // 1. Run Concurrency Stress Benchmark
    const stressRes = await app.inject({
      method: 'POST',
      url: '/api/v1/hardening/stress/run',
      headers: { authorization: `Bearer ${operatorToken}` },
      payload: {
        runName: 'Integration Multi-Tenant Load Benchmark',
        concurrency: 5,
        requestsPerWorker: 4,
        tenantCount: 2,
      },
    });
    expect(stressRes.statusCode).toBe(201);
    const stressRun = stressRes.json();
    expect(stressRun.id).toBeDefined();
    expect(stressRun.totalRequests).toBe(20);
    expect(stressRun.successfulRequests).toBe(20);
    expect(stressRun.crossTenantLeakageDetected).toBe(false);

    // 2. Query Stress Benchmark Runs
    const listStressRes = await app.inject({
      method: 'GET',
      url: '/api/v1/hardening/stress/runs',
      headers: { authorization: `Bearer ${operatorToken}` },
    });
    expect(listStressRes.statusCode).toBe(200);
    expect(listStressRes.json().count).toBeGreaterThanOrEqual(1);

    // 3. Run Chaos Injection Experiment
    const chaosRes = await app.inject({
      method: 'POST',
      url: '/api/v1/hardening/chaos/experiments',
      headers: { authorization: `Bearer ${operatorToken}` },
      payload: {
        experimentName: 'Transient Network Dropout Test',
        faultType: 'network_error',
        faultProbability: 0.5,
        iterations: 4,
      },
    });
    expect(chaosRes.statusCode).toBe(201);
    const chaosExp = chaosRes.json();
    expect(chaosExp.id).toBeDefined();
    expect(chaosExp.status).toBe('passed');

    // 4. Run Adversarial Red-Team Audit
    const redTeamRes = await app.inject({
      method: 'POST',
      url: '/api/v1/hardening/red-team/audit',
      headers: { authorization: `Bearer ${operatorToken}` },
      payload: {
        auditName: 'Integration Adversarial Red-Team Scan',
      },
    });
    expect(redTeamRes.statusCode).toBe(201);
    const redTeamAudit = redTeamRes.json();
    expect(redTeamAudit.id).toBeDefined();
    expect(redTeamAudit.attacksBlocked).toBe(4);
    expect(redTeamAudit.threatScore).toBe(0.0);
    expect(redTeamAudit.status).toBe('passed');

    // 5. Query Production Readiness Certificate
    const certRes = await app.inject({
      method: 'GET',
      url: '/api/v1/hardening/readiness/certificate',
      headers: { authorization: `Bearer ${operatorToken}` },
    });
    expect(certRes.statusCode).toBe(200);
    const cert = certRes.json();
    expect(cert.overallVerdict).toBe('PRODUCTION_READY');
    expect(cert.readinessScorePct).toBe(100);
    expect(cert.checks.length).toBe(8);
  });
});
