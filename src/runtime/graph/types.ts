/**
 * Kriya Omnitask — Graph Runtime: definition model (docs/kriya WP-2.1, 02_TARGET_ARCHITECTURE §3)
 *
 * Agents and workflows are typed state graphs. Nodes do one kind of thing; edges are deterministic
 * predicates over state (a model never picks an edge — it writes a field a `router` validates).
 * Every graph is checked by `validateGraph()` before it can be published or executed.
 */

import { z } from 'zod';

/** The closed set of node kinds (02 §3.1). */
export const NodeKindSchema = z.enum([
  'rule', // deterministic function (classifier, validator, state-machine step); ~zero cost
  'llm', // one model call via the Model Gateway with a schema-bound output; proposes only
  'cascade', // cheapest level that resolves: L0 rule → L1 tenant cache → L2 small model → L3 frontier → human (02 §5.1)
  'policy', // policy engine + risk tier → allow / block / require_approval
  'mandate', // delegated-authority check (scope, amount, expiry, revocation)
  'tool', // side-effecting action through the Tool Gateway, with an idempotency key
  'verify', // read-back from the target system
  'proof', // signed, hash-chained receipt
  'human_gate', // interrupt: park the run, create an Attention item, resume on decision
  'router', // pure condition over state → next edge
  'subgraph', // invoke another graph (delegation), depth-limited
  'end', // terminal with a final outcome state
]);
export type NodeKind = z.infer<typeof NodeKindSchema>;

/** Closed outcome states (02 §1), plus `informed` for T0 answers that executed nothing. */
export const OutcomeStateSchema = z.enum([
  'informed',
  'proposed',
  'blocked',
  'awaiting_approval',
  'submitted',
  'verified',
  'verification_failed',
  'compensated',
  'failed',
  'escalated',
]);
export type OutcomeState = z.infer<typeof OutcomeStateSchema>;

/** Blueprint §14 risk tiers for actions. */
export const ActionTierSchema = z.enum(['T0', 'T1', 'T2', 'T3']);
export type ActionTier = z.infer<typeof ActionTierSchema>;

/** A deterministic predicate over run state. `path` is a dot path into the state object. */
export const EdgeConditionSchema = z.object({
  path: z.string().min(1),
  op: z.enum(['eq', 'neq', 'in', 'nin', 'exists', 'not_exists', 'gt', 'gte', 'lt', 'lte']),
  value: z.unknown().optional(),
});
export type EdgeCondition = z.infer<typeof EdgeConditionSchema>;

export const GraphNodeSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_.-]+$/),
  kind: NodeKindSchema,
  name: z.string().optional(),
  config: z.record(z.unknown()).default({}),
  /** Required on `tool` nodes. */
  actionTier: ActionTierSchema.optional(),
  /** Required on `end` nodes. */
  outcome: OutcomeStateSchema.optional(),
  /** Loop bound: max times this node may execute in one run. Required somewhere in every cycle. */
  maxVisits: z.number().int().positive().optional(),
});
export type GraphNode = z.infer<typeof GraphNodeSchema>;

export const GraphEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  /** All conditions must hold. Omitted = default edge (taken when no conditional edge matches). */
  when: z.array(EdgeConditionSchema).optional(),
});
export type GraphEdge = z.infer<typeof GraphEdgeSchema>;

export const GraphDefinitionSchema = z.object({
  id: z.string().regex(/^[a-z0-9_.-]+$/),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  description: z.string().optional(),
  entry: z.string(),
  nodes: z.array(GraphNodeSchema).min(1),
  edges: z.array(GraphEdgeSchema),
  /** Hard bound on node executions per run (inner-loop safety net, 02 §4). */
  maxSteps: z.number().int().positive().max(500),
});
export type GraphDefinition = z.infer<typeof GraphDefinitionSchema>;

/** Evaluates an edge condition against state. Pure and deterministic. */
export function evaluateCondition(cond: EdgeCondition, state: Record<string, unknown>): boolean {
  const actual = cond.path.split('.').reduce<unknown>(
    (obj, key) => (obj !== null && typeof obj === 'object' ? (obj as Record<string, unknown>)[key] : undefined),
    state
  );
  switch (cond.op) {
    case 'eq':
      return actual === cond.value;
    case 'neq':
      return actual !== cond.value;
    case 'in':
      return Array.isArray(cond.value) && cond.value.includes(actual);
    case 'nin':
      return Array.isArray(cond.value) && !cond.value.includes(actual);
    case 'exists':
      return actual !== undefined && actual !== null;
    case 'not_exists':
      return actual === undefined || actual === null;
    case 'gt':
      return typeof actual === 'number' && typeof cond.value === 'number' && actual > cond.value;
    case 'gte':
      return typeof actual === 'number' && typeof cond.value === 'number' && actual >= cond.value;
    case 'lt':
      return typeof actual === 'number' && typeof cond.value === 'number' && actual < cond.value;
    case 'lte':
      return typeof actual === 'number' && typeof cond.value === 'number' && actual <= cond.value;
  }
}
