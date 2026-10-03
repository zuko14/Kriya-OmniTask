/**
 * Kriya Omnitask — Model Gateway (docs/kriya WP-1.1, WP-1.3; ADR-005)
 *
 * The ONE entry point for agent model calls. Every call:
 *   1. refuses before spending if the tenant's brain supply is paused or out of budget;
 *   2. selects a model that holds a valid, unexpired certification cell for (tier × language):
 *        a. the owner's chosen brains first (assigned-to-this-agent first), with their BYO key;
 *        b. only if the tenant's supply mode is 'managed': the platform's certified models,
 *           via the degradation ladder (route-up / reduce-autonomy / escalate);
 *        c. otherwise it escalates — it never silently uses an uncertified model;
 *   3. executes with fallback across the certified candidates;
 *   4. when a schema is given, validates the reply and allows exactly ONE repair attempt,
 *      then fails with StructuredOutputError (never default-fills a result).
 *
 * Sandbox/test mode only: if nothing is certified, the agent's configured model is used through
 * the simulated adapter and the result is labelled `selection.source = 'sandbox_uncertified'`.
 */

import { ZodTypeAny, z } from 'zod';
import { CapabilityTier, DegradationResolution } from '../certification/certificationTypes.js';
import { ModelCertificationRepository } from '../certification/modelCertificationRepository.js';
import { CertifiedModelRouter } from '../certification/certifiedModelRouter.js';
import { BrainSupplyRepository } from '../brain/repositories/brainSupplyRepository.js';
import { TenantBrainRecord } from '../brain/types/brainSupplyTypes.js';
import { CredentialVault } from '../../tools/vault/credentialVault.js';
import { ModelRouter, LLMProviderAdapter, CostSource, DeterministicLLMAdapter } from '../../orchestration/routing/modelRouter.js';
import { OpenRouterAdapter } from './openRouterAdapter.js';
import { parseJsonObject } from './jsonOutput.js';
import { isSandboxMode, NotConfiguredError } from '../../core/config/runtimeMode.js';
import { config } from '../../core/config/config.js';
import { logger } from '../../core/logger/logger.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import { TenantIsolationError } from '../../core/errors/errors.js';
import { SpendBudgetAnomalyEngine } from '../brain/services/spendBudgetAnomalyEngine.js';
import { CostRepository } from '../../cost/repositories/costRepository.js';
import { calculateTokenCost, estimateMaxCost, inferProviderFromModelId } from './pricing.js';
import { CryptoUtils } from '../../core/utils/crypto.js';

export class GatewayRefusedError extends Error {
  public readonly code = 'MODEL_GATEWAY_REFUSED';
}

export class GatewayEscalationError extends Error {
  public readonly code = 'MODEL_GATEWAY_ESCALATED';
  constructor(message: string, public readonly degradation?: DegradationResolution) {
    super(message);
  }
}

export class StructuredOutputError extends Error {
  public readonly code = 'STRUCTURED_OUTPUT_INVALID';
  constructor(message: string, public readonly rawContent: string, public readonly issues: string) {
    super(message);
  }
}

export interface GatewayRequest<S extends ZodTypeAny | undefined = undefined> {
  tenantId: string;
  taskId: string;
  tier: CapabilityTier;
  language?: string;
  agentSlug?: string;
  systemPrompt: string;
  userPrompt: string;
  contextData?: Record<string, unknown>;
  schema?: S;
  temperature?: number;
  maxTokens?: number;
  /** Agent's configured model, used ONLY by the sandbox path when nothing is certified. */
  sandboxModelHint?: string;
  /** True if task is critical, permitted when spend ladder is restricted to critical_only (95%). */
  isCritical?: boolean;
}

export interface ModelCandidate {
  modelId: string;
  source: 'tenant_brain' | 'platform_certified' | 'sandbox_uncertified';
  brainId?: string;
  credentialSlug?: string;
}

export interface GatewaySelection {
  candidates: ModelCandidate[];
  tierUsed: CapabilityTier;
  degraded: boolean;
  degradation?: DegradationResolution;
  /** True when the ladder reduced autonomy: the output is a draft for human approval. */
  requiresApproval: boolean;
  source: ModelCandidate['source'];
}

export interface GatewayResult<T = unknown> {
  content: string;
  parsed: T | undefined;
  modelUsed: string;
  selection: GatewaySelection;
  repairAttempted: boolean;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  costSource: CostSource;
  durationMs: number;
}

export interface ModelGatewayDeps {
  brainRepo?: BrainSupplyRepository;
  certRepo?: ModelCertificationRepository;
  certifiedRouter?: CertifiedModelRouter;
  vault?: CredentialVault;
  spendAnomalyEngine?: SpendBudgetAnomalyEngine;
  costRepo?: CostRepository;
  /** Builds the execution adapter for a candidate (tests inject one). */
  adapterFor?: (candidate: ModelCandidate, apiKey?: string) => LLMProviderAdapter;
}

const MAX_CANDIDATES = 3;

export class ModelGateway {
  private brainRepo: BrainSupplyRepository;
  private certRepo: ModelCertificationRepository;
  private certifiedRouter: CertifiedModelRouter;
  private vault: CredentialVault;
  private spendAnomalyEngine: SpendBudgetAnomalyEngine;
  private costRepo: CostRepository;
  private adapterFor: (candidate: ModelCandidate, apiKey?: string) => LLMProviderAdapter;

  constructor(deps: ModelGatewayDeps = {}) {
    this.brainRepo = deps.brainRepo ?? new BrainSupplyRepository();
    this.certRepo = deps.certRepo ?? new ModelCertificationRepository();
    this.certifiedRouter = deps.certifiedRouter ?? new CertifiedModelRouter(this.certRepo);
    this.vault = deps.vault ?? new CredentialVault();
    this.spendAnomalyEngine = deps.spendAnomalyEngine ?? new SpendBudgetAnomalyEngine(this.brainRepo);
    this.costRepo = deps.costRepo ?? new CostRepository();
    this.adapterFor = deps.adapterFor ?? defaultAdapterFor;
  }

  public async complete<S extends ZodTypeAny | undefined = undefined>(
    req: GatewayRequest<S>
  ): Promise<GatewayResult<S extends ZodTypeAny ? z.infer<S> : undefined>> {
    // S31: Explicit assertion that caller's active tenant context matches the requested tenant
    const activeTenant = TenantContextManager.get()?.tenantId;
    if (activeTenant && activeTenant !== req.tenantId) {
      throw new TenantIsolationError(
        `Tenant mismatch in ModelGateway: active tenant context '${activeTenant}' does not match request tenant '${req.tenantId}'.`
      );
    }

    const start = Date.now();
    const selection = await this.selectModel(req);

    // Pre-call spend budget evaluation (WP-1.4; Blueprint §18)
    const spendStatus = await this.spendAnomalyEngine.evaluateSpendStatus(req.tenantId, 0);
    if (spendStatus.actionTaken === 'stop_execution' || spendStatus.utilizationPercentage >= 100) {
      throw new GatewayRefusedError(
        `Tenant monthly spend budget is 100% exhausted ($${spendStatus.currentMonthSpendUsd.toFixed(2)} / $${spendStatus.monthlyBudgetUsd.toFixed(2)}). Model execution refused before request.`
      );
    }
    if (spendStatus.actionTaken === 'critical_only' && !req.isCritical) {
      throw new GatewayRefusedError(
        `Spend budget restricted to critical tasks only (95% utilization reached: $${spendStatus.currentMonthSpendUsd.toFixed(2)} / $${spendStatus.monthlyBudgetUsd.toFixed(2)}). Task '${req.taskId}' refused.`
      );
    }
    const primaryCandidate = selection.candidates[0]?.modelId;
    const estimatedCost = primaryCandidate
      ? estimateMaxCost(primaryCandidate, (req.systemPrompt.length + req.userPrompt.length) / 4, req.maxTokens ?? 1000)
      : 0.001;
    if (spendStatus.currentMonthSpendUsd + estimatedCost > spendStatus.monthlyBudgetUsd) {
      throw new GatewayRefusedError(
        `Projected call cost ($${estimatedCost.toFixed(4)}) would exceed monthly budget ($${spendStatus.monthlyBudgetUsd.toFixed(2)}). Model execution refused before request.`
      );
    }

    let lastError: unknown;
    for (const candidate of selection.candidates) {
      let apiKey: string | undefined;
      if (candidate.credentialSlug) {
        // S31: Credential vault reads require active matching tenant context
        const ctxTenant = TenantContextManager.get()?.tenantId;
        if (!ctxTenant || ctxTenant !== req.tenantId) {
          throw new TenantIsolationError(
            `Tenant context required to access vault credential for brain '${candidate.brainId}'. Active context: '${ctxTenant ?? 'none'}', request: '${req.tenantId}'.`
          );
        }
        const secret = await this.vault.getSecret<{ apiKey?: string }>(candidate.credentialSlug);
        apiKey = secret?.apiKey;
        if (!apiKey) {
          lastError = new NotConfiguredError(`Brain '${candidate.brainId}'`, 'its stored key could not be read from the vault.');
          continue;
        }
      }

      try {
        const router = new ModelRouter(this.adapterFor(candidate, apiKey));
        const result = await this.callWithRepair(router, candidate.modelId, req);
        const durationMs = Date.now() - start;

        // Post-call budget settlement & anomaly tracking (WP-1.4)
        try {
          await this.spendAnomalyEngine.evaluateSpendStatus(req.tenantId, result.costUsd);
        } catch (spendErr) {
          logger.warn(`Failed to update spend status for tenant '${req.tenantId}': ${spendErr instanceof Error ? spendErr.message : String(spendErr)}`);
        }

        // Cost attribution record persistence (WP-1.4)
        try {
          const activeOrg = TenantContextManager.get()?.organizationId || 'default';
          await this.costRepo.insertCostRecord({
            id: `cost_${CryptoUtils.generateId()}`,
            tenantId: req.tenantId,
            organizationId: activeOrg,
            agentId: req.agentSlug || 'omnitask_gateway',
            taskId: req.taskId,
            costCategory: 'token_llm',
            provider: inferProviderFromModelId(candidate.modelId) as any,
            resourceMetricName: 'tokens',
            resourceQuantity: result.promptTokens + result.completionTokens,
            unitCostUsd: (result.promptTokens + result.completionTokens) > 0
              ? result.costUsd / (result.promptTokens + result.completionTokens)
              : 0,
            totalCostUsd: result.costUsd,
            createdAt: new Date().toISOString(),
          });
        } catch (costErr) {
          logger.warn(`Failed to log cost attribution record for task '${req.taskId}': ${costErr instanceof Error ? costErr.message : String(costErr)}`);
        }

        return { ...result, modelUsed: candidate.modelId, selection, durationMs } as GatewayResult<any>;
      } catch (err) {
        // A schema failure is the model's answer, not an outage: don't burn other models on it.
        if (err instanceof StructuredOutputError) throw err;
        lastError = err;
        logger.warn(`Model gateway: candidate '${candidate.modelId}' failed; trying next certified candidate`, {
          taskId: req.taskId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    throw lastError instanceof Error ? lastError : new Error('All certified model candidates failed.');
  }

  /** Chooses certified candidates for the request without executing anything. */
  public async selectModel(req: GatewayRequest<any>): Promise<GatewaySelection> {
    const language = req.language ?? 'en';
    const brainConfig = await this.brainRepo.getTenantBrainConfig(req.tenantId);
    if (brainConfig.status !== 'active') {
      throw new GatewayRefusedError(`Model calls are paused for this tenant (brain status: ${brainConfig.status}).`);
    }

    // a. Owner-chosen brains that hold a valid certification for this tier × language.
    const brains = (await this.brainRepo.listTenantBrains(req.tenantId))
      .filter((b) => b.status === 'certified' && b.healthStatus !== 'halted' && b.healthStatus !== 'unhealthy')
      .sort((a, b) => Number(isAssigned(b, req.agentSlug)) - Number(isAssigned(a, req.agentSlug)));
    const brainCandidates: ModelCandidate[] = [];
    for (const brain of brains) {
      if (await this.isCellCertified(brain.modelId, req.tier, language)) {
        brainCandidates.push({
          modelId: brain.modelId,
          source: 'tenant_brain',
          brainId: brain.id,
          credentialSlug: brain.credentialVaultServiceSlug,
        });
      }
    }
    if (brainCandidates.length > 0) {
      return { candidates: brainCandidates.slice(0, MAX_CANDIDATES), tierUsed: req.tier, degraded: false, requiresApproval: false, source: 'tenant_brain' };
    }

    // b. Platform-managed certified models, only when the tenant opted into managed supply.
    if (brainConfig.brainSupply === 'managed') {
      const route = await this.certifiedRouter.routeTask({
        tenantId: req.tenantId,
        requiredTier: req.tier,
        language,
        taskId: req.taskId,
        taskDescription: req.userPrompt.slice(0, 200),
      });
      if (route.success && route.modelId && route.tierUsed) {
        const action = route.degradationResolution?.actionTaken;
        const sameTier = (await this.certRepo.findCertifiedModels(route.tierUsed, language)).map((c) => c.model_id);
        const ids = [route.modelId, ...sameTier.filter((id) => id !== route.modelId)].slice(0, MAX_CANDIDATES);
        return {
          candidates: ids.map((modelId) => ({ modelId, source: 'platform_certified' as const })),
          tierUsed: route.tierUsed,
          degraded: route.degraded,
          degradation: route.degradationResolution,
          // 'decompose' is not executed automatically yet, so it is treated as a draft for approval.
          requiresApproval: action === 'reduce_autonomy' || action === 'decompose',
          source: 'platform_certified',
        };
      }
      if (!isSandboxMode()) {
        throw new GatewayEscalationError(route.error ?? 'No certified model available.', route.degradationResolution);
      }
    }

    // Sandbox/test only: simulated execution, clearly labelled.
    if (isSandboxMode()) {
      return {
        candidates: [{ modelId: req.sandboxModelHint ?? 'sandbox-model', source: 'sandbox_uncertified' }],
        tierUsed: req.tier,
        degraded: false,
        requiresApproval: false,
        source: 'sandbox_uncertified',
      };
    }

    // c. BYO tenant with no certified brain for this work.
    throw new GatewayEscalationError(
      `No certified brain for ${req.tier}/${language}. Add a brain and run its alignment check, or switch to managed supply.`
    );
  }

  private async isCellCertified(modelId: string, tier: CapabilityTier, language: string): Promise<boolean> {
    const now = new Date().toISOString();
    const matrix = await this.certRepo.getCertificationMatrix(modelId);
    return matrix.some(
      (c) => c.tier === tier && c.language === language && c.status === 'certified' && (!c.expires_at || c.expires_at > now)
    );
  }

  private async callWithRepair(
    router: ModelRouter,
    modelId: string,
    req: GatewayRequest<any>
  ): Promise<Omit<GatewayResult<any>, 'modelUsed' | 'selection' | 'durationMs'>> {
    const call = (userPrompt: string) =>
      router.complete({
        systemPrompt: req.systemPrompt,
        userPrompt,
        contextData: req.contextData,
        policy: { primaryModel: modelId, fallbackModel: modelId },
        temperature: req.temperature,
        maxTokens: req.maxTokens,
        jsonMode: Boolean(req.schema),
      });

    const first = await call(req.userPrompt);
    const totals = { promptTokens: first.promptTokens, completionTokens: first.completionTokens, costUsd: first.estimatedCostUsd };
    let costSource = first.costSource;

    if (!req.schema) {
      return { content: first.content, parsed: undefined, repairAttempted: false, ...totals, costSource };
    }

    const firstCheck = validate(req.schema, first.content);
    if (firstCheck.ok) {
      if (costSource === 'unknown' || totals.costUsd === 0) {
        const calculated = calculateTokenCost(modelId, totals.promptTokens, totals.completionTokens);
        if (calculated.costUsd !== null && calculated.costUsd > 0) {
          totals.costUsd = calculated.costUsd;
          costSource = calculated.costSource;
        }
      }
      return { content: first.content, parsed: firstCheck.value, repairAttempted: false, ...totals, costSource };
    }

    // Exactly one repair attempt, telling the model precisely what was wrong.
    const repairPrompt =
      `${req.userPrompt}\n\n---\nYour previous reply was:\n${first.content.slice(0, 4000)}\n\n` +
      `It was rejected because: ${firstCheck.issues}\nReply again with ONLY one JSON object that fixes these problems.`;
    const second = await call(repairPrompt);
    totals.promptTokens += second.promptTokens;
    totals.completionTokens += second.completionTokens;
    totals.costUsd += second.estimatedCostUsd;
    if (second.costSource === 'unknown') costSource = 'unknown';

    if (costSource === 'unknown' || totals.costUsd === 0) {
      const calculated = calculateTokenCost(modelId, totals.promptTokens, totals.completionTokens);
      if (calculated.costUsd !== null && calculated.costUsd > 0) {
        totals.costUsd = calculated.costUsd;
        costSource = calculated.costSource;
      }
    }

    const secondCheck = validate(req.schema, second.content);
    if (secondCheck.ok) {
      return { content: second.content, parsed: secondCheck.value, repairAttempted: true, ...totals, costSource };
    }
    throw new StructuredOutputError(
      `Model output failed schema validation after one repair attempt: ${secondCheck.issues}`,
      second.content,
      secondCheck.issues
    );
  }
}

function isAssigned(brain: TenantBrainRecord, agentSlug?: string): boolean {
  return Boolean(agentSlug && brain.assignedAgents.includes(agentSlug));
}

function validate(schema: ZodTypeAny, content: string): { ok: true; value: unknown } | { ok: false; issues: string } {
  const obj = parseJsonObject(content);
  if (!obj) return { ok: false, issues: 'the reply was not a single JSON object' };
  const parsed = schema.safeParse(obj);
  if (parsed.success) return { ok: true, value: parsed.data };
  return {
    ok: false,
    issues: parsed.error.issues
      .slice(0, 8)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; '),
  };
}

function defaultAdapterFor(candidate: ModelCandidate, apiKey?: string): LLMProviderAdapter {
  // Simulated adapter: its constructor refuses outside sandbox/test mode.
  if (candidate.source === 'sandbox_uncertified') return new DeterministicLLMAdapter();
  const key = apiKey ?? config.get('OPENROUTER_API_KEY');
  if (!key) throw new NotConfiguredError('Model provider', 'set OPENROUTER_API_KEY or add a BYO brain key.');
  return new OpenRouterAdapter({ apiKey: key });
}
