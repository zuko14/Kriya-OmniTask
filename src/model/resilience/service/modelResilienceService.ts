/**
 * Xylarc AI — Model Provider Resilience Service
 * High-level orchestration for model execution, dynamic routing, policy enforcement, and audit decision logging.
 */

import { ModelResilienceRepository } from '../repositories/modelResilienceRepository.js';
import { DynamicModelRouter } from '../router/dynamicModelRouter.js';
import { ModelFallbackManager } from '../fallback/modelFallbackManager.js';
import {
  ModelRegistryRecord,
  TenantModelPolicy,
  ModelRoutingDecision,
  RegisterModelRequest,
  UpdateTenantModelPolicyRequest,
  ExecuteWithResilienceRequest,
  ModelExecutionResponse,
  ModelStatus,
} from '../types/modelResilienceTypes.js';
import { TenantContextManager } from '../../../core/context/tenantContext.js';

export class ModelResilienceService {
  private repo = new ModelResilienceRepository();
  private fallbackManager = new ModelFallbackManager();

  public async listRegisteredModels(status?: ModelStatus): Promise<ModelRegistryRecord[]> {
    return this.repo.listRegisteredModels(status);
  }

  public async registerModel(request: RegisterModelRequest): Promise<ModelRegistryRecord> {
    return this.repo.registerModel(request);
  }

  public async getTenantPolicy(): Promise<TenantModelPolicy | null> {
    const tenantId = TenantContextManager.getTenantId();
    const orgId = TenantContextManager.getRequired().organizationId || 'default';
    return this.repo.getTenantPolicy(tenantId, orgId);
  }

  public async updateTenantPolicy(request: UpdateTenantModelPolicyRequest): Promise<TenantModelPolicy> {
    const tenantId = TenantContextManager.getTenantId();
    const orgId = TenantContextManager.getRequired().organizationId || 'default';
    return this.repo.saveTenantPolicy(tenantId, orgId, request);
  }

  /**
   * Executes a model task with full dynamic routing and automated multi-tier fallback.
   */
  public async executeWithResilience(
    request: ExecuteWithResilienceRequest,
    options?: { mockFailures?: string[] }
  ): Promise<ModelExecutionResponse> {
    const tenantId = TenantContextManager.getTenantId();
    const orgId = TenantContextManager.getRequired().organizationId || 'default';

    // 1. Fetch available models and tenant policy
    let availableModels = await this.repo.listRegisteredModels('active');
    if (availableModels.length === 0) {
      await this.repo.bootstrapDefaultModels();
      availableModels = await this.repo.listRegisteredModels('active');
    }

    const policy = await this.repo.getTenantPolicy(tenantId, orgId);

    // 2. Formulate routing plan
    const routingPlan = DynamicModelRouter.formulateRoutingPlan(availableModels, policy, request);

    // 3. Execute with fallback failover
    const response = await this.fallbackManager.executeWithResilience(routingPlan, request, options);

    // 4. Log routing decision audit
    await this.repo.logRoutingDecision({
      tenantId,
      organizationId: orgId,
      taskId: request.taskId,
      taskType: request.taskType,
      selectedModelId: response.modelIdentifier,
      selectedProvider: response.provider,
      fallbackOccurred: response.fallbackUsed,
      fallbackChain: response.fallbackChain,
      decisionRationale: routingPlan.rationale,
      latencyMs: response.latencyMs,
      costUsd: response.totalCostUsd,
    });

    return response;
  }

  public async listRoutingDecisions(limit = 50): Promise<ModelRoutingDecision[]> {
    const tenantId = TenantContextManager.getTenantId();
    return this.repo.listRoutingDecisions(tenantId, limit);
  }

  public async bootstrapDefaults(): Promise<void> {
    await this.repo.bootstrapDefaultModels();
  }
}
