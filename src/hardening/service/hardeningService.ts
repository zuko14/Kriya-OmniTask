/**
 * Kriya AI — Production Hardening Service
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
import { config } from '../../core/config/config.js';
import { ForbiddenError } from '../../core/errors/errors.js';

export class HardeningService {
  constructor(private repo: HardeningRepository) {}

  private assertStagingOnly(operation: string): void {
    const appMode = config.get('APP_MODE') || process.env.APP_MODE || 'development';
    if (appMode === 'production') {
      logger.error(`CRITICAL: Attempted to run ${operation} in production mode!`, { appMode });
      throw new ForbiddenError(
        `${operation} is strictly prohibited in production mode. Set APP_MODE=staging or APP_MODE=test to execute.`,
        { appMode, code: 'CHAOS_DISABLED_IN_PRODUCTION' }
      );
    }
  }

  public async runStressBenchmark(params: {
    runName?: string;
    concurrency?: number;
    requestsPerWorker?: number;
    tenantCount?: number;
  }): Promise<StressRunRecord> {
    this.assertStagingOnly('Stress benchmarks');
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
    this.assertStagingOnly('Chaos injection experiments');
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
