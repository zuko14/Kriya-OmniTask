/**
 * Xylarc AI — Production Hardening Repository
 * Database access layer for stress benchmarks, chaos experiments, red-team audits, and readiness checks.
 */

import { DatabaseClient } from '../../storage/db.js';
import {
  StressRunRecord,
  ChaosExperimentRecord,
  RedTeamAuditRecord,
  ProductionReadinessCheck,
} from '../types/hardeningTypes.js';

export class HardeningRepository {
  constructor(private client: DatabaseClient) {}

  // 1. Stress Runs
  public async saveStressRun(run: StressRunRecord): Promise<void> {
    await this.client.execute(
      `INSERT INTO hardening_stress_runs (
        id, run_name, concurrency_level, total_requests, successful_requests,
        failed_requests, throughput_rps, p50_latency_ms, p95_latency_ms, p99_latency_ms,
        cross_tenant_leakage_detected, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        run.id,
        run.runName,
        run.concurrencyLevel,
        run.totalRequests,
        run.successfulRequests,
        run.failedRequests,
        run.throughputRps,
        run.p50LatencyMs,
        run.p95LatencyMs,
        run.p99LatencyMs,
        run.crossTenantLeakageDetected ? 1 : 0,
        run.createdAt,
      ]
    );
  }

  public async listStressRuns(limit = 20): Promise<StressRunRecord[]> {
    const rows = await this.client.query<any>(
      'SELECT * FROM hardening_stress_runs ORDER BY created_at DESC LIMIT ?;',
      [limit]
    );
    return rows.map((r: any) => ({
      id: r.id,
      runName: r.run_name,
      concurrencyLevel: Number(r.concurrency_level),
      totalRequests: Number(r.total_requests),
      successfulRequests: Number(r.successful_requests),
      failedRequests: Number(r.failed_requests),
      throughputRps: Number(r.throughput_rps),
      p50LatencyMs: Number(r.p50_latency_ms),
      p95LatencyMs: Number(r.p95_latency_ms),
      p99LatencyMs: Number(r.p99_latency_ms),
      crossTenantLeakageDetected: Boolean(r.cross_tenant_leakage_detected),
      createdAt: r.created_at,
    }));
  }

  // 2. Chaos Experiments
  public async saveChaosExperiment(exp: ChaosExperimentRecord): Promise<void> {
    await this.client.execute(
      `INSERT INTO chaos_experiments (
        id, experiment_name, fault_type, injected_count, survived_count,
        recovery_time_ms, status, details_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        exp.id,
        exp.experimentName,
        exp.faultType,
        exp.injectedCount,
        exp.survivedCount,
        exp.recoveryTimeMs,
        exp.status,
        JSON.stringify(exp.details),
        exp.createdAt,
      ]
    );
  }

  public async listChaosExperiments(limit = 20): Promise<ChaosExperimentRecord[]> {
    const rows = await this.client.query<any>(
      'SELECT * FROM chaos_experiments ORDER BY created_at DESC LIMIT ?;',
      [limit]
    );
    return rows.map((r: any) => ({
      id: r.id,
      experimentName: r.experiment_name,
      faultType: r.fault_type,
      injectedCount: Number(r.injected_count),
      survivedCount: Number(r.survived_count),
      recoveryTimeMs: Number(r.recovery_time_ms),
      status: r.status,
      details: JSON.parse(r.details_json || '{}'),
      createdAt: r.created_at,
    }));
  }

  // 3. Red-Team Audits
  public async saveRedTeamAudit(audit: RedTeamAuditRecord): Promise<void> {
    await this.client.execute(
      `INSERT INTO red_team_audits (
        id, audit_name, total_probes, attacks_blocked, vulnerabilities_found,
        threat_score, status, findings_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        audit.id,
        audit.auditName,
        audit.totalProbes,
        audit.attacksBlocked,
        audit.vulnerabilitiesFound,
        audit.threatScore,
        audit.status,
        JSON.stringify(audit.findings),
        audit.createdAt,
      ]
    );
  }

  public async listRedTeamAudits(limit = 20): Promise<RedTeamAuditRecord[]> {
    const rows = await this.client.query<any>(
      'SELECT * FROM red_team_audits ORDER BY created_at DESC LIMIT ?;',
      [limit]
    );
    return rows.map((r: any) => ({
      id: r.id,
      auditName: r.audit_name,
      totalProbes: Number(r.total_probes),
      attacksBlocked: Number(r.attacks_blocked),
      vulnerabilitiesFound: Number(r.vulnerabilities_found),
      threatScore: Number(r.threat_score),
      status: r.status,
      findings: JSON.parse(r.findings_json || '[]'),
      createdAt: r.created_at,
    }));
  }

  // 4. Production Readiness Checks
  public async saveReadinessCheck(check: ProductionReadinessCheck): Promise<void> {
    await this.client.execute(
      `INSERT INTO production_readiness_checks (
        id, check_category, check_name, status, evidence, evaluated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        evidence = excluded.evidence,
        evaluated_at = excluded.evaluated_at;`,
      [
        check.id,
        check.checkCategory,
        check.checkName,
        check.status,
        check.evidence,
        check.evaluatedAt,
      ]
    );
  }

  public async listReadinessChecks(): Promise<ProductionReadinessCheck[]> {
    const rows = await this.client.query<any>(
      'SELECT * FROM production_readiness_checks ORDER BY check_category ASC;'
    );
    return rows.map((r: any) => ({
      id: r.id,
      checkCategory: r.check_category,
      checkName: r.check_name,
      status: r.status,
      evidence: r.evidence,
      evaluatedAt: r.evaluated_at,
    }));
  }
}
