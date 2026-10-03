/**
 * Kriya AI — Model Provider Resilience Service (WP-1.1b Consolidated)
 * High-level orchestration for model execution, dynamic routing, policy enforcement, and audit decision logging.
 *
 * Fully consolidated to route execution through the unified ModelGateway (docs/kriya WP-1.1b, ADR-005).
 */

import { ModelResilienceRepository } from '../repositories/modelResilienceRepository.js';
import { ModelGateway } from '../../gateway/modelGateway.js';
import { CapabilityTier } from '../../certification/certificationTypes.js';
import {
  ModelRegistryRecord,
  TenantModelPolicy,
  ModelRoutingDecision,
  RegisterModelRequest,
  UpdateTenantModelPolicyRequest,
  ExecuteWithResilienceRequest,
  ModelExecutionResponse,
  ModelStatus,
  ModelProvider,
} from '../types/modelResilienceTypes.js';
import { TenantContextManager } from '../../../core/context/tenantContext.js';
import { DeterministicLLMAdapter } from '../../../orchestration/routing/modelRouter.js';
import { OpenRouterAdapter } from '../../gateway/openRouterAdapter.js';
import { isSandboxMode } from '../../../core/config/runtimeMode.js';
import { config } from '../../../core/config/config.js';

export class ModelResilienceService {
  private repo: ModelResilienceRepository;
  private gateway: ModelGateway;

  constructor(repo?: ModelResilienceRepository, gateway?: ModelGateway) {
    this.repo = repo ?? new ModelResilienceRepository();
    this.gateway = gateway ?? new ModelGateway();
  }

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
   * Executes a model task via the consolidated ModelGateway with audit logging (WP-1.1b).
   */
  public async executeWithResilience(
    request: ExecuteWithResilienceRequest,
    options?: { mockFailures?: string[] }
  ): Promise<ModelExecutionResponse> {
    const tenantId = TenantContextManager.getTenantId();
    const orgId = TenantContextManager.getRequired().organizationId || 'default';

    // 1. Fetch tenant policy
    const policy = await this.repo.getTenantPolicy(tenantId, orgId);

    // 2. Select gateway instance (with mock failure drill support if provided)
    let gateway = this.gateway;
    if (options?.mockFailures && options.mockFailures.length > 0) {
      gateway = new ModelGateway({
        adapterFor: (candidate, apiKey) => {
          if (options.mockFailures!.includes(candidate.modelId)) {
            return {
              execute: async () => {
                throw new Error(`Mocked resilience failure for model '${candidate.modelId}'`);
              },
            };
          }
          if (candidate.source === 'sandbox_uncertified' || isSandboxMode()) return new DeterministicLLMAdapter();
          return new OpenRouterAdapter({ apiKey: apiKey ?? config.get('OPENROUTER_API_KEY') });
        },
      });
    }

    const tier = mapTaskTypeToTier(request.taskType);
    const primaryHint = policy?.defaultPrimaryModelId;

    // 3. Execute through the unified ModelGateway
    const result = await gateway.complete({
      tenantId,
      taskId: request.taskId,
      tier,
      systemPrompt: request.systemInstruction || 'You are an AI assistant in Kriya Omnitask.',
      userPrompt: request.prompt,
      temperature: request.temperature,
      maxTokens: request.maxTokens,
      sandboxModelHint: primaryHint,
      isCritical: request.dataClassification === 'restricted' || request.taskType === 'complex_orchestration',
    });

    const candidateIndex = result.selection.candidates.findIndex((c) => c.modelId === result.modelUsed);
    const fallbackUsed = result.selection.degraded || candidateIndex > 0;
    const fallbackChain = result.selection.candidates.map((c) => c.modelId);
    const provider = mapModelToProvider(result.modelUsed);

    const response: ModelExecutionResponse = {
      taskId: request.taskId,
      modelIdentifier: result.modelUsed,
      provider,
      outputContent: result.content,
      fallbackUsed,
      fallbackChain,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      totalCostUsd: result.costUsd > 0 ? result.costUsd : 0.0001,
      latencyMs: result.durationMs,
    };

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
      decisionRationale: `Consolidated ModelGateway routing via ${result.selection.source} at tier ${result.selection.tierUsed}`,
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

function mapTaskTypeToTier(taskType: string): CapabilityTier {
  switch (taskType) {
    case 'fast_classification':
    case 'structured_extraction':
      return 'T1';
    case 'standard_reasoning':
    case 'multilingual_translation':
      return 'T2';
    case 'code_generation':
    case 'reasoning_chain':
      return 'T3';
    case 'complex_orchestration':
      return 'T4';
    default:
      return 'T2';
  }
}

function mapModelToProvider(modelId: string): ModelProvider {
  const lower = modelId.toLowerCase();
  if (lower.startsWith('deepseek') || lower.includes('deepseek')) return 'deepseek';
  if (lower.startsWith('gemini') || lower.includes('google')) return 'google';
  if (lower.startsWith('claude') || lower.includes('anthropic')) return 'anthropic';
  if (lower.startsWith('gpt') || lower.includes('openai')) return 'openai';
  return 'local';
}
