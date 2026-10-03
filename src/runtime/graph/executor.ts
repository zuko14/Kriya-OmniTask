/**
 * Kriya Omnitask — Durable Graph Executor (docs/kriya WP-2.2, 02_TARGET_ARCHITECTURE §3.2, §4)
 *
 *  - Validates the graph (assertValidGraph) before a run starts.
 *  - After every node: state + next node + step + visit counts are saved with an append-only
 *    checkpoint, in one transaction. A crashed or interrupted run resumes from the last checkpoint.
 *  - Side-effecting nodes (tool, proof) get a deterministic idempotency key `runId:nodeId:visit`.
 *    Their result is recorded in the side-effect ledger; a resumed run reuses it instead of acting
 *    twice. If the process dies after the external call but before the ledger write, the node runs
 *    again WITH THE SAME KEY, so the target system (Tool Gateway / provider) must dedupe on it.
 *  - human_gate parks the run; resume(runId, decision) continues from the gate.
 *  - Bounded loops: exceeding a node's maxVisits or the graph's maxSteps ends the run `escalated`.
 *  - Never a silent success: a missing handler, a handler error, or no matching edge fails the run
 *    with the reason recorded.
 */

import { GraphDefinition, GraphNode, NodeKind, OutcomeState, evaluateCondition } from './types.js';
import { assertValidGraph } from './validator.js';
import { GraphRunRepository, GraphRunRecord, GraphRunStatus } from './graphRunRepository.js';
import { logger } from '../../core/logger/logger.js';
import { sha256Canonical } from '../../core/utils/canonicalJson.js';
import { AttentionService } from '../../attention/service/attentionService.js';
import { AttentionPriority, AttentionReasonCategory } from '../../attention/types/attentionTypes.js';
import { ObservabilityService } from '../../observability/service/observabilityService.js';
import { TraceRepository } from '../../observability/repositories/traceRepository.js';
import { SemanticAttributes, SpanStepType } from '../../observability/types/observabilityTypes.js';

function mapNodeKindToStepType(kind: NodeKind): SpanStepType {
  switch (kind) {
    case 'tool':
      return 'tool_execution';
    case 'router':
      return 'orchestration';
    case 'human_gate':
      return 'policy_check';
    case 'proof':
      return 'verification';
    default:
      return 'tool_execution';
  }
}

export interface NodeContext {
  runId: string;
  node: GraphNode;
  state: Readonly<Record<string, unknown>>;
  /** Deterministic per (run, node, visit): pass it to every external system as its idempotency key. */
  idempotencyKey: string;
  visit: number;
  graph: GraphDefinition;
}

export interface NodeOutcome {
  /** Shallow-merged into run state. */
  patch?: Record<string, unknown>;
  /** Park the run (e.g. waiting for a human or an external confirmation). */
  park?: { reason: string; attentionItemId?: string };
}

export type NodeHandler = (ctx: NodeContext) => Promise<NodeOutcome>;
export type NodeHandlers = Partial<Record<NodeKind, NodeHandler>>;

/** Undoes one recorded tool action (saga). Throw if it cannot be undone. */
export type Compensator = (node: GraphNode, recorded: Record<string, unknown>, idempotencyKey: string) => Promise<void>;

/** Stop at a node boundary WITHOUT recording a failure (graceful shutdown / process death). */
export class RunInterrupted extends Error {
  constructor(message = 'Run interrupted') {
    super(message);
    this.name = 'RunInterrupted';
  }
}

export interface RunResult {
  runId: string;
  status: GraphRunStatus;
  outcome?: OutcomeState;
  state: Record<string, unknown>;
  parkReason?: string;
  error?: string;
  steps: number;
}

export interface TimeoutEvaluationResult {
  timedOut: boolean;
  action?: 'reject' | 'auto_approve' | 'escalate' | string;
  runResult?: RunResult | null;
}

const SIDE_EFFECT_KINDS = new Set<NodeKind>(['tool', 'proof']);

const DEFAULT_HANDLERS: NodeHandlers = {
  router: async () => ({}),
  human_gate: async ({ node }) => ({
    park: { reason: typeof node.config.reason === 'string' ? node.config.reason : `Awaiting human decision at '${node.id}'` },
  }),
};

export class GraphExecutor {
  private static defaultRuntimeHandlers: NodeHandlers = {};

  public static setDefaultHandlers(handlers: NodeHandlers): void {
    GraphExecutor.defaultRuntimeHandlers = { ...GraphExecutor.defaultRuntimeHandlers, ...handlers };
  }

  public static resetDefaultHandlers(): void {
    GraphExecutor.defaultRuntimeHandlers = {};
  }

  private handlers: NodeHandlers;
  private readonly attentionService?: AttentionService;
  private readonly observabilityService?: ObservabilityService;

  constructor(
    handlers: NodeHandlers = {},
    private readonly repo: GraphRunRepository = new GraphRunRepository(),
    private readonly compensator?: Compensator,
    attentionService?: AttentionService,
    observabilityService?: ObservabilityService
  ) {
    this.attentionService = attentionService ?? new AttentionService(this.repo.getClient());
    this.observabilityService = observabilityService ?? new ObservabilityService(new TraceRepository(this.repo.getClient()));
    this.handlers = {
      router: async () => ({}),
      human_gate: (ctx) => this.executeHumanGate(ctx),
      ...GraphExecutor.defaultRuntimeHandlers,
      ...handlers,
    };
  }

  public async executeHumanGate(ctx: NodeContext): Promise<NodeOutcome> {
    const { runId, node, state, graph } = ctx;
    const reason = typeof node.config.reason === 'string' ? node.config.reason : `Awaiting human decision at '${node.id}'`;
    const priority = (node.config.priority as AttentionPriority) ?? 'P1_HIGH';
    const reasonCategory = (node.config.reasonCategory as AttentionReasonCategory) ?? 'workflow_suspended';
    const assignedRole = (node.config.requiredRole as string) ?? (node.config.assignedRole as string) ?? (state.requiredRole as string) ?? 'admin';
    const branchId = (state.branchId as string) ?? (node.config.branchId as string);
    const customerId = (state.customerId as string) ?? (state.customerRef as string);
    const financialValueUsd =
      typeof state.financialValueUsd === 'number'
        ? state.financialValueUsd
        : typeof state.amount === 'number'
        ? state.amount
        : typeof state.feeAmount === 'number'
        ? state.feeAmount
        : typeof node.config.amount === 'number'
        ? node.config.amount
        : undefined;

    let attentionItemId: string | undefined;

    if (this.attentionService) {
      try {
        const item = await this.attentionService.escalateOnce({
          correlationId: `${runId}:${node.id}`,
          traceId: runId,
          customerId,
          sourceAgentId: (state.sourceAgentId as string) ?? graph.id ?? 'graph_executor',
          title: node.name ? `${node.name} · Approval Required` : `Approval Required at '${node.id}'`,
          description: reason,
          reasonCategory,
          priority,
          assignedRole,
          branchId,
          financialValueUsd,
          recommendedAction: (node.config.recommendedAction as string) ?? `Approve or reject workflow continuation at '${node.id}'`,
          contextData: {
            runId,
            nodeId: node.id,
            graphId: graph.id,
            graphVersion: graph.version,
            requiredRole: assignedRole,
            financialValueUsd,
            customerId,
            reason,
            state,
            nodeConfig: node.config,
            resumptionToken: runId,
          },
        });
        attentionItemId = item.id;
      } catch (err) {
        logger.error(`GraphExecutor: Failed to create Attention item for node '${node.id}' in run '${runId}'`, err);
      }
    }

    return {
      park: {
        reason,
        attentionItemId,
      },
      patch: {
        attentionItemId,
        approvalRequestedAt: new Date().toISOString(),
        approvalNodeId: node.id,
      },
    };
  }

  /** Validates the graph, creates a run and drives it until it ends, parks, or fails. */
  public async start(graphInput: unknown, initialState: Record<string, unknown> = {}, opts: { correlationId?: string } = {}): Promise<RunResult> {
    const graph = assertValidGraph(graphInput);
    const run = await this.repo.createRun({
      graphId: graph.id,
      graphVersion: graph.version,
      graphJson: JSON.stringify(graph),
      entry: graph.entry,
      state: initialState,
      correlationId: opts.correlationId,
    });
    if (this.observabilityService) {
      try {
        await this.observabilityService.startTrace({
          id: run.id,
          correlationId: opts.correlationId || run.id,
          rootAgentId: graph.id,
          customerId: (initialState.customerId as string) ?? (initialState.customerRef as string),
          channel: (initialState.channel as any) ?? 'api',
        });
      } catch (err) {
        logger.warn(`GraphExecutor: could not start trace for run '${run.id}'`, { err });
      }
    }
    return this.drive(run.id);
  }

  /**
   * Continues a run. A parked run applies `input` as the parked node's result and follows its edges;
   * a run left `running` by a crash/interrupt re-executes from its last checkpoint.
   */
  public async resume(runId: string, input: Record<string, unknown> = {}): Promise<RunResult> {
    const run = await this.mustGet(runId);
    if (run.status === 'completed' || run.status === 'failed') {
      throw new Error(`Run '${runId}' is already ${run.status}.`);
    }
    if (run.status === 'parked') {
      const graph = JSON.parse(run.graph_json) as GraphDefinition;
      const node = graph.nodes.find((n) => n.id === run.next_node_id)!;
      const priorState = JSON.parse(run.state_json) as Record<string, unknown>;

      // Normalize approval decision payloads so all edge conditions match seamlessly:
      // whether the edge checks 'approval.decision == approved', 'decision == approved', or 'approved == true'.
      const normalizedInput = { ...input };
      const decision =
        (input.decision as string) ??
        (input.action as string) ??
        (input.approval && typeof (input.approval as any).decision === 'string' ? (input.approval as any).decision : undefined);

      if (decision) {
        normalizedInput.decision = decision;
        normalizedInput.approval = {
          decision,
          action: decision,
          notes: input.notes,
          decidedBy: input.decidedBy ?? input.humanApproverId ?? input.userId,
          decidedAt: new Date().toISOString(),
          ...(typeof input.approval === 'object' && input.approval ? input.approval : {}),
        };
        if (decision === 'approved') {
          normalizedInput.approved = true;
          normalizedInput.rejected = false;
        } else if (decision === 'rejected') {
          normalizedInput.approved = false;
          normalizedInput.rejected = true;
        }
      }

      // If there was an associated Attention item and an AttentionService, resolve it if not already resolved
      const attentionItemId = (priorState.attentionItemId as string) ?? (input.attentionItemId as string);
      if (attentionItemId && this.attentionService && decision) {
        try {
          const item = await this.attentionService.getItem(attentionItemId);
          if (item && item.status !== 'resolved' && item.status !== 'dismissed') {
            await this.attentionService.resolveItem(attentionItemId, {
              action: decision === 'approved' ? 'approved' : 'rejected',
              notes: (input.notes as string) ?? `Workflow resumed with decision '${decision}'`,
            });
          }
        } catch (err) {
          logger.warn(`GraphExecutor: could not auto-resolve attention item '${attentionItemId}' on resume`, { err });
        }
      }

      const state = { ...priorState, ...normalizedInput };
      const next = selectNext(graph, node.id, state);
      if (!next) return this.finish(run, 'failed', 'failed', state, `No edge from '${node.id}' matched the resume input.`);
      await this.checkpoint(run, node, next, state, JSON.parse(run.visits_json), 0, 'running');
    }
    return this.drive(runId);
  }

  /**
   * Evaluates a parked run for timeout and applies the configured escalation/rejection policy.
   */
  public async evaluateParkedRunTimeout(runId: string, now: Date = new Date()): Promise<TimeoutEvaluationResult> {
    const run = await this.mustGet(runId);
    if (run.status !== 'parked') return { timedOut: false };

    const graph = JSON.parse(run.graph_json) as GraphDefinition;
    const node = graph.nodes.find((n) => n.id === run.next_node_id);
    if (!node || node.kind !== 'human_gate') return { timedOut: false };

    const state = JSON.parse(run.state_json) as Record<string, unknown>;
    const requestedAtStr = (state.approvalRequestedAt as string) ?? run.updated_at;
    const requestedAt = new Date(requestedAtStr).getTime();
    const timeoutMs = (node.config.timeoutMs as number) ?? (24 * 60 * 60 * 1000);

    if (now.getTime() - requestedAt >= timeoutMs) {
      const timeoutAction = (node.config.timeoutAction as string) ?? 'escalate';
      logger.warn(`Graph run '${runId}' parked at '${node.id}' timed out after ${now.getTime() - requestedAt}ms (action: ${timeoutAction})`);

      // Update Attention item if linked
      const attentionItemId = state.attentionItemId as string | undefined;
      if (attentionItemId && this.attentionService) {
        try {
          const item = await this.attentionService.getItem(attentionItemId);
          if (item && item.status !== 'resolved' && item.status !== 'dismissed') {
            if (timeoutAction === 'reject') {
              await this.attentionService.resolveItem(attentionItemId, {
                action: 'rejected',
                notes: `Auto-rejected after ${timeoutMs}ms timeout waiting for human approval`,
              });
            } else if (timeoutAction === 'auto_approve') {
              await this.attentionService.resolveItem(attentionItemId, {
                action: 'approved',
                notes: `Auto-approved upon ${timeoutMs}ms timeout`,
              });
            } else {
              await this.attentionService.routeItem(attentionItemId, {
                assignedRole: item.assigned_role ?? 'admin',
                afterHours: 1,
              });
            }
          }
        } catch (err) {
          logger.warn(`Could not update attention item '${attentionItemId}' on timeout`, { err });
        }
      }

      let runResult: RunResult | null = null;
      if (timeoutAction === 'reject') {
        runResult = await this.resume(runId, {
          decision: 'rejected',
          timedOut: true,
          notes: `Timed out after ${timeoutMs}ms waiting for human approval`,
        });
      } else if (timeoutAction === 'auto_approve') {
        runResult = await this.resume(runId, {
          decision: 'approved',
          timedOut: true,
          notes: `Auto-approved upon timeout after ${timeoutMs}ms`,
        });
      } else {
        // default: escalate
        runResult = await this.finish(run, 'failed', 'escalated', state, `Human gate at '${node.id}' timed out; escalated to higher tier.`);
      }

      return {
        timedOut: true,
        action: timeoutAction,
        runResult,
      };
    }

    return { timedOut: false };
  }

  public async getRun(runId: string): Promise<GraphRunRecord | null> {
    return this.repo.getRun(runId);
  }

  private async drive(runId: string): Promise<RunResult> {
    for (;;) {
      const run = await this.mustGet(runId);
      const graph = JSON.parse(run.graph_json) as GraphDefinition;
      const state = JSON.parse(run.state_json) as Record<string, unknown>;
      const visits = JSON.parse(run.visits_json) as Record<string, number>;
      const node = graph.nodes.find((n) => n.id === run.next_node_id);
      if (!node) return this.finish(run, 'failed', 'failed', state, `Next node '${run.next_node_id}' not found.`);

      if (node.kind === 'end') {
        // An end may report a different outcome when actions ran in this run (e.g. agent loop finish).
        const actionsRan = typeof node.config.outcomeIfActions === 'string' && (await this.repo.listSideEffects(runId)).length > 0;
        const outcome = actionsRan ? (node.config.outcomeIfActions as OutcomeState) : node.outcome;
        await this.checkpoint(run, node, null, state, visits, 0, 'completed', outcome);
        if (this.observabilityService) {
          try {
            await this.observabilityService.completeTrace(runId, {
              status: 'completed',
            });
          } catch {}
        }
        return this.result(runId);
      }

      if (run.step_count >= graph.maxSteps) {
        return this.finish(run, 'failed', 'escalated', state, `maxSteps (${graph.maxSteps}) exceeded; escalated to a human.`);
      }
      const visit = (visits[node.id] ?? 0) + 1;
      if (node.maxVisits && visit > node.maxVisits) {
        return this.finish(run, 'failed', 'escalated', state, `Loop bound: node '${node.id}' exceeded maxVisits (${node.maxVisits}); escalated to a human.`);
      }

      const handler = this.handlers[node.kind];
      if (!handler) {
        return this.finish(run, 'failed', 'failed', state, `No handler configured for node kind '${node.kind}' (node '${node.id}').`);
      }

      const idempotencyKey = `${runId}:${node.id}:${visit}`;
      const started = Date.now();
      let outcome: NodeOutcome;
      try {
        const recorded = SIDE_EFFECT_KINDS.has(node.kind) ? await this.repo.getSideEffect(idempotencyKey) : null;
        if (recorded) {
          logger.info(`Graph run ${runId}: reusing recorded result for side-effect node '${node.id}' (no re-execution)`);
          outcome = { patch: recorded };
        } else {
          outcome = await handler({ runId, node, state, idempotencyKey, visit, graph });
          if (SIDE_EFFECT_KINDS.has(node.kind) && !outcome.park) {
            await this.repo.recordSideEffect(idempotencyKey, runId, node.id, outcome.patch ?? {});
          }
        }
      } catch (err) {
        if (this.observabilityService) {
          try {
            await this.observabilityService.recordSpan({
              traceId: runId,
              spanName: `${graph.id}:${node.id}`,
              agentId: graph.id,
              stepType: mapNodeKindToStepType(node.kind),
              status: 'error',
              latencyMs: Date.now() - started,
              inputSummary: `Step ${run.step_count + 1}: ${node.id} (${node.kind})`,
              outputSummary: `Error: ${err instanceof Error ? err.message : String(err)}`,
              attributes: {
                [SemanticAttributes.WORKFLOW_RUN_ID]: runId,
                [SemanticAttributes.WORKFLOW_GRAPH_ID]: graph.id,
                [SemanticAttributes.WORKFLOW_NODE_ID]: node.id,
                [SemanticAttributes.WORKFLOW_NODE_KIND]: node.kind,
                [SemanticAttributes.WORKFLOW_NODE_VISIT]: visit,
                [SemanticAttributes.WORKFLOW_STEP]: run.step_count + 1,
                error: err instanceof Error ? err.message : String(err),
              },
            });
          } catch {}
        }
        if (err instanceof RunInterrupted) throw err;
        return this.failWithCompensation(run, graph, state, `Node '${node.id}' failed: ${err instanceof Error ? err.message : String(err)}`);
      }

      const newState = { ...state, ...(outcome.patch ?? {}) };
      const newVisits = { ...visits, [node.id]: visit };

      if (this.observabilityService) {
        try {
          const stepType = mapNodeKindToStepType(node.kind);
          const tokensInput = (outcome.patch?.tokensInput as number) || (outcome.patch?.inputTokens as number) || 0;
          const tokensOutput = (outcome.patch?.tokensOutput as number) || (outcome.patch?.outputTokens as number) || 0;
          const costUsd = (outcome.patch?.costUsd as number) || (node.config.costUsd as number) || 0;
          const modelId = (outcome.patch?.modelId as string) || (node.config.modelId as string) || (node.config.model as string);
          const toolName = (outcome.patch?.toolName as string) || (node.config.tool as string) || (node.config.toolName as string);

          await this.observabilityService.recordSpan({
            traceId: runId,
            spanName: `${graph.id}:${node.id}`,
            agentId: graph.id,
            stepType,
            modelId,
            toolName,
            status: 'completed',
            latencyMs: Date.now() - started,
            tokensInput,
            tokensOutput,
            costUsd,
            inputSummary: `Step ${run.step_count + 1}: ${node.id} (${node.kind})`,
            outputSummary: outcome.park ? `Parked: ${outcome.park.reason}` : `Executed node '${node.id}'`,
            attributes: {
              [SemanticAttributes.WORKFLOW_RUN_ID]: runId,
              [SemanticAttributes.WORKFLOW_GRAPH_ID]: graph.id,
              [SemanticAttributes.WORKFLOW_NODE_ID]: node.id,
              [SemanticAttributes.WORKFLOW_NODE_KIND]: node.kind,
              [SemanticAttributes.WORKFLOW_NODE_VISIT]: visit,
              [SemanticAttributes.WORKFLOW_STEP]: run.step_count + 1,
              [SemanticAttributes.WORKFLOW_ACTION_TIER]: node.config.tier || (state.tier as string),
              [SemanticAttributes.PROOF_RECEIPT_ID]: (outcome.patch?.receipt as any)?.id,
              [SemanticAttributes.PROOF_RECEIPT_HASH]: (outcome.patch?.receipt as any)?.hash,
              [SemanticAttributes.VERIFICATION_STATE]: (outcome.patch?.verification as any)?.state,
              [SemanticAttributes.VERIFICATION_JOB_ID]: (outcome.patch?.verification as any)?.jobId,
              [SemanticAttributes.HUMAN_ATTENTION_ITEM_ID]: outcome.park?.attentionItemId || (outcome.patch?.attentionItemId as string),
              ...((node.config.attributes as Record<string, unknown>) || {}),
              ...((outcome.patch?.attributes as Record<string, unknown>) || {}),
            },
          });
        } catch (err) {
          logger.warn(`GraphExecutor: could not record span for node '${node.id}' in run '${runId}'`, { err });
        }
      }

      if (outcome.park) {
        await this.checkpoint(run, node, node.id, newState, newVisits, Date.now() - started, 'parked', undefined, outcome.park.reason);
        return this.result(runId);
      }

      const next = selectNext(graph, node.id, newState);
      if (!next) {
        return this.finish(run, 'failed', 'failed', newState, `No outgoing edge of '${node.id}' matched the state.`);
      }
      await this.checkpoint(run, node, next, newState, newVisits, Date.now() - started, 'running');
    }
  }

  /** Saves state + pointer + counters and an append-only checkpoint atomically. */
  private async checkpoint(
    run: GraphRunRecord,
    node: GraphNode,
    nextNodeId: string | null,
    state: Record<string, unknown>,
    visits: Record<string, number>,
    durationMs: number,
    status: GraphRunStatus,
    outcome?: OutcomeState,
    parkReason?: string
  ): Promise<void> {
    const fresh = await this.mustGet(run.id);
    const step = fresh.step_count + 1;
    const stateJson = JSON.stringify(state);
    await this.repo.inTransaction(async (tx) => {
      await this.repo.addCheckpoint(
        { run_id: run.id, step, node_id: node.id, node_kind: node.kind, next_node_id: nextNodeId, state_hash: hashState(state), state_json: stateJson, duration_ms: durationMs },
        tx
      );
      await this.repo.updateRun(
        run.id,
        {
          status,
          next_node_id: nextNodeId,
          state_json: stateJson,
          step_count: step,
          visits_json: JSON.stringify(visits),
          outcome: outcome ?? null,
          park_reason: parkReason ?? null,
        },
        tx
      );
    });
  }

  /**
   * Saga (docs/kriya WP-3.5): after an error, undo every recorded tool action of this run in reverse
   * order. All undone → 'compensated'; anything left standing → 'failed' naming what still needs a human.
   */
  private async failWithCompensation(run: GraphRunRecord, graph: GraphDefinition, state: Record<string, unknown>, error: string): Promise<RunResult> {
    const effects = (await this.repo.listSideEffects(run.id)).filter((e) => graph.nodes.find((n) => n.id === e.node_id)?.kind === 'tool');
    if (effects.length === 0 || !this.compensator) {
      const suffix = effects.length > 0 ? ` ${effects.length} completed action(s) were NOT undone (no compensator); a human must review.` : '';
      return this.finish(run, 'failed', 'failed', state, error + suffix);
    }
    const notUndone: string[] = [];
    for (const e of effects) {
      const node = graph.nodes.find((n) => n.id === e.node_id)!;
      try {
        await this.compensator(node, JSON.parse(e.patch_json), e.idempotency_key);
      } catch (err) {
        notUndone.push(`${node.id} (${err instanceof Error ? err.message : String(err)})`);
      }
    }
    return notUndone.length === 0
      ? this.finish(run, 'failed', 'compensated', state, `${error} — all ${effects.length} completed action(s) were reversed.`)
      : this.finish(run, 'failed', 'failed', state, `${error} — could NOT reverse: ${notUndone.join('; ')}; a human must review.`);
  }

  private async finish(run: GraphRunRecord, status: GraphRunStatus, outcome: OutcomeState, state: Record<string, unknown>, error: string): Promise<RunResult> {
    logger.warn(`Graph run ${run.id} ended ${status}/${outcome}: ${error}`);
    await this.repo.updateRun(run.id, { status, outcome, error_message: error, state_json: JSON.stringify(state) });
    if (this.observabilityService) {
      try {
        const traceStatus = outcome === 'escalated' ? 'escalated' : status === 'completed' ? 'completed' : 'failed';
        await this.observabilityService.completeTrace(run.id, {
          status: traceStatus,
        });
      } catch {}
    }
    return this.result(run.id);
  }

  private async result(runId: string): Promise<RunResult> {
    const run = await this.mustGet(runId);
    return {
      runId,
      status: run.status,
      outcome: (run.outcome ?? undefined) as OutcomeState | undefined,
      state: JSON.parse(run.state_json),
      parkReason: run.park_reason ?? undefined,
      error: run.error_message ?? undefined,
      steps: run.step_count,
    };
  }

  private async mustGet(runId: string): Promise<GraphRunRecord> {
    const run = await this.repo.getRun(runId);
    if (!run) throw new Error(`Graph run '${runId}' not found for this tenant.`);
    return run;
  }
}

/** First conditional edge (in definition order) whose conditions all hold; else the default edge. */
export function selectNext(graph: GraphDefinition, nodeId: string, state: Record<string, unknown>): string | null {
  const edges = graph.edges.filter((e) => e.from === nodeId);
  const match = edges.find((e) => e.when && e.when.length > 0 && e.when.every((c) => evaluateCondition(c, state)));
  if (match) return match.to;
  return edges.find((e) => !e.when || e.when.length === 0)?.to ?? null;
}

/** SHA-256 over canonical JSON (sorted keys at every depth) so equal states hash equally. */
export function hashState(state: unknown): string {
  return sha256Canonical(state);
}
