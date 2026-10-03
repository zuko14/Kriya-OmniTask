/**
 * Kriya Omnitask — Bounded agent loop (docs/kriya WP-2.3, 02 §4 "inner loop")
 *
 *   plan (llm) → guard (rule) → route ─┬─ finish            → end (informed; verified if actions ran)
 *                                      ├─ tool X → policy → [mandate] → [human gate] → tool → verify
 *                                      │          → settle ─ verified → proof → observe → plan …
 *                                      │                   ─ pending  → wait → verify (bounded)
 *                                      │                   ─ else     → end verification_failed
 *                                      ├─ over budget       → end escalated
 *                                      ├─ no progress       → end escalated (same tool + same args twice)
 *                                      └─ anything else     → end failed
 *
 * Termination is decided by code, never by the model saying "done": every node in the cycle has a
 * visit bound, the run has maxSteps, the cost budget is checked before each tool, and a repeated
 * identical action stops the loop. The model only proposes the next step through a closed schema
 * (it can only name tools from this agent's list). A human approval is consumed by one action:
 * `observe` clears it, so one approval never authorises later actions.
 */

import { z, ZodTypeAny } from 'zod';
import { GraphDefinition, GraphNode, GraphEdge, ActionTier, EdgeCondition } from './types.js';
import { assertValidGraph } from './validator.js';
import { RuleFn } from './handlers.js';
import { canonicalJson } from '../../core/utils/canonicalJson.js';

export interface LoopTool {
  slug: string;
  tier: ActionTier;
  description: string;
  /** Path into the plan args holding a money amount, for the Mandate check (T2/T3). */
  amountArg?: string;
  /** A human approves every use, even below T2 (the tool is above the agent's autonomy cap). */
  requireApproval?: boolean;
  /** Args set by code from run state (arg → state path), never by the model. */
  bind?: Record<string, string>;
}

export interface AgentLoopSpec {
  id: string;
  goal: string;
  tools: LoopTool[];
  maxIterations?: number;
  maxCostUsd?: number;
  tier?: 'T1' | 'T2' | 'T3' | 'T4';
  /** State paths the planning model may see (context minimisation). Default: ['context']. */
  contextPaths?: string[];
}

export interface AgentLoop {
  graph: GraphDefinition;
  schemas: Record<string, ZodTypeAny>;
  rules: Record<string, RuleFn>;
}

const eq = (path: string, value: unknown): EdgeCondition[] => [{ path, op: 'eq', value }];

export function buildAgentLoop(spec: AgentLoopSpec): AgentLoop {
  if (spec.tools.length === 0) throw new Error('An agent loop needs at least one tool (otherwise use a single llm node).');
  const N = spec.maxIterations ?? 6;
  const maxCostUsd = spec.maxCostUsd ?? 0.05;
  const slugs = spec.tools.map((t) => t.slug) as [string, ...string[]];

  const planSchema = z
    .object({
      action: z.enum(['tool', 'finish']),
      tool: z.enum(slugs).optional(),
      args: z.record(z.unknown()).default({}),
      answer: z.string().optional(),
      reason: z.string().min(1),
    })
    .refine((p) => p.action !== 'tool' || p.tool !== undefined, { message: 'tool is required when action is "tool"' })
    .refine((p) => p.action !== 'finish' || (p.answer ?? '').length > 0, { message: 'answer is required when action is "finish"' });
  const schemaName = `${spec.id}.plan`;

  const toolList = spec.tools.map((t) => `- ${t.slug}: ${t.description}${t.bind ? ` (${Object.keys(t.bind).join(', ')}: set automatically)` : ''}`).join('\n');
  const nodes: GraphNode[] = [
    {
      id: 'plan',
      kind: 'llm',
      maxVisits: N,
      config: {
        outputSchema: schemaName,
        tier: spec.tier ?? 'T2',
        systemPrompt:
          `${spec.goal}\n\nYou work step by step. Each reply is ONE JSON object:\n` +
          `{"action":"tool","tool":<name>,"args":{...},"reason":string} to use a tool, or\n` +
          `{"action":"finish","answer":string,"reason":string} when the goal is met or cannot be met.\n` +
          `Available tools:\n${toolList}\n` +
          `Use only facts from tool results and the request. Never repeat an identical tool call. Never invent data.`,
        userPrompt: 'Today: {{today}}\nRequest: {{request}}\nSteps so far (most recent last): {{loop.recent}}',
        contextPaths: spec.contextPaths ?? ['context'],
        writeTo: 'plan',
      },
    },
    { id: 'guard', kind: 'rule', maxVisits: N, config: { rule: 'loop_guard', maxCostUsd } },
    { id: 'route', kind: 'router', maxVisits: N, config: {} },
    { id: 'observe', kind: 'rule', maxVisits: N, config: { rule: 'loop_observe' } },
    { id: 'finish', kind: 'end', outcome: 'informed', config: { outcomeIfActions: 'verified' } },
    { id: 'over_budget', kind: 'end', outcome: 'escalated', config: {} },
    { id: 'no_progress', kind: 'end', outcome: 'escalated', config: {} },
    { id: 'invalid_plan', kind: 'end', outcome: 'failed', config: {} },
    { id: 'blocked', kind: 'end', outcome: 'blocked', config: {} },
    { id: 'verification_failed', kind: 'end', outcome: 'verification_failed', config: {} },
  ];
  const edges: GraphEdge[] = [
    { from: 'plan', to: 'guard' },
    { from: 'guard', to: 'route' },
    { from: 'route', to: 'over_budget', when: eq('loop.overBudget', true) },
    { from: 'route', to: 'no_progress', when: eq('loop.noProgress', true) },
    { from: 'route', to: 'finish', when: eq('plan.action', 'finish') },
    { from: 'observe', to: 'plan' },
  ];

  let needsRejectEnd = false;
  for (const t of spec.tools) {
    const p = `${t.slug}__policy`;
    const tool = `${t.slug}__tool`;
    const verify = `${t.slug}__verify`;
    const settle = `${t.slug}__settle`;
    const wait = `${t.slug}__wait`;
    const proof = `${t.slug}__proof`;
    nodes.push(
      { id: p, kind: 'policy', maxVisits: N, config: { actionType: 'tool_execution', contextPaths: ['plan'], writeTo: 'policy' } },
      { id: tool, kind: 'tool', actionTier: t.tier, maxVisits: N, config: { tool: t.slug, inputPath: 'plan.args', writeTo: 'action', ...(t.bind ? { bindPaths: t.bind } : {}) } },
      { id: verify, kind: 'verify', maxVisits: N * 3, config: { actionPath: 'action', writeTo: 'verification' } },
      { id: settle, kind: 'router', maxVisits: N * 3, config: {} },
      { id: wait, kind: 'rule', maxVisits: N * 2, config: { rule: 'delay', delayMs: 2000 } },
      { id: proof, kind: 'proof', maxVisits: N, config: { actionPath: 'action', writeTo: 'receipt' } }
    );
    edges.push(
      { from: 'route', to: p, when: [...eq('plan.action', 'tool'), ...eq('plan.tool', t.slug)] },
      { from: p, to: 'blocked' },
      { from: tool, to: verify },
      { from: verify, to: settle },
      { from: settle, to: proof, when: eq('verification.state', 'verified') },
      { from: settle, to: wait, when: eq('verification.state', 'pending') },
      { from: settle, to: 'verification_failed' },
      { from: wait, to: verify },
      { from: proof, to: 'observe' }
    );

    if (t.tier === 'T2' || t.tier === 'T3') {
      const mandate = `${t.slug}__mandate`;
      const gate = `${t.slug}__approval`;
      needsRejectEnd = true;
      nodes.push(
        { id: mandate, kind: 'mandate', maxVisits: N, config: { actionType: t.slug, ...(t.amountArg ? { amountPath: `plan.args.${t.amountArg}` } : {}), writeTo: 'mandate' } },
        { id: gate, kind: 'human_gate', maxVisits: N, config: { reason: `Approve '${t.slug}' (${t.tier}) proposed by the agent` } }
      );
      edges.push({ from: p, to: mandate, when: eq('policy.decision', 'allow') });
      if (t.tier === 'T2' && !t.requireApproval) {
        edges.push({ from: mandate, to: tool, when: eq('mandate.decision', 'allow') });
      }
      edges.push({ from: mandate, to: gate }, { from: gate, to: tool, when: eq('approval.decision', 'approved') }, { from: gate, to: 'rejected' });
    } else if (t.requireApproval) {
      const gate = `${t.slug}__approval`;
      needsRejectEnd = true;
      nodes.push({ id: gate, kind: 'human_gate', maxVisits: N, config: { reason: `Approve '${t.slug}' (${t.tier}, above this agent's autonomy cap) proposed by the agent` } });
      edges.push({ from: p, to: gate, when: eq('policy.decision', 'allow') }, { from: gate, to: tool, when: eq('approval.decision', 'approved') }, { from: gate, to: 'rejected' });
    } else {
      edges.push({ from: p, to: tool, when: eq('policy.decision', 'allow') });
    }
  }
  if (needsRejectEnd) nodes.push({ id: 'rejected', kind: 'end', outcome: 'escalated', config: {} });
  edges.push({ from: 'route', to: 'invalid_plan' });

  const graph = assertValidGraph({
    id: spec.id,
    version: '1.0.0',
    entry: 'plan',
    nodes,
    edges,
    maxSteps: Math.min(500, N * 12 + 10),
  });

  const rules: Record<string, RuleFn> = {
    loop_guard: (state, config) => {
      const loop = (state.loop as Record<string, unknown>) ?? {};
      const history = (loop.history as Array<{ tool: string; args: unknown }>) ?? [];
      const plan = state.plan as { action: string; tool?: string; args?: unknown };
      const last = history[history.length - 1];
      const noProgress = plan.action === 'tool' && !!last && last.tool === plan.tool && canonicalJson(last.args) === canonicalJson(plan.args ?? {});
      return {
        loop: {
          ...loop,
          history,
          iterations: Number(loop.iterations ?? 0) + 1,
          overBudget: Number(state.costUsd ?? 0) > Number(config.maxCostUsd),
          noProgress,
        },
      };
    },
    loop_observe: (state) => {
      const loop = (state.loop as Record<string, unknown>) ?? {};
      const plan = state.plan as { tool?: string; args?: unknown };
      const action = state.action as { result?: unknown } | undefined;
      const history = [
        ...((loop.history as unknown[]) ?? []),
        { tool: plan.tool, args: plan.args ?? {}, result: action?.result, verification: (state.verification as { state?: string })?.state, receipt: (state.receipt as { id?: string })?.id },
      ];
      return {
        loop: { ...loop, history, actionsTaken: Number(loop.actionsTaken ?? 0) + 1, recent: history.slice(-5) },
        approval: null, // one approval authorises one action only
      };
    },
  };

  return { graph, schemas: { [schemaName]: planSchema }, rules };
}
