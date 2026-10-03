/**
 * Kriya AI — Dynamic Model Router
 * Capability matching, policy enforcement, data privacy gates, and fallback sequence generation.
 */

import {
  ModelRegistryRecord,
  TenantModelPolicy,
  ModelExecutionRequest,
} from '../types/modelResilienceTypes.js';

export interface RoutingPlan {
  primaryModel: ModelRegistryRecord;
  fallbackChain: ModelRegistryRecord[];
  rationale: string;
}

export class DynamicModelRouter {
  /**
   * Evaluates registered models and tenant policy to produce an optimal routing plan.
   */
  public static formulateRoutingPlan(
    availableModels: ModelRegistryRecord[],
    policy: TenantModelPolicy | null,
    request: ModelExecutionRequest
  ): RoutingPlan {
    // 1. Filter out disabled/deprecated models
    let candidates = availableModels.filter((m) => m.status === 'active' || m.status === 'experimental');

    // 2. Filter out tenant-disallowed providers
    if (policy && policy.disallowedProviders.length > 0) {
      candidates = candidates.filter((m) => !policy.disallowedProviders.includes(m.provider));
    }

    // 3. Filter by data classification policy (Confidential / Restricted)
    const classification = request.dataClassification || 'internal';
    candidates = candidates.filter((m) => m.allowedDataClassifications.includes(classification));

    // If policy requires local execution for confidential/restricted data
    if (
      policy?.requireLocalForConfidential &&
      (classification === 'confidential' || classification === 'restricted')
    ) {
      candidates = candidates.filter((m) => m.provider === 'local');
    }

    if (candidates.length === 0) {
      throw new Error(
        `No approved models meet policy and privacy constraints for classification '${classification}' and disallowed providers.`
      );
    }

    // 4. Score candidates based on capability match, cost, and preferred provider
    const scored = candidates.map((model) => {
      let score = 0;

      // Capability bonus
      if (model.capabilities.includes(request.taskType)) {
        score += 50;
      }

      // Preferred provider bonus
      if (request.preferredProvider && model.provider === request.preferredProvider) {
        score += 30;
      }

      // Cost penalty (lower cost is better unless high complexity required)
      const avgCost = (model.inputCostPer1k + model.outputCostPer1k) / 2;
      score -= avgCost * 1000;

      // Primary policy bonus
      if (policy && model.id === policy.defaultPrimaryModelId) {
        score += 20;
      }

      return { model, score };
    });

    scored.sort((a, b) => b.score - a.score);

    const primaryModel = scored[0].model;
    const fallbackChain = scored.slice(1, 4).map((s) => s.model);

    const rationale = `Selected '${primaryModel.displayName}' (${primaryModel.provider}) matching task '${request.taskType}' under data classification '${classification}'. ${fallbackChain.length} approved fallbacks staged.`;

    return {
      primaryModel,
      fallbackChain,
      rationale,
    };
  }
}
