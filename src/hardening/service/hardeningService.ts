/**
 * Xylarc AI — Production Hardening Service
 * Orchestrates multi-tenant stress benchmarks, chaos experiments, red-team validations, and production certification.
 */

import { HardeningRepository } from '../repositories/hardeningRepository.js';
import { ConcurrencyStressTester } from '../stress/concurrencyStressTester.js';
import { ChaosInjectionEngine } from '../chaos/chaosInjectionEngine.js';
import { RedTeamValidator } from '../security/redTeamValidator.js';
import { ProductionReadinessAuditor } from '../readiness/productionReadinessAuditor.js';
import {
  StressRunRecord,
  ChaosExperimentRecord,
  ChaosFaultType,
  RedTeamAuditRecord,
  ProductionReadinessCertificate,
} from '../types/hardeningTypes.js';
import { logger } from '../../core/logger/logger.js';

export class HardeningService {
  constructor(private repo: HardeningRepository) {}

  public async runStressBenchmark(params: {
    runName?: string;
    concurrency?: number;
    requestsPerWorker?: number;
    tenantCount?: number;
  }): Promise<StressRunRecord> {
    const run = await ConcurrencyStressTester.runStressTest(params);
    await this.repo.saveStressRun(run);
    logger.info(`Completed Stress Benchmark '${run.runName}' (Concurrency: ${run.concurrencyLevel}, Throughput: ${run.throughputRps} RPS, P95: ${run.p95LatencyMs}ms)`);
    return run;
  }

  public async listStressRuns(limit = 20): Promise<StressRunRecord[]> {
    return this.repo.listStressRuns(limit);
  }

  public async runChaosExperiment(params: {
    experimentName: string;
    faultType: ChaosFaultType;
    faultProbability?: number;
    iterations?: number;
  }): Promise<ChaosExperimentRecord> {
    const exp = await ChaosInjectionEngine.runExperiment(params);
    await this.repo.saveChaosExperiment(exp);
    logger.info(`Executed Chaos Experiment '${exp.experimentName}' (Fault: ${exp.faultType}, Status: ${exp.status}, Survived: ${exp.survivedCount}/${exp.injectedCount})`);
    return exp;
  }

  public async listChaosExperiments(limit = 20): Promise<ChaosExperimentRecord[]> {
    return this.repo.listChaosExperiments(limit);
  }

  public async runRedTeamAudit(auditName = 'Comprehensive Adversarial Red-Team Scan'): Promise<RedTeamAuditRecord> {
    const audit = RedTeamValidator.runAudit(auditName);
    await this.repo.saveRedTeamAudit(audit);
    logger.info(`Completed Red-Team Audit '${audit.auditName}' (Probes: ${audit.totalProbes}, Blocked: ${audit.attacksBlocked}, Threat Score: ${audit.threatScore})`);
    return audit;
  }

  public async listRedTeamAudits(limit = 20): Promise<RedTeamAuditRecord[]> {
    return this.repo.listRedTeamAudits(limit);
  }

  public async getProductionReadinessCertificate(): Promise<ProductionReadinessCertificate> {
    const cert = ProductionReadinessAuditor.generateCertificate();
    for (const check of cert.checks) {
      await this.repo.saveReadinessCheck(check);
    }
    logger.info(`Issued Production Readiness Certificate ${cert.certificateId} (Verdict: ${cert.overallVerdict}, Score: ${cert.readinessScorePct}%)`);
    return cert;
  }
}
