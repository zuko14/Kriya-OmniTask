/**
 * Kriya Omnitask — Graph Runtime: static validator (docs/kriya WP-2.1)
 *
 * A graph that fails validation cannot be published or executed. The rules encode the blueprint's
 * Verified Action discipline structurally, so safety does not depend on a prompt:
 *
 *   STRUCTURE  ids unique · entry exists · edges reference real nodes · every node reachable ·
 *              non-end nodes have an exit · end nodes have none and declare an outcome ·
 *              at most one default (unconditioned) edge per node
 *   AUTHORITY  every path to a `tool` passes a `policy` node; T2/T3 tools also pass a `mandate`
 *              node; T3 tools also pass a `human_gate`; tools declare their action tier
 *   PROOF      after a tool, an end with outcome `verified` is reachable only through `verify`
 *              then `proof`; a tool path can never end as `informed`
 *   LOOPS      every cycle contains a node with `maxVisits`
 *   OUTPUTS    every `llm` node names an output schema (config.outputSchema)
 *
 * "Every path from A to B passes X" is checked as "B is unreachable from A when X nodes are removed".
 */

import { GraphDefinition, GraphDefinitionSchema, GraphNode, NodeKind } from './types.js';

export interface GraphViolation {
  rule: string;
  nodeId?: string;
  message: string;
}

export interface GraphValidationResult {
  valid: boolean;
  violations: GraphViolation[];
}

export function validateGraph(input: unknown): GraphValidationResult {
  const parsed = GraphDefinitionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      valid: false,
      violations: parsed.error.issues.map((i) => ({ rule: 'schema', message: `${i.path.join('.')}: ${i.message}` })),
    };
  }
  const g = parsed.data;
  const v: GraphViolation[] = [];
  const add = (rule: string, message: string, nodeId?: string) => v.push({ rule, message, nodeId });

  // ---------------- STRUCTURE ----------------
  const nodes = new Map<string, GraphNode>();
  for (const n of g.nodes) {
    if (nodes.has(n.id)) add('unique_ids', `Duplicate node id '${n.id}'.`, n.id);
    nodes.set(n.id, n);
  }
  if (!nodes.has(g.entry)) add('entry_exists', `Entry node '${g.entry}' does not exist.`);

  const out = new Map<string, string[]>();
  for (const id of nodes.keys()) out.set(id, []);
  for (const e of g.edges) {
    if (!nodes.has(e.from)) add('edge_endpoints', `Edge from unknown node '${e.from}'.`);
    if (!nodes.has(e.to)) add('edge_endpoints', `Edge to unknown node '${e.to}'.`);
    if (nodes.has(e.from) && nodes.has(e.to)) out.get(e.from)!.push(e.to);
  }
  if (v.length > 0) return { valid: false, violations: v }; // later rules assume a well-formed graph

  const reachable = reach(g.entry, out, new Set());
  for (const n of g.nodes) {
    if (!reachable.has(n.id)) add('reachable', `Node '${n.id}' is unreachable from the entry.`, n.id);
    const exits = g.edges.filter((e) => e.from === n.id);
    if (n.kind === 'end') {
      if (exits.length > 0) add('end_terminal', `End node '${n.id}' must not have outgoing edges.`, n.id);
      if (!n.outcome) add('end_outcome', `End node '${n.id}' must declare an outcome.`, n.id);
    } else {
      if (exits.length === 0) add('has_exit', `Node '${n.id}' has no outgoing edge (dead end).`, n.id);
      if (exits.filter((e) => !e.when || e.when.length === 0).length > 1) {
        add('single_default', `Node '${n.id}' has more than one default (unconditioned) edge.`, n.id);
      }
    }
    if (n.kind === 'tool' && !n.actionTier) add('tool_tier', `Tool node '${n.id}' must declare actionTier (T0-T3).`, n.id);
    if ((n.kind === 'llm' || n.kind === 'cascade') && typeof n.config.outputSchema !== 'string') {
      add('llm_schema', `${n.kind} node '${n.id}' must name an output schema (config.outputSchema).`, n.id);
    }
    if (n.kind === 'cascade' && !exits.some((e) => !e.when || e.when.length === 0)) {
      add('cascade_unresolved', `Cascade node '${n.id}' needs a default edge for the unresolved (human) case.`, n.id);
    }
  }

  // ---------------- AUTHORITY ----------------
  const idsOfKind = (kind: NodeKind) => new Set(g.nodes.filter((n) => n.kind === kind).map((n) => n.id));
  const policyIds = idsOfKind('policy');
  const mandateIds = idsOfKind('mandate');
  const gateIds = idsOfKind('human_gate');
  const verifyIds = idsOfKind('verify');
  const proofIds = idsOfKind('proof');

  for (const tool of g.nodes.filter((n) => n.kind === 'tool')) {
    if (reach(g.entry, out, policyIds).has(tool.id)) {
      add('policy_before_tool', `Tool '${tool.id}' can be reached without passing a policy node.`, tool.id);
    }
    if ((tool.actionTier === 'T2' || tool.actionTier === 'T3') && reach(g.entry, out, mandateIds).has(tool.id)) {
      add('mandate_before_tool', `${tool.actionTier} tool '${tool.id}' can be reached without a mandate check.`, tool.id);
    }
    if (tool.actionTier === 'T3' && reach(g.entry, out, gateIds).has(tool.id)) {
      add('human_gate_before_t3', `T3 tool '${tool.id}' can be reached without a human gate.`, tool.id);
    }

    // ---------------- PROOF ----------------
    const successors = out.get(tool.id)!;
    const reachableAfter = (blocked: Set<string>) => {
      const seen = new Set<string>();
      for (const s of successors) for (const id of reach(s, out, blocked)) seen.add(id);
      return seen;
    };
    // An end that reports 'verified' when actions ran (config.outcomeIfActions) counts as a verified end.
    const verifiedEnds = g.nodes
      .filter((n) => n.kind === 'end' && (n.outcome === 'verified' || n.config.outcomeIfActions === 'verified'))
      .map((n) => n.id);
    const avoidingVerify = reachableAfter(verifyIds);
    const avoidingProof = reachableAfter(proofIds);
    for (const endId of verifiedEnds) {
      if (avoidingVerify.has(endId)) add('verify_after_tool', `After tool '${tool.id}', '${endId}' (verified) is reachable without a verify node.`, tool.id);
      if (avoidingProof.has(endId)) add('proof_after_tool', `After tool '${tool.id}', '${endId}' (verified) is reachable without a proof node.`, tool.id);
    }
    for (const proofId of proofIds) {
      if (avoidingVerify.has(proofId)) add('verify_before_proof', `After tool '${tool.id}', proof '${proofId}' is reachable before any verify node.`, tool.id);
    }
    const afterTool = reachableAfter(new Set());
    for (const n of g.nodes) {
      if (n.kind === 'end' && n.outcome === 'informed' && typeof n.config.outcomeIfActions !== 'string' && afterTool.has(n.id)) {
        add('tool_not_informed', `After tool '${tool.id}', end '${n.id}' reports 'informed' although an action ran.`, tool.id);
      }
    }
  }

  // ---------------- LOOPS ----------------
  for (const scc of stronglyConnected(g.nodes.map((n) => n.id), out)) {
    const isCycle = scc.length > 1 || out.get(scc[0])!.includes(scc[0]);
    if (isCycle && !scc.some((id) => nodes.get(id)!.maxVisits)) {
      add('loop_bound', `Cycle [${scc.join(' → ')}] has no node with maxVisits.`, scc[0]);
    }
  }

  return { valid: v.length === 0, violations: v };
}

/** Throws with every violation listed. Use at publish and at executor start. */
export function assertValidGraph(input: unknown): GraphDefinition {
  const res = validateGraph(input);
  if (!res.valid) {
    throw new Error(`Invalid graph:\n - ${res.violations.map((x) => `[${x.rule}] ${x.message}`).join('\n - ')}`);
  }
  return GraphDefinitionSchema.parse(input);
}

/** Nodes reachable from `start` without entering any node in `blocked` (start itself is never blocked). */
function reach(start: string, out: Map<string, string[]>, blocked: Set<string>): Set<string> {
  const seen = new Set<string>();
  if (blocked.has(start)) return seen;
  const stack = [start];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const next of out.get(id) ?? []) if (!blocked.has(next) && !seen.has(next)) stack.push(next);
  }
  return seen;
}

/** Tarjan's strongly connected components (agent graphs are small; recursion depth is bounded by node count). */
function stronglyConnected(ids: string[], out: Map<string, string[]>): string[][] {
  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const result: string[][] = [];

  const visit = (v: string) => {
    idx.set(v, index);
    low.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);
    for (const w of out.get(v) ?? []) {
      if (!idx.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, idx.get(w)!));
      }
    }
    if (low.get(v) === idx.get(v)) {
      const comp: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      result.push(comp);
    }
  };

  for (const id of ids) if (!idx.has(id)) visit(id);
  return result;
}
