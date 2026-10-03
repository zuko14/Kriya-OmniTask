/**
 * Kriya Omnitask — Risk tiers (docs/kriya WP-3.2, blueprint §14)
 *
 *   T0 Inform        read-only: status, reminders, summaries            → automatic
 *   T1 Reversible    low-value, reversible actions within policy        → automatic + receipt
 *   T2 Consequential money or records move within Mandate limits      → automatic if policy + Mandate pass
 *   T3 Irreversible  high-value, clinical, legal or identity actions    → human approval ALWAYS
 *
 * The one place the legacy LOW/MEDIUM/HIGH/CRITICAL classification maps onto T0-T3.
 */

import type { ActionTier } from '../runtime/graph/types.js';
import type { RiskTier } from '../agents/types/agentTypes.js';

const LEGACY_TO_TIER: Record<RiskTier, ActionTier> = {
  LOW: 'T0',
  MEDIUM: 'T1',
  HIGH: 'T2',
  CRITICAL: 'T3',
};

export function toActionTier(legacy: RiskTier): ActionTier {
  return LEGACY_TO_TIER[legacy];
}

/** T2 and T3 need a Mandate check; T3 additionally always needs a human, regardless of model confidence. */
export function requiresMandate(tier: ActionTier): boolean {
  return tier === 'T2' || tier === 'T3';
}

export function requiresHumanApproval(tier: ActionTier): boolean {
  return tier === 'T3';
}
