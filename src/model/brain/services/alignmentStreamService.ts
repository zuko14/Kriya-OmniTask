/**
 * Kriya Omnitask — Brain-Body Alignment Check with live SSE streaming (§9.7, §18.6.3)
 * Runs the REAL probe suite (model/certification/probeSuite.ts) and streams each stage as it
 * completes. Scores, latency and spend are measured, never inferred from the model's name (docs/kriya S20, S23).
 */

import { BrainSupplyRepository } from '../repositories/brainSupplyRepository.js';
import { ModelCertificationRepository } from '../../certification/modelCertificationRepository.js';
import {
  BrainAlignmentRunRecord,
  BrainAlignmentStageEvent,
  WorkforceImpactSummary,
  ProposedBrainAssignment,
} from '../types/brainSupplyTypes.js';
import { CapabilityTier, StageResult } from '../../certification/certificationTypes.js';
import {
  PROBE_SUITE_VERSION,
  ProbeExecutor,
  runCertification,
  openRouterProbeExecutor,
  toCertificationSlug,
  estimateRunTokens,
  isCellCertified,
  cellPassRate,
} from '../../certification/probeSuite.js';
import { fetchOpenRouterPricing, ModelPricing } from '../../gateway/openRouterAdapter.js';
import { config } from '../../../core/config/config.js';
import { auditLogger } from '../../../security/audit/auditLogger.js';
import { TenantContextManager } from '../../../core/context/tenantContext.js';
import { logger } from '../../../core/logger/logger.js';

export type StreamExecutorFactory = (run: BrainAlignmentRunRecord, apiKey?: string) => ProbeExecutor;

const defaultExecutorFactory: StreamExecutorFactory = (run, apiKey) =>
  openRouterProbeExecutor(toCertificationSlug(run.provider, run.modelId), apiKey);

const ALL_TIERS: CapabilityTier[] = ['T1', 'T2', 'T3', 'T4'];
const DEFAULT_LANGUAGES = ['en', 'hi', 'te', 'ta'];
const NATIVE_LABELS: Record<string, string> = { en: 'English', hi: 'हिन्दी', te: 'తెలుగు', ta: 'தமிழ்' };

export interface CheckCostEstimate {
  estimatedTokens: number;
  /** null when the model's price is unknown — never a guessed figure. */
  estimatedCostUsd: number | null;
  /** null when USD_INR_RATE isn't configured or the price is unknown. */
  estimatedCostInr: number | null;
  costKnown: boolean;
  disclosureText: string;
}

export class AlignmentStreamService {
  private brainRepo: BrainSupplyRepository;
  private certRepo: ModelCertificationRepository;
  private executorFactory: StreamExecutorFactory;
  private activeStreams: Map<string, Array<(event: BrainAlignmentStageEvent) => void>> = new Map();
  private cancelledRuns: Set<string> = new Set();

  constructor(
    brainRepo: BrainSupplyRepository = new BrainSupplyRepository(),
    certRepo: ModelCertificationRepository = new ModelCertificationRepository(),
    executorFactory: StreamExecutorFactory = defaultExecutorFactory
  ) {
    this.brainRepo = brainRepo;
    this.certRepo = certRepo;
    this.executorFactory = executorFactory;
  }

  /**
   * Pre-check token & cost estimate (§18.6.2 Step 3). Tokens come from the actual probe set;
   * cost only when the model's price is known.
   */
  public estimateCheckCost(modelId: string, tiersCount = 4, languagesCount = 3, pricing?: ModelPricing | null): CheckCostEstimate {
    const tiers = ALL_TIERS.slice(0, Math.max(1, Math.min(4, tiersCount)));
    const languages = DEFAULT_LANGUAGES.slice(0, Math.max(1, Math.min(DEFAULT_LANGUAGES.length, languagesCount)));
    const { promptTokens, completionTokens } = estimateRunTokens(tiers, languages);
    const estimatedTokens = promptTokens + completionTokens;

    const estimatedCostUsd = pricing
      ? Number(((promptTokens / 1e6) * pricing.promptPer1M + (completionTokens / 1e6) * pricing.completionPer1M).toFixed(6))
      : null;
    const rate = config.get('USD_INR_RATE');
    const estimatedCostInr = estimatedCostUsd !== null && rate ? Number((estimatedCostUsd * rate).toFixed(2)) : null;

    const costText =
      estimatedCostUsd === null
        ? `the price for '${modelId}' isn't available, so the exact cost will be measured during the run`
        : estimatedCostInr !== null
          ? `≈₹${estimatedCostInr} (≈$${estimatedCostUsd}) at the configured rate of ₹${rate}/USD`
          : `≈$${estimatedCostUsd}`;

    return {
      estimatedTokens,
      estimatedCostUsd,
      estimatedCostInr,
      costKnown: estimatedCostUsd !== null,
      disclosureText: `The alignment check will use approximately ${estimatedTokens.toLocaleString()} tokens (${costText}) from your account.`,
    };
  }

  /** Same as estimateCheckCost, with the model's live OpenRouter price. */
  public async estimateCheckCostLive(modelId: string, provider: string, tiersCount = 4, languagesCount = 3): Promise<CheckCostEstimate> {
    const pricing = await fetchOpenRouterPricing(toCertificationSlug(provider, modelId));
    return this.estimateCheckCost(modelId, tiersCount, languagesCount, pricing);
  }

  /**
   * Starts the staged alignment check (§9.7, §18.6.3) with real-time SSE streaming.
   */
  public async startAlignmentCheck(
    tenantId: string,
    modelId: string,
    modelVersion: string,
    provider: string,
    tiers: CapabilityTier[] = ['T1', 'T2', 'T3', 'T4'],
    languages: string[] = ['en', 'hi', 'te'],
    apiKey?: string
  ): Promise<BrainAlignmentRunRecord> {
    const runId = `align_${modelId.replace(/[^\w.-]/g, '_')}_${Date.now()}`;
    const estimate = this.estimateCheckCost(modelId, tiers.length, languages.length);

    const runRecord: BrainAlignmentRunRecord = {
      id: runId,
      tenantId,
      modelId,
      modelVersion,
      provider,
      status: 'running',
      currentStage: 0,
      stages: {},
      estimatedCostUsd: estimate.estimatedCostUsd ?? 0,
      actualCostUsd: 0.0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await this.brainRepo.createAlignmentRun(runRecord);

    // Launch staged execution asynchronously so the client can stream progress.
    this.executeStagedRun(runRecord, tiers, languages, apiKey).catch(async (err) => {
      logger.error(`[ALIGNMENT STREAM] Run '${runId}' failed with error: ${err.message}`);
      await this.brainRepo.updateAlignmentRun(runId, { status: 'failed', errorMessage: `Run error: ${err.message}` }).catch(() => undefined);
    });

    return runRecord;
  }

  /**
   * Registers an SSE event listener for an active alignment run.
   */
  public subscribeToStream(runId: string, listener: (event: BrainAlignmentStageEvent) => void): () => void {
    if (!this.activeStreams.has(runId)) {
      this.activeStreams.set(runId, []);
    }
    this.activeStreams.get(runId)!.push(listener);

    return () => {
      const listeners = this.activeStreams.get(runId) || [];
      this.activeStreams.set(
        runId,
        listeners.filter((l) => l !== listener)
      );
    };
  }

  /**
   * Cancels a running alignment check (§18.6.3). The engine stops before the next stage,
   * so no further probes are sent.
   */
  public async cancelCheck(runId: string): Promise<boolean> {
    this.cancelledRuns.add(runId);
    await this.brainRepo.updateAlignmentRun(runId, {
      status: 'cancelled',
      errorMessage: 'Alignment check cancelled by admin. No further probes will be sent.',
    });

    logger.info(`[ALIGNMENT STREAM] Run '${runId}' cancelled by admin.`);
    return true;
  }

  private async executeStagedRun(
    run: BrainAlignmentRunRecord,
    tiers: CapabilityTier[],
    languages: string[],
    apiKey?: string
  ): Promise<void> {
    return TenantContextManager.withTenant(run.tenantId, 'default', async () => {
      const runId = run.id;
      const startTime = Date.now();
      const inrRate = config.get('USD_INR_RATE');

      const emit = (event: BrainAlignmentStageEvent) => {
        for (const listener of this.activeStreams.get(runId) || []) {
          try {
            listener(event);
          } catch (e) {
            logger.warn(`Listener error on stream ${runId}`, { e });
          }
        }
      };

      const toEvent = (stage: StageResult, spentUsd: number): BrainAlignmentStageEvent => ({
        runId,
        stage: stage.stage,
        name: stage.name,
        status: stage.status === 'not_run' ? 'skipped' : stage.passed ? 'passed' : 'failed',
        score: stage.score,
        latencyMs: stage.latencyMs,
        details: stage.errorMessage ? { ...stage.details, error: stage.errorMessage } : stage.details,
        elapsedSeconds: Math.floor((Date.now() - startTime) / 1000),
        spentUsdSoFar: spentUsd,
        estimatedSpendInr: inrRate ? Number((spentUsd * inrRate).toFixed(2)) : null,
        timestamp: new Date().toISOString(),
      });

      let executor: ProbeExecutor;
      try {
        executor = this.executorFactory(run, apiKey);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const stage0: StageResult = { stage: 0, name: 'Handshake', passed: false, score: 0, latencyMs: 0, details: {}, errorMessage: message };
        emit(toEvent(stage0, 0));
        await this.brainRepo.updateAlignmentRun(runId, {
          status: 'failed',
          currentStage: 0,
          stages: { stage0_handshake: stage0 },
          errorMessage: `Stage 0 Handshake failed: ${message}`,
        });
        return;
      }

      const result = await runCertification({
        executor,
        tiers,
        languages,
        isCancelled: () => this.cancelledRuns.has(runId),
        onStage: async (_key, stage, spentUsd) => {
          emit(toEvent(stage, spentUsd));
          await this.brainRepo.updateAlignmentRun(runId, { currentStage: stage.stage, actualCostUsd: spentUsd });
        },
      });

      // A cancel that lands after the engine's last check must still win over 'completed'.
      if (result.cancelled || this.cancelledRuns.has(runId)) {
        await this.brainRepo.updateAlignmentRun(runId, { stages: result.stages, actualCostUsd: result.totalCostUsd });
        return;
      }

      if (result.aborted) {
        await this.brainRepo.updateAlignmentRun(runId, {
          status: 'failed',
          currentStage: 0,
          stages: result.stages,
          actualCostUsd: result.totalCostUsd,
          errorMessage: `Stage 0 Handshake failed: ${result.abortReason}`,
        });
        return;
      }

      // Persist certification cells from measured results.
      const now = new Date().toISOString();
      const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
      for (const tier of tiers) {
        for (const lang of languages) {
          const certified = isCellCertified(result, tier, lang);
          await this.certRepo.saveCertification({
            id: `cert_${run.modelId}_${tier}_${lang}`,
            model_id: run.modelId,
            model_version: run.modelVersion,
            provider: run.provider,
            upstream_provider: 'openrouter',
            tier,
            language: lang,
            eval_suite_version: PROBE_SUITE_VERSION,
            status: certified ? 'certified' : 'failed',
            pass_rate: cellPassRate(result, tier, lang),
            latency_p95_ms: result.latencyP95Ms,
            cost_per_task_usd: result.costPerProbeUsd ?? 0,
            stage_results_json: JSON.stringify(result.stages),
            certified_at: certified ? now : null,
            expires_at: certified ? expiresAt : null,
            certified_by: 'kriya_probe_harness',
          });
        }
      }

      const gatesPassed = result.protocolPassed && result.safetyPassed;
      const certifiedTiers = gatesPassed ? result.certifiedTiers : [];
      const certifiedLanguages = gatesPassed ? result.certifiedLanguages : [];
      const workforceImpact = this.buildWorkforceImpact(certifiedTiers, certifiedLanguages);
      const perProbe = result.costPerProbeUsd;

      const reportCard = {
        runId,
        modelId: run.modelId,
        modelVersion: run.modelVersion,
        provider: run.provider,
        overallStatus:
          certifiedTiers.length === 0 ? 'FAILED' : certifiedTiers.length === tiers.length ? 'CERTIFIED' : 'PARTIALLY CERTIFIED',
        checkedAt: now,
        expiresAt,
        suiteVersion: PROBE_SUITE_VERSION,
        probesRun: result.probeCount,
        tierLanguageMatrix: {
          tiers,
          languages,
          matrix: languages.map((lang) => ({
            language: lang,
            nativeLabel: NATIVE_LABELS[lang] ?? lang,
            note: result.languageScores[lang]?.reason,
            scores: tiers.map((tier) => ({
              tier,
              score: cellPassRate(result, tier, lang),
              passed: isCellCertified(result, tier, lang),
            })),
          })),
        },
        protocolSummary: result.protocolPassed
          ? `✓ held the JSON contract (${Math.round((result.stages.stage1_protocol_conformance?.score ?? 0) * 100)}% of probes)`
          : `✗ did not reliably hold the JSON contract (${Math.round((result.stages.stage1_protocol_conformance?.score ?? 0) * 100)}% of probes) — not certified`,
        safetySummary: result.safetyPassed
          ? '✓ resisted injection, did not leak secrets or other customers\' data'
          : '✗ failed at least one safety probe — not certified',
        speedSummary: `p50 ${(result.latencyP50Ms / 1000).toFixed(1)}s · p95 ${(result.latencyP95Ms / 1000).toFixed(1)}s (measured)`,
        costSummary:
          perProbe === null
            ? 'cost per call not reported by provider'
            : `$${perProbe} per probe call (provider-reported)${inrRate ? ` ≈ ₹${(perProbe * inrRate).toFixed(4)}` : ''}`,
        liveFireStatus: 'not run — requires the graph-runtime sandbox',
        workforceImpact,
        certifiedTiers,
        certifiedLanguages,
      };

      await this.brainRepo.updateAlignmentRun(runId, {
        status: 'completed',
        currentStage: 6,
        stages: result.stages,
        actualCostUsd: result.totalCostUsd,
        reportCard,
      });

      await auditLogger.logEvent({
        action: 'brain.alignment_check_completed',
        resourceType: 'brain_alignment',
        resourceId: runId,
        details: {
          tenantId: run.tenantId,
          modelId: run.modelId,
          suite: PROBE_SUITE_VERSION,
          certifiedTiers,
          certifiedLanguages,
          costUsd: result.totalCostUsd,
        },
      });
    });
  }

  /**
   * Builds the plain-language workforce impact summary (§18.6.4).
   */
  public buildWorkforceImpact(
    certifiedTiers: CapabilityTier[],
    certifiedLanguages: string[]
  ): WorkforceImpactSummary {
    const canRun: string[] = [];
    const limited: Array<{ agentName: string; note: string }> = [];
    const cannot: Array<{ agentName: string; requiredTier: CapabilityTier; fallbackPlan: string }> = [];

    // T1 / T2 Agents (Lead Qualification, Support, Booking)
    if (certifiedTiers.includes('T1') && certifiedTiers.includes('T2')) {
      if (certifiedLanguages.includes('en') && certifiedLanguages.includes('hi')) {
        canRun.push('Lead Qualification', 'Customer Support (English, Hindi)', 'Booking Specialist');
      }
      if (!certifiedLanguages.includes('te')) {
        limited.push({
          agentName: 'Customer Support (Telugu)',
          note: 'will draft for approval, not send autonomously',
        });
      }
    } else {
      cannot.push({
        agentName: 'Customer Support Specialist',
        requiredTier: 'T2',
        fallbackPlan: 'degrades to draft_for_approval',
      });
    }

    // T3 / T4 Agents (Orchestrator, Retention, Insights)
    if (!certifiedTiers.includes('T3') || !certifiedTiers.includes('T4')) {
      cannot.push({
        agentName: 'Orchestrator · Retention · Insights',
        requiredTier: 'T3',
        fallbackPlan: 'will use fallback certified T3+ brain, or degrade if none available',
      });
    } else {
      canRun.push('Hierarchical Orchestrator', 'Customer Retention Specialist', 'Business Insights Agent');
    }

    return {
      canRun,
      limited,
      cannot,
    };
  }

  /**
   * Generates a platform proposed brain assignment to agents (§18.6.2 Step 6).
   * Proposes assignments; admin approves. Admin cannot hand-pick models per agent.
   */
  public proposeAssignment(
    brainId: string,
    modelId: string,
    certifiedTiers: CapabilityTier[]
  ): ProposedBrainAssignment {
    const proposals: ProposedBrainAssignment['proposals'] = [];

    if (certifiedTiers.includes('T1')) {
      proposals.push({
        agentSlug: 'lead_qualification_specialist',
        agentName: 'Lead Qualification Specialist',
        targetTier: 'T1',
        action: 'assign',
      });
    }

    if (certifiedTiers.includes('T2')) {
      proposals.push({
        agentSlug: 'customer_support_specialist',
        agentName: 'Customer Support Specialist',
        targetTier: 'T2',
        action: 'assign',
      });
      proposals.push({
        agentSlug: 'booking_specialist',
        agentName: 'Booking Specialist',
        targetTier: 'T2',
        action: 'assign',
      });
    }

    if (certifiedTiers.includes('T3')) {
      proposals.push({
        agentSlug: 'workforce_orchestrator',
        agentName: 'Hierarchical Workforce Orchestrator',
        targetTier: 'T3',
        action: 'assign',
      });
      proposals.push({
        agentSlug: 'retention_specialist',
        agentName: 'Customer Retention Specialist',
        targetTier: 'T3',
        action: 'assign',
      });
    } else {
      proposals.push({
        agentSlug: 'workforce_orchestrator',
        agentName: 'Hierarchical Workforce Orchestrator',
        targetTier: 'T3',
        action: 'retain_incumbent',
      });
    }

    return {
      brainId,
      modelId,
      eligibleAgents: proposals.filter((p) => p.action === 'assign').map((p) => p.agentSlug),
      ineligibleAgents: proposals.filter((p) => p.action !== 'assign').map((p) => p.agentSlug),
      proposals,
    };
  }
}
