/**
 * Kriya AI — Golden Evaluation Suites Registry (WP-6.2)
 * Central export of all agent evaluation suites for CI pipelines (§14, §18 of CLAUDE.md).
 */

import { AgentGoldenSuite, AgentSlug } from '../types/evalCiTypes.js';
import { INTAKE_GOLDEN_SUITE } from './intakeGoldenSuite.js';
import { SCHEDULING_GOLDEN_SUITE } from './schedulingGoldenSuite.js';
import { PAYMENTS_GOLDEN_SUITE } from './paymentsGoldenSuite.js';
import { DOCUMENT_GOLDEN_SUITE } from './documentGoldenSuite.js';
import { ATTENTION_GOLDEN_SUITE } from './attentionGoldenSuite.js';

export {
  INTAKE_GOLDEN_SUITE,
  SCHEDULING_GOLDEN_SUITE,
  PAYMENTS_GOLDEN_SUITE,
  DOCUMENT_GOLDEN_SUITE,
  ATTENTION_GOLDEN_SUITE,
};

export const ALL_GOLDEN_SUITES: Record<AgentSlug, AgentGoldenSuite> = {
  intake: INTAKE_GOLDEN_SUITE,
  scheduling: SCHEDULING_GOLDEN_SUITE,
  payments: PAYMENTS_GOLDEN_SUITE,
  document: DOCUMENT_GOLDEN_SUITE,
  attention: ATTENTION_GOLDEN_SUITE,
};

export function getGoldenSuite(agentSlug: AgentSlug): AgentGoldenSuite | undefined {
  return ALL_GOLDEN_SUITES[agentSlug];
}
