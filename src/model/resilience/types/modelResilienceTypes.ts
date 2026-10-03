/**
 * Kriya AI — Model Provider Resilience Types & Contracts
 * Provider abstraction, capability matching, fallback chains, and model governance (§10–§14).
 */

import { z } from 'zod';

export type ModelProvider = 'google' | 'openai' | 'anthropic' | 'deepseek' | 'local';

export type ModelStatus = 'active' | 'deprecated' | 'disabled' | 'experimental';

export type DataClassification = 'public' | 'internal' | 'confidential' | 'restricted';

export type ModelCapability =
  | 'fast_classification'
  | 'standard_reasoning'
  | 'complex_orchestration'
  | 'multilingual_translation'
  | 'code_generation'
  | 'structured_extraction'
  | 'reasoning_chain';

export interface ModelRegistryRecord {
  id: string;
  provider: ModelProvider;
  modelIdentifier: string;
  displayName: string;
  status: ModelStatus;
  contextWindowTokens: number;
  inputCostPer1k: number;
  outputCostPer1k: number;
  capabilities: ModelCapability[];
  allowedDataClassifications: DataClassification[];
  createdAt: string;
  updatedAt: string;
}

export interface TenantModelPolicy {
  id: string;
  tenantId: string;
  organizationId: string;
  defaultPrimaryModelId: string;
  defaultFallbackModelId: string;
  disallowedProviders: ModelProvider[];
  maxCostPerQueryUsd: number;
  requireLocalForConfidential: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ModelRoutingDecision {
  id: string;
  tenantId: string;
  organizationId: string;
  taskId: string;
  taskType: string;
  selectedModelId: string;
  selectedProvider: ModelProvider;
  fallbackOccurred: boolean;
  fallbackChain: string[];
  decisionRationale: string;
  latencyMs: number;
  costUsd: number;
  createdAt: string;
}

export interface ModelExecutionRequest {
  taskId: string;
  taskType: ModelCapability;
  prompt: string;
  systemInstruction?: string;
  maxTokens?: number;
  temperature?: number;
  dataClassification?: DataClassification;
  preferredProvider?: ModelProvider;
  maxBudgetUsd?: number;
}

export interface ModelExecutionResponse {
  taskId: string;
  modelIdentifier: string;
  provider: ModelProvider;
  outputContent: string;
  fallbackUsed: boolean;
  fallbackChain: string[];
  promptTokens: number;
  completionTokens: number;
  totalCostUsd: number;
  latencyMs: number;
}

export const RegisterModelRequestSchema = z.object({
  provider: z.enum(['google', 'openai', 'anthropic', 'deepseek', 'local']),
  modelIdentifier: z.string().min(1),
  displayName: z.string().min(1),
  status: z.enum(['active', 'deprecated', 'disabled', 'experimental']).default('active'),
  contextWindowTokens: z.number().int().positive().default(128000),
  inputCostPer1k: z.number().positive(),
  outputCostPer1k: z.number().positive(),
  capabilities: z.array(z.string()).default([]),
  allowedDataClassifications: z.array(z.enum(['public', 'internal', 'confidential', 'restricted'])).default([
    'public',
    'internal',
    'confidential',
    'restricted',
  ]),
});

export type RegisterModelRequest = z.infer<typeof RegisterModelRequestSchema>;

export const UpdateTenantModelPolicyRequestSchema = z.object({
  defaultPrimaryModelId: z.string().min(1),
  defaultFallbackModelId: z.string().min(1),
  disallowedProviders: z.array(z.enum(['google', 'openai', 'anthropic', 'deepseek', 'local'])).default([]),
  maxCostPerQueryUsd: z.number().positive().default(1.0),
  requireLocalForConfidential: z.boolean().default(false),
});

export type UpdateTenantModelPolicyRequest = z.infer<typeof UpdateTenantModelPolicyRequestSchema>;

export const ExecuteWithResilienceRequestSchema = z.object({
  taskId: z.string().min(1),
  taskType: z.enum([
    'fast_classification',
    'standard_reasoning',
    'complex_orchestration',
    'multilingual_translation',
    'code_generation',
    'structured_extraction',
    'reasoning_chain',
  ]),
  prompt: z.string().min(1),
  systemInstruction: z.string().optional(),
  maxTokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  dataClassification: z.enum(['public', 'internal', 'confidential', 'restricted']).default('internal'),
  preferredProvider: z.enum(['google', 'openai', 'anthropic', 'deepseek', 'local']).optional(),
  maxBudgetUsd: z.number().positive().optional(),
});

export type ExecuteWithResilienceRequest = z.infer<typeof ExecuteWithResilienceRequestSchema>;
