/**
 * Xylarc AI — Model Provider Resilience Repository
 * Persistence for model registry, tenant provider policies, and routing audit decisions.
 */

import { BaseRepository } from '../../../storage/repositories/baseRepository.js';
import { DatabaseClient } from '../../../storage/db.js';
import {
  ModelRegistryRecord,
  TenantModelPolicy,
  ModelRoutingDecision,
  ModelStatus,
  RegisterModelRequest,
  UpdateTenantModelPolicyRequest,
} from '../types/modelResilienceTypes.js';
import { CryptoUtils } from '../../../core/utils/crypto.js';

export class ModelResilienceRepository extends BaseRepository<any> {
  protected readonly tableName = 'model_registry';

  constructor(client?: DatabaseClient) {
    super(client);
  }

  public async listRegisteredModels(status?: ModelStatus): Promise<ModelRegistryRecord[]> {
    let query = `SELECT id, provider, model_identifier, display_name, status,
                        context_window_tokens, input_cost_per_1k, output_cost_per_1k,
                        capabilities_json, allowed_data_classifications_json, created_at, updated_at
                 FROM model_registry`;
    const params: unknown[] = [];

    if (status) {
      query += ` WHERE status = ?`;
      params.push(status);
    }
    query += ` ORDER BY provider ASC, display_name ASC;`;

    const rows = await this.client.query<any>(query, params);
    return rows.map((row) => ({
      id: row.id,
      provider: row.provider,
      modelIdentifier: row.model_identifier,
      displayName: row.display_name,
      status: row.status,
      contextWindowTokens: Number(row.context_window_tokens),
      inputCostPer1k: Number(row.input_cost_per_1k),
      outputCostPer1k: Number(row.output_cost_per_1k),
      capabilities: JSON.parse(row.capabilities_json),
      allowedDataClassifications: JSON.parse(row.allowed_data_classifications_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  public async registerModel(request: RegisterModelRequest): Promise<ModelRegistryRecord> {
    const id = `mdl_${CryptoUtils.generateId()}`;
    const now = new Date().toISOString();

    await this.client.execute(
      `INSERT OR REPLACE INTO model_registry
       (id, provider, model_identifier, display_name, status, context_window_tokens, input_cost_per_1k, output_cost_per_1k, capabilities_json, allowed_data_classifications_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        id,
        request.provider,
        request.modelIdentifier,
        request.displayName,
        request.status || 'active',
        request.contextWindowTokens || 128000,
        request.inputCostPer1k,
        request.outputCostPer1k,
        JSON.stringify(request.capabilities),
        JSON.stringify(request.allowedDataClassifications),
        now,
        now,
      ]
    );

    return {
      id,
      provider: request.provider,
      modelIdentifier: request.modelIdentifier,
      displayName: request.displayName,
      status: request.status || 'active',
      contextWindowTokens: request.contextWindowTokens || 128000,
      inputCostPer1k: request.inputCostPer1k,
      outputCostPer1k: request.outputCostPer1k,
      capabilities: request.capabilities as any,
      allowedDataClassifications: request.allowedDataClassifications as any,
      createdAt: now,
      updatedAt: now,
    };
  }

  public async getTenantPolicy(tenantId: string, organizationId = 'default'): Promise<TenantModelPolicy | null> {
    const rows = await this.client.query<any>(
      `SELECT id, tenant_id, organization_id, default_primary_model_id, default_fallback_model_id,
              disallowed_providers_json, max_cost_per_query_usd, require_local_for_confidential, created_at, updated_at
       FROM tenant_model_policies
       WHERE tenant_id = ? AND organization_id = ?;`,
      [tenantId, organizationId]
    );

    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      id: row.id,
      tenantId: row.tenant_id,
      organizationId: row.organization_id,
      defaultPrimaryModelId: row.default_primary_model_id,
      defaultFallbackModelId: row.default_fallback_model_id,
      disallowedProviders: JSON.parse(row.disallowed_providers_json),
      maxCostPerQueryUsd: Number(row.max_cost_per_query_usd),
      requireLocalForConfidential: Boolean(row.require_local_for_confidential),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  public async saveTenantPolicy(
    tenantId: string,
    organizationId: string,
    request: UpdateTenantModelPolicyRequest
  ): Promise<TenantModelPolicy> {
    const id = `tmp_${CryptoUtils.generateId()}`;
    const now = new Date().toISOString();

    await this.client.execute(
      `INSERT OR REPLACE INTO tenant_model_policies
       (id, tenant_id, organization_id, default_primary_model_id, default_fallback_model_id, disallowed_providers_json, max_cost_per_query_usd, require_local_for_confidential, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        id,
        tenantId,
        organizationId,
        request.defaultPrimaryModelId,
        request.defaultFallbackModelId,
        JSON.stringify(request.disallowedProviders),
        request.maxCostPerQueryUsd,
        request.requireLocalForConfidential ? 1 : 0,
        now,
        now,
      ]
    );

    return {
      id,
      tenantId,
      organizationId,
      defaultPrimaryModelId: request.defaultPrimaryModelId,
      defaultFallbackModelId: request.defaultFallbackModelId,
      disallowedProviders: request.disallowedProviders,
      maxCostPerQueryUsd: request.maxCostPerQueryUsd,
      requireLocalForConfidential: request.requireLocalForConfidential,
      createdAt: now,
      updatedAt: now,
    };
  }

  public async logRoutingDecision(
    decision: Omit<ModelRoutingDecision, 'id' | 'createdAt'>
  ): Promise<ModelRoutingDecision> {
    const id = `mrd_${CryptoUtils.generateId()}`;
    const now = new Date().toISOString();

    await this.client.execute(
      `INSERT INTO model_routing_decisions
       (id, tenant_id, organization_id, task_id, task_type, selected_model_id, selected_provider, fallback_occurred, fallback_chain_json, decision_rationale, latency_ms, cost_usd, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        id,
        decision.tenantId,
        decision.organizationId,
        decision.taskId,
        decision.taskType,
        decision.selectedModelId,
        decision.selectedProvider,
        decision.fallbackOccurred ? 1 : 0,
        JSON.stringify(decision.fallbackChain),
        decision.decisionRationale,
        decision.latencyMs,
        decision.costUsd,
        now,
      ]
    );

    return {
      id,
      createdAt: now,
      ...decision,
    };
  }

  public async listRoutingDecisions(tenantId: string, limit = 50): Promise<ModelRoutingDecision[]> {
    const rows = await this.client.query<any>(
      `SELECT id, tenant_id, organization_id, task_id, task_type, selected_model_id, selected_provider,
              fallback_occurred, fallback_chain_json, decision_rationale, latency_ms, cost_usd, created_at
       FROM model_routing_decisions
       WHERE tenant_id = ?
       ORDER BY created_at DESC
       LIMIT ?;`,
      [tenantId, limit]
    );

    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      organizationId: row.organization_id,
      taskId: row.task_id,
      taskType: row.task_type,
      selectedModelId: row.selected_model_id,
      selectedProvider: row.selected_provider,
      fallbackOccurred: Boolean(row.fallback_occurred),
      fallbackChain: JSON.parse(row.fallback_chain_json),
      decisionRationale: row.decision_rationale,
      latencyMs: Number(row.latency_ms),
      costUsd: Number(row.cost_usd),
      createdAt: row.created_at,
    }));
  }

  public async bootstrapDefaultModels(): Promise<void> {
    const defaults: RegisterModelRequest[] = [
      {
        provider: 'google',
        modelIdentifier: 'gemini-2.5-flash',
        displayName: 'Google Gemini 2.5 Flash',
        status: 'active',
        contextWindowTokens: 1000000,
        inputCostPer1k: 0.000075,
        outputCostPer1k: 0.0003,
        capabilities: ['fast_classification', 'standard_reasoning', 'multilingual_translation', 'structured_extraction'],
        allowedDataClassifications: ['public', 'internal', 'confidential', 'restricted'],
      },
      {
        provider: 'google',
        modelIdentifier: 'gemini-2.5-pro',
        displayName: 'Google Gemini 2.5 Pro',
        status: 'active',
        contextWindowTokens: 2000000,
        inputCostPer1k: 0.00125,
        outputCostPer1k: 0.005,
        capabilities: ['complex_orchestration', 'standard_reasoning', 'code_generation', 'reasoning_chain'],
        allowedDataClassifications: ['public', 'internal', 'confidential', 'restricted'],
      },
      {
        provider: 'openai',
        modelIdentifier: 'gpt-4o',
        displayName: 'OpenAI GPT-4o',
        status: 'active',
        contextWindowTokens: 128000,
        inputCostPer1k: 0.0025,
        outputCostPer1k: 0.01,
        capabilities: ['complex_orchestration', 'code_generation', 'standard_reasoning'],
        allowedDataClassifications: ['public', 'internal', 'confidential', 'restricted'],
      },
      {
        provider: 'anthropic',
        modelIdentifier: 'claude-3-7-sonnet',
        displayName: 'Anthropic Claude 3.7 Sonnet',
        status: 'active',
        contextWindowTokens: 200000,
        inputCostPer1k: 0.003,
        outputCostPer1k: 0.015,
        capabilities: ['complex_orchestration', 'reasoning_chain', 'code_generation'],
        allowedDataClassifications: ['public', 'internal', 'confidential', 'restricted'],
      },
      {
        provider: 'deepseek',
        modelIdentifier: 'deepseek-r1',
        displayName: 'DeepSeek R1 Reasoning',
        status: 'active',
        contextWindowTokens: 64000,
        inputCostPer1k: 0.00055,
        outputCostPer1k: 0.00219,
        capabilities: ['reasoning_chain', 'code_generation', 'complex_orchestration'],
        allowedDataClassifications: ['public', 'internal', 'confidential', 'restricted'],
      },
      {
        provider: 'local',
        modelIdentifier: 'llama-3.3-70b-local',
        displayName: 'Llama 3.3 70B On-Premise',
        status: 'active',
        contextWindowTokens: 128000,
        inputCostPer1k: 0.00001,
        outputCostPer1k: 0.00001,
        capabilities: ['fast_classification', 'standard_reasoning', 'structured_extraction'],
        allowedDataClassifications: ['public', 'internal', 'confidential', 'restricted'],
      },
    ];

    for (const model of defaults) {
      await this.registerModel(model);
    }
  }
}
