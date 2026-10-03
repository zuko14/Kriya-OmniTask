/**
 * Kriya Omnitask — DAG workflow → graph compiler (docs/kriya WP-2.2b, audit S29)
 *
 * Legacy DAG workflows let a `tool_execution` step run with no policy check. Compiling them onto the
 * graph runtime inserts the missing authority steps automatically:
 *
 *   tool (T0/T1):  policy → tool → [verify → settle → proof] → next
 *   tool (T2):     policy → mandate → (allow) tool | (over limit) human gate → tool | rejected
 *   tool (T3):     policy → mandate → human gate → (approved) tool
 *   policy_check:  policy → (allow) next | blocked
 *   human_approval: human gate → (approved) next | rejected
 *   agent_task:    subgraph (agent delegation)
 *   delay:         rule 'delay' (records not-before; the scheduler waits, the graph never sleeps)
 *
 * Steps run in a stable topological order. The final outcome is honest: `verified` only when every
 * tool has a read-back and a receipt, `submitted` when actions ran without verification, `informed`
 * when nothing acted. `conditional_branch` (skip-subtree semantics) is refused with a clear error
 * rather than compiled approximately; such workflows stay on the legacy engine until it is ported.
 */

import { DAGDefinition, DAGStep } from '../../workflows/types/workflowTypes.js';
import { GraphDefinition, GraphNode, GraphEdge, ActionTier, EdgeCondition, OutcomeState } from './types.js';
import { assertValidGraph } from './validator.js';

export class DagCompileError extends Error {}

export interface DagCompileOptions {
  graphId: string;
  version?: string;
  /** Tier of a tool (from the registry); unknown tools default to T1. */
  toolTier: (toolSlug: string) => ActionTier | undefined;
  /** Whether the tool exposes a verify() read-back. */
  toolHasVerify: (toolSlug: string) => boolean;
}

interface Exit {
  from: string;
  when?: EdgeCondition[];
}

const eq = (path: string, value: unknown): EdgeCondition[] => [{ path, op: 'eq', value }];

export function compileDagToGraph(dag: DAGDefinition, opts: DagCompileOptions): GraphDefinition {
  const ordered = topoSort(dag.steps);
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const ends = new Map<string, GraphNode>();
  const end = (id: string, outcome: OutcomeState) => {
    if (!ends.has(id)) ends.set(id, { id, kind: 'end', outcome, config: {} });
    return id;
  };

  let pending: Exit[] = [];
  let anyTool = false;
  let allVerified = true;
  let entry: string | undefined;

  const connect = (to: string) => {
    for (const e of pending) edges.push({ from: e.from, to, ...(e.when ? { when: e.when } : {}) });
    pending = [];
    entry ??= to;
  };

  for (const step of ordered) {
    const cfg = step.config as Record<string, unknown>;
    switch (step.type) {
      case 'agent_task': {
        nodes.push({ id: step.id, kind: 'subgraph', name: step.name, config: { agentSlug: cfg.agentSlug, objective: cfg.objective, inputData: cfg.inputData, writeTo: `steps.${step.id}.output` } });
        connect(step.id);
        pending = [{ from: step.id }];
        break;
      }
      case 'policy_check': {
        nodes.push({ id: step.id, kind: 'policy', name: step.name, config: { actionType: 'custom', category: cfg.category, writeTo: `steps.${step.id}.output` } });
        connect(step.id);
        edges.push({ from: step.id, to: end('blocked', 'blocked') });
        pending = [{ from: step.id, when: eq(`steps.${step.id}.output.decision`, 'allow') }];
        break;
      }
      case 'human_approval': {
        nodes.push({ id: step.id, kind: 'human_gate', name: step.name, config: { reason: cfg.title ?? step.name, requiredRole: cfg.requiredRole } });
        connect(step.id);
        edges.push({ from: step.id, to: end('rejected', 'escalated') });
        pending = [{ from: step.id, when: eq('approval.decision', 'approved') }];
        break;
      }
      case 'delay': {
        nodes.push({ id: step.id, kind: 'rule', name: step.name, config: { rule: 'delay', delayMs: cfg.delayMs ?? 0 } });
        connect(step.id);
        pending = [{ from: step.id }];
        break;
      }
      case 'tool_execution': {
        anyTool = true;
        const tool = String(cfg.toolName ?? '');
        const tier = opts.toolTier(tool) ?? 'T1';
        const base = `${step.id}`;
        const policyId = `${base}__policy`;
        const toolId = `${base}__tool`;
        nodes.push({ id: policyId, kind: 'policy', name: `${step.name} · policy`, config: { actionType: 'tool_execution', writeTo: 'policy' } });
        connect(policyId);
        edges.push({ from: policyId, to: end('blocked', 'blocked') });

        nodes.push({
          id: toolId,
          kind: 'tool',
          name: step.name,
          actionTier: tier,
          config: { tool, input: cfg.params ?? {}, interpolate: true, writeTo: `steps.${step.id}.action`, writeResultTo: `steps.${step.id}.output` },
        });

        if (tier === 'T2' || tier === 'T3') {
          const mandateId = `${base}__mandate`;
          const gateId = `${base}__approval`;
          const amount = (cfg.params as Record<string, unknown> | undefined)?.amount;
          nodes.push({ id: mandateId, kind: 'mandate', name: `${step.name} · mandate`, config: { actionType: tool, ...(typeof amount === 'number' ? { amount } : {}), writeTo: 'mandate' } });
          nodes.push({ id: gateId, kind: 'human_gate', name: `${step.name} · approval`, config: { reason: `Approve '${step.name}' (${tier})` } });
          edges.push({ from: policyId, to: mandateId, when: eq('policy.decision', 'allow') });
          if (tier === 'T2') edges.push({ from: mandateId, to: toolId, when: eq('mandate.decision', 'allow') });
          edges.push({ from: mandateId, to: gateId });
          edges.push({ from: gateId, to: toolId, when: eq('approval.decision', 'approved') });
          edges.push({ from: gateId, to: end('rejected', 'escalated') });
        } else {
          edges.push({ from: policyId, to: toolId, when: eq('policy.decision', 'allow') });
        }

        if (opts.toolHasVerify(tool)) {
          const verifyId = `${base}__verify`;
          const settleId = `${base}__settle`;
          const proofId = `${base}__proof`;
          nodes.push({ id: verifyId, kind: 'verify', config: { actionPath: `steps.${step.id}.action`, writeTo: 'verification' } });
          nodes.push({ id: settleId, kind: 'router', config: {} });
          nodes.push({ id: proofId, kind: 'proof', config: { actionPath: `steps.${step.id}.action`, writeTo: `steps.${step.id}.receipt` } });
          edges.push({ from: toolId, to: verifyId });
          edges.push({ from: verifyId, to: settleId });
          edges.push({ from: settleId, to: proofId, when: eq('verification.state', 'verified') });
          edges.push({ from: settleId, to: end('verification_failed', 'verification_failed') });
          pending = [{ from: proofId }];
        } else {
          allVerified = false;
          pending = [{ from: toolId }];
        }
        break;
      }
      case 'conditional_branch':
        throw new DagCompileError(`Step '${step.id}': conditional_branch is not compiled yet (skip-subtree semantics); keep this workflow on the legacy engine.`);
      default:
        throw new DagCompileError(`Step '${step.id}': unknown step type '${(step as DAGStep).type}'.`);
    }
  }

  const finalOutcome: OutcomeState = !anyTool ? 'informed' : allVerified ? 'verified' : 'submitted';
  connect(end('done', finalOutcome));
  nodes.push(...ends.values());

  const graph: GraphDefinition = {
    id: opts.graphId,
    version: opts.version ?? '1.0.0',
    entry: entry!,
    nodes,
    edges,
    maxSteps: Math.min(500, nodes.length * 2 + 10),
  };
  return assertValidGraph(graph);
}

/** Kahn's algorithm, stable by definition order; rejects cycles and unknown dependencies. */
function topoSort(steps: DAGStep[]): DAGStep[] {
  const byId = new Map(steps.map((s) => [s.id, s]));
  for (const s of steps) for (const d of s.dependsOn) if (!byId.has(d)) throw new DagCompileError(`Step '${s.id}' depends on unknown step '${d}'.`);
  const done = new Set<string>();
  const out: DAGStep[] = [];
  while (out.length < steps.length) {
    const next = steps.find((s) => !done.has(s.id) && s.dependsOn.every((d) => done.has(d)));
    if (!next) throw new DagCompileError('Workflow contains a dependency cycle.');
    done.add(next.id);
    out.push(next);
  }
  return out;
}
