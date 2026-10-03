/**
 * Kriya Omnitask — Brain-Body Alignment Check (synchronous harness)
 * Runs the real probe suite (probeSuite.ts) against the model and records per tier × language
 * certifications from MEASURED results (docs/kriya S20). Nothing is inferred from the model's name.
 */

import { CapabilityTier, AlignmentCheckReportCard, AlignmentCheckRequest } from './certificationTypes.js';
import { ModelCertificationRepository } from './modelCertificationRepository.js';
import {
  PROBE_SUITE_VERSION,
  ProbeExecutor,
  runCertification,
  openRouterProbeExecutor,
  toCertificationSlug,
  isCellCertified,
  cellPassRate,
} from './probeSuite.js';
import { auditLogger } from '../../security/audit/auditLogger.js';
import { logger } from '../../core/logger/logger.js';

export type ProbeExecutorFactory = (request: AlignmentCheckRequest) => ProbeExecutor;

const defaultExecutorFactory: ProbeExecutorFactory = (request) =>
  openRouterProbeExecutor(toCertificationSlug(request.provider, request.modelId), request.byoKey);

export class AlignmentCheckHarness {
  private certRepo: ModelCertificationRepository;
  private executorFactory: ProbeExecutorFactory;

  constructor(
    certRepo: ModelCertificationRepository = new ModelCertificationRepository(),
    executorFactory: ProbeExecutorFactory = defaultExecutorFactory
  ) {
    this.certRepo = certRepo;
    this.executorFactory = executorFactory;
  }

  public async runAlignmentCheck(request: AlignmentCheckRequest): Promise<AlignmentCheckReportCard> {
    const checkId = `chk_${request.modelId}_${Date.now()}`;
    const tiers: CapabilityTier[] = request.tiers || ['T1', 'T2', 'T3', 'T4'];
    const languages = request.languages || ['en', 'hi', 'te'];

    logger.info(`Starting alignment check for model '${request.modelId}'`, { checkId, tiers, languages });

    let executor: ProbeExecutor;
    try {
      executor = this.executorFactory(request);
    } catch (err) {
      // No executor (e.g. no key) is a failed handshake, reported as such — never a pass.
      const message = err instanceof Error ? err.message : String(err);
      return this.reportCard(checkId, request, {
        stage0_handshake: { stage: 0, name: 'Handshake', passed: false, score: 0, latencyMs: 0, details: {}, errorMessage: message },
      }, [], [], false, 0);
    }

    const run = await runCertification({ executor, tiers, languages });

    if (!run.aborted) {
      const now = new Date().toISOString();
      const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
      for (const tier of tiers) {
        for (const lang of languages) {
          const certified = isCellCertified(run, tier, lang);
          await this.certRepo.saveCertification({
            id: `cert_${request.modelId}_${tier}_${lang}`,
            model_id: request.modelId,
            model_version: request.modelVersion,
            provider: request.provider,
            upstream_provider: request.upstreamProvider || 'direct',
            tier,
            language: lang,
            eval_suite_version: PROBE_SUITE_VERSION,
            status: certified ? 'certified' : 'uncertified',
            pass_rate: cellPassRate(run, tier, lang),
            latency_p95_ms: run.latencyP95Ms,
            cost_per_task_usd: run.costPerProbeUsd ?? 0,
            stage_results_json: JSON.stringify(run.stages),
            certified_at: certified ? now : null,
            expires_at: certified ? expiresAt : null,
            certified_by: 'kriya_probe_harness',
          });
        }
      }
    }

    const certifiedTiers = run.protocolPassed && run.safetyPassed ? run.certifiedTiers : [];
    const certifiedLanguages = run.protocolPassed && run.safetyPassed ? run.certifiedLanguages : [];
    const overallPassed = !run.aborted && certifiedTiers.length > 0 && certifiedLanguages.length > 0;

    await auditLogger.logEvent({
      action: 'model.alignment_check_completed',
      resourceType: 'model',
      resourceId: request.modelId,
      details: {
        checkId,
        suite: PROBE_SUITE_VERSION,
        modelVersion: request.modelVersion,
        certifiedTiers,
        certifiedLanguages,
        probes: run.probeCount,
        costUsd: run.totalCostUsd,
        aborted: run.aborted,
      },
    });

    return this.reportCard(checkId, request, run.stages, certifiedTiers, certifiedLanguages, overallPassed, run.totalCostUsd);
  }

  private reportCard(
    checkId: string,
    request: AlignmentCheckRequest,
    stages: AlignmentCheckReportCard['stages'],
    certifiedTiers: CapabilityTier[],
    certifiedLanguages: string[],
    overallPassed: boolean,
    actualCostUsd: number
  ): AlignmentCheckReportCard {
    return {
      checkId,
      modelId: request.modelId,
      modelVersion: request.modelVersion,
      provider: request.provider,
      upstreamProvider: request.upstreamProvider || 'direct',
      requestedTier: request.tiers?.[0] || 'T1',
      language: request.languages?.[0] || 'en',
      overallPassed,
      stages,
      certifiedTiers,
      certifiedLanguages,
      // Actual spend measured from provider-reported costs (field name kept for API compatibility).
      costEstimateUsd: actualCostUsd,
      completedAt: new Date().toISOString(),
    };
  }
}
