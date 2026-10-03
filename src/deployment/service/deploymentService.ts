/**
 * Kriya AI — Deployment & Release Service
 * Orchestrates automated CI/CD release gates, canary traffic shifting, dynamic feature flags, and zero-downtime schema migrations.
 */

import { CryptoUtils } from '../../core/utils/crypto.js';
import { DeploymentRepository } from '../repositories/deploymentRepository.js';
import { DeploymentGateEvaluator } from '../gates/deploymentGateEvaluator.js';
import { FeatureFlagEngine } from '../flags/featureFlagEngine.js';
import { CanaryTrafficShifter, CanaryHealthMetrics } from '../canary/canaryTrafficShifter.js';
import { CanaryRoutingEngine, CanaryRouteDecision, TelemetryEvaluationResult } from '../canary/canaryRoutingEngine.js';
import { OneStepRollbackEngine } from '../rollback/oneStepRollbackEngine.js';
import { ApiVersionManager, VersionNegotiationResult } from '../versioning/apiVersionManager.js';
import { DataResidencyEngine, ResidencyValidationResult, IndiaHostingBlueprint } from '../residency/dataResidencyEngine.js';
import { SchemaTransitionManager } from '../schema/schemaTransitionManager.js';
import { AttentionService } from '../../attention/service/attentionService.js';
import { ProofService } from '../../trust/proof/proofService.js';
import {
  ReleaseDeployment,
  FeatureFlag,
  FeatureFlagContext,
  SchemaTransition,
  SchemaTransitionPhase,
  GateEvaluationInput,
  DeploymentEnvironment,
  ApiVersionRegistration,
  RegisterApiVersionInput,
  CanaryRoutingConfig,
  CanaryTelemetrySnapshot,
  IngestCanaryTelemetryInput,
  DeploymentRollbackEvent,
  ExecuteRollbackInput,
  RollbackExecutionResult,
  DataResidencyConfig,
  UpsertDataResidencyInput,
  ValidateResidencyRequestInput,
} from '../types/deploymentTypes.js';
import { NotFoundError, ValidationError } from '../../core/errors/errors.js';
import { logger } from '../../core/logger/logger.js';

export class DeploymentService {
  private rollbackEngine: OneStepRollbackEngine;
  private apiVersionManager: ApiVersionManager;
  private dataResidencyEngine: DataResidencyEngine;

  constructor(
    private repo: DeploymentRepository,
    private attentionService?: AttentionService,
    private proofService?: ProofService
  ) {
    this.rollbackEngine = new OneStepRollbackEngine(repo, attentionService, proofService);
    this.apiVersionManager = new ApiVersionManager(repo);
    this.dataResidencyEngine = new DataResidencyEngine(repo);
  }

  // 1. Deployments & Quality Gates
  public async createDeployment(
    versionTag: string,
    environment: DeploymentEnvironment = 'production',
    deployedBy: string,
    gateInput?: GateEvaluationInput
  ): Promise<ReleaseDeployment> {
    const id = `dep_${CryptoUtils.generateId()}`;
    const now = new Date().toISOString();

    const gateEvaluation = gateInput
      ? DeploymentGateEvaluator.evaluate(gateInput)
      : { verdict: 'approved' as const, scorePct: 100, checks: [], notes: ['Manual deployment without gate evaluation.'] };

    const deployment: ReleaseDeployment = {
      id,
      versionTag,
      environment,
      status: 'pending',
      canaryWeightPct: 0,
      gateVerdict: gateEvaluation.verdict,
      gateDetails: {
        scorePct: gateEvaluation.scorePct,
        checks: gateEvaluation.checks,
        notes: gateEvaluation.notes,
      },
      deployedBy,
      createdAt: now,
    };

    await this.repo.saveDeployment(deployment);
    logger.info(`Registered deployment ${deployment.id} (Version: ${versionTag}, Verdict: ${deployment.gateVerdict})`);
    return deployment;
  }

  public async setCanaryTrafficWeight(
    deploymentId: string,
    targetWeightPct: number,
    telemetry?: CanaryHealthMetrics
  ): Promise<{ deployment: ReleaseDeployment; evaluationAction: string; reason: string }> {
    const deployment = await this.repo.getDeploymentById(deploymentId);
    if (!deployment) {
      throw new NotFoundError(`Deployment ${deploymentId} not found`);
    }

    if (telemetry) {
      const evaluation = CanaryTrafficShifter.evaluateCanaryHealth(deployment.canaryWeightPct, telemetry);
      if (evaluation.action === 'rollback') {
        await this.repo.updateDeploymentStatus(deploymentId, 'rolled_back');
        const updated = (await this.repo.getDeploymentById(deploymentId))!;
        logger.warn(`Canary automated rollback triggered for deployment ${deploymentId}: ${evaluation.reason}`);
        return { deployment: updated, evaluationAction: 'rollback', reason: evaluation.reason };
      }
    }

    await this.repo.updateCanaryWeight(deploymentId, targetWeightPct);
    const updated = (await this.repo.getDeploymentById(deploymentId))!;
    logger.info(`Updated canary weight for deployment ${deploymentId} to ${targetWeightPct}%`);
    return {
      deployment: updated,
      evaluationAction: targetWeightPct === 100 ? 'promoted' : 'advance',
      reason: `Canary traffic weight adjusted to ${targetWeightPct}%.`,
    };
  }

  public async promoteDeployment(deploymentId: string): Promise<ReleaseDeployment> {
    const deployment = await this.repo.getDeploymentById(deploymentId);
    if (!deployment) {
      throw new NotFoundError(`Deployment ${deploymentId} not found`);
    }

    await this.repo.updateDeploymentStatus(deploymentId, 'promoted');
    logger.info(`Promoted deployment ${deploymentId} to 100% production traffic`);
    return (await this.repo.getDeploymentById(deploymentId))!;
  }

  public async rollbackDeployment(deploymentId: string): Promise<ReleaseDeployment> {
    const deployment = await this.repo.getDeploymentById(deploymentId);
    if (!deployment) {
      throw new NotFoundError(`Deployment ${deploymentId} not found`);
    }

    await this.repo.updateDeploymentStatus(deploymentId, 'rolled_back');
    logger.warn(`Rolled back deployment ${deploymentId}`);
    return (await this.repo.getDeploymentById(deploymentId))!;
  }

  public async listDeployments(environment?: string, limit = 50): Promise<ReleaseDeployment[]> {
    return this.repo.listDeployments(environment, limit);
  }

  // 2. Feature Flags
  public async upsertFeatureFlag(params: {
    flagKey: string;
    name: string;
    description?: string;
    isEnabled?: boolean;
    allowedTenants?: string[];
    allowedRoles?: string[];
    rolloutPct?: number;
  }): Promise<FeatureFlag> {
    const existing = await this.repo.getFeatureFlagByKey(params.flagKey);
    const now = new Date().toISOString();

    const flag: FeatureFlag = {
      id: existing?.id || `ff_${CryptoUtils.generateId()}`,
      flagKey: params.flagKey,
      name: params.name,
      description: params.description ?? existing?.description,
      isEnabled: params.isEnabled ?? existing?.isEnabled ?? false,
      allowedTenants: params.allowedTenants ?? existing?.allowedTenants ?? [],
      allowedRoles: params.allowedRoles ?? existing?.allowedRoles ?? [],
      rolloutPct: params.rolloutPct ?? existing?.rolloutPct ?? 0,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    await this.repo.saveFeatureFlag(flag);
    logger.info(`Saved feature flag '${flag.flagKey}' (Enabled: ${flag.isEnabled}, Rollout: ${flag.rolloutPct}%)`);
    return flag;
  }

  public async evaluateFeatureFlag(flagKey: string, context: FeatureFlagContext = {}): Promise<{ flagKey: string; isEnabled: boolean }> {
    const flag = await this.repo.getFeatureFlagByKey(flagKey);
    if (!flag) {
      return { flagKey, isEnabled: false };
    }

    const isEnabled = FeatureFlagEngine.isEnabled(flag, context);
    return { flagKey, isEnabled };
  }

  public async listFeatureFlags(): Promise<FeatureFlag[]> {
    return this.repo.listFeatureFlags();
  }

  public async deleteFeatureFlag(id: string): Promise<void> {
    await this.repo.deleteFeatureFlag(id);
    logger.info(`Deleted feature flag ${id}`);
  }

  // 3. Schema Transitions
  public async triggerSchemaTransition(
    tableName: string,
    version: string,
    phase: SchemaTransitionPhase,
    details: Record<string, unknown> = {}
  ): Promise<SchemaTransition> {
    const latest = await this.repo.getLatestTransitionForTable(tableName);
    const isLegal = SchemaTransitionManager.validateProgression(latest?.phase ?? null, phase);

    if (!isLegal) {
      throw new ValidationError(
        `Illegal schema transition for table '${tableName}': Cannot transition from '${latest?.phase ?? 'none'}' to '${phase}'. Transitions must follow Expand -> Migrate -> Contract.`
      );
    }

    const stepPlan = SchemaTransitionManager.getStepPlan(tableName, version, phase);
    const transitionId = `st_${CryptoUtils.generateId()}`;
    const now = new Date().toISOString();

    const transition: SchemaTransition = {
      id: transitionId,
      tableName,
      version,
      phase,
      status: 'completed',
      details: {
        ...details,
        instructions: stepPlan.instructions,
        safetyGuarantees: stepPlan.safetyGuarantees,
      },
      createdAt: now,
      completedAt: now,
    };

    await this.repo.saveSchemaTransition(transition);
    logger.info(`Executed schema transition ${transition.id} for table '${tableName}' (Phase: ${phase}, Version: ${version})`);
    return transition;
  }

  public async listSchemaTransitions(tableName?: string): Promise<SchemaTransition[]> {
    return this.repo.listSchemaTransitions(tableName);
  }

  // 4. One-Step Rollback Automation
  public async executeInstantRollback(
    deploymentId: string,
    input: ExecuteRollbackInput
  ): Promise<RollbackExecutionResult> {
    return this.rollbackEngine.executeRollback(deploymentId, input);
  }

  public async listRollbackEvents(deploymentId?: string, limit = 50): Promise<DeploymentRollbackEvent[]> {
    return this.repo.listRollbackEvents(deploymentId, limit);
  }

  // 5. Canary Routing & Phased Progression Engine
  public async routeTenantForCanary(deploymentId: string, tenantId: string): Promise<CanaryRouteDecision> {
    const deployment = await this.repo.getDeploymentById(deploymentId);
    if (!deployment) {
      throw new NotFoundError(`Deployment '${deploymentId}' not found.`);
    }

    return CanaryRoutingEngine.routeTenant(tenantId, deployment.canaryWeightPct);
  }

  public async evaluateAndIngestCanaryTelemetry(
    input: IngestCanaryTelemetryInput
  ): Promise<{
    snapshot: CanaryTelemetrySnapshot;
    evaluation: TelemetryEvaluationResult;
    rollbackResult?: RollbackExecutionResult;
  }> {
    const deployment = await this.repo.getDeploymentById(input.deploymentId);
    if (!deployment) {
      throw new NotFoundError(`Deployment '${input.deploymentId}' not found.`);
    }

    const errorRatePct = input.totalRequests > 0
      ? Number(((input.errorCount / input.totalRequests) * 100).toFixed(2))
      : 0;

    const evaluation = CanaryRoutingEngine.evaluateTelemetry(deployment.canaryWeightPct, {
      errorRatePct,
      p99LatencyMs: input.p99LatencyMs,
      maxAllowedErrorRatePct: 1.0,
      maxAllowedP99LatencyMs: 1500,
    });

    const snapshotId = `tel_${CryptoUtils.generateId()}`;
    const now = new Date().toISOString();

    const snapshot: CanaryTelemetrySnapshot = {
      id: snapshotId,
      deploymentId: input.deploymentId,
      sampleWindowSeconds: input.sampleWindowSeconds,
      totalRequests: input.totalRequests,
      errorCount: input.errorCount,
      errorRatePct,
      p95LatencyMs: input.p95LatencyMs,
      p99LatencyMs: input.p99LatencyMs,
      verdict: evaluation.verdict,
      actionTaken: evaluation.action,
      reason: evaluation.reason,
      evaluatedAt: now,
    };

    await this.repo.saveCanaryTelemetrySnapshot(snapshot);

    let rollbackResult: RollbackExecutionResult | undefined;
    if (evaluation.action === 'rollback') {
      logger.warn(`Canary telemetry tripwire breached for deployment '${input.deploymentId}'. Initiating instant rollback.`);
      rollbackResult = await this.rollbackEngine.executeRollback(input.deploymentId, {
        rollbackType: 'automated_telemetry',
        reason: evaluation.reason,
        executedBy: 'automated_canary_guardian',
      });
    } else if (evaluation.action === 'advance' && evaluation.recommendedWeightPct !== deployment.canaryWeightPct) {
      await this.repo.updateCanaryWeight(input.deploymentId, evaluation.recommendedWeightPct);
      logger.info(`Advancing canary weight for deployment '${input.deploymentId}' to ${evaluation.recommendedWeightPct}%.`);
    }

    return {
      snapshot,
      evaluation,
      rollbackResult,
    };
  }

  public async listCanaryTelemetrySnapshots(
    deploymentId: string,
    limit = 50
  ): Promise<CanaryTelemetrySnapshot[]> {
    return this.repo.listCanaryTelemetrySnapshots(deploymentId, limit);
  }

  // 6. API Versioning & Contract-Locked Gate
  public async registerApiVersion(input: RegisterApiVersionInput): Promise<ApiVersionRegistration> {
    return this.apiVersionManager.registerApiVersion(input);
  }

  public async validateClientContract(
    apiVersion: string,
    clientVersionHeader?: string
  ): Promise<VersionNegotiationResult> {
    return this.apiVersionManager.validateClientContract(apiVersion, clientVersionHeader);
  }

  public async listApiVersions(status?: string): Promise<ApiVersionRegistration[]> {
    return this.apiVersionManager.listVersions(status);
  }

  // 7. Data Residency & India Sovereign Hosting
  public async upsertDataResidency(
    tenantId: string,
    input: UpsertDataResidencyInput
  ): Promise<DataResidencyConfig> {
    return this.dataResidencyEngine.upsertResidencyConfig(tenantId, input);
  }

  public async getDataResidency(tenantId: string): Promise<DataResidencyConfig> {
    return this.dataResidencyEngine.getResidencyConfig(tenantId);
  }

  public async validateDataResidency(
    tenantId: string,
    input: ValidateResidencyRequestInput
  ): Promise<ResidencyValidationResult> {
    return this.dataResidencyEngine.validateOperation(
      tenantId,
      input.targetRegion,
      input.isLlmInference,
      input.crossBorderTransfer
    );
  }

  public getIndiaHostingBlueprint(): IndiaHostingBlueprint {
    return DataResidencyEngine.getIndiaHostingBlueprint();
  }
}

