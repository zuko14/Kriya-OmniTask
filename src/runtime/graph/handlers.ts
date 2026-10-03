/**
 * Kriya Omnitask — Graph node handlers wired to the real platform (docs/kriya WP-2.2b, WP-3.4)
 *
 *   llm       → Model Gateway (certified models, named Zod schema, one repair); minimal context
 *   cascade   → L0 rule → L1 tenant cache (DB) → L2 small model → L3 frontier → unresolved (graph routes to a human)
 *   policy    → PolicyEngine           → state.policy   {decision: allow | require_approval | block}
 *   mandate   → MandateService         → state.mandate  {decision: allow | over_limit | denied}
 *   tool      → ToolGateway with the run's idempotency key; parks when the tool needs approval
 *   verify    → the tool's own verify() read-back; no verify() ⇒ 'unverifiable', NEVER 'verified'
 *   proof     → ProofService signed receipt; refuses unless verification.state === 'verified'
 *   subgraph  → HierarchicalOrchestrator agent delegation
 *   rule      → named deterministic functions
 * plus a Compensator that undoes recorded tool actions via the tool's compensate() (saga).
 */

import { ZodTypeAny } from 'zod';
import { NodeHandlers, NodeContext, Compensator } from './executor.js';
import { GraphNode } from './types.js';
import { canonicalJson } from '../../core/utils/canonicalJson.js';
import { CryptoUtils } from '../../core/utils/crypto.js';
import { db, DatabaseClient } from '../../storage/db.js';
import { ModelGateway, StructuredOutputError, GatewayRefusedError, GatewayEscalationError } from '../../model/gateway/modelGateway.js';
import { CapabilityTier } from '../../model/certification/certificationTypes.js';
import { PolicyEngine, EvaluatePolicyRequest } from '../../policy/engine/policyEngine.js';
import { MandateService } from '../../trust/mandate/mandateService.js';
import { ProofService } from '../../trust/proof/proofService.js';
import { toActionTier } from '../../trust/riskTiers.js';
import { ToolGateway } from '../../tools/gateway/toolGateway.js';
import { ToolRegistryService } from '../../tools/registry/toolRegistry.js';
import { CredentialVault } from '../../tools/vault/credentialVault.js';
import { HierarchicalOrchestrator } from '../../orchestration/orchestrator/hierarchicalOrchestrator.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import { DataInterpolator } from '../../workflows/interpolator/dataInterpolator.js';

export type RuleFn = (state: Readonly<Record<string, unknown>>, config: Record<string, unknown>, ctx: NodeContext) => Record<string, unknown> | Promise<Record<string, unknown>>;

export interface RuntimeDeps {
  /** The agent acting in this graph: used for Mandate checks and receipts. */
  agentSlug: string;
  /** The acting agent's charter version: recorded on every receipt (WP-4.1). */
  agentVersion?: string;
  gateway?: ModelGateway;
  schemas?: Record<string, ZodTypeAny>;
  policyEngine?: PolicyEngine;
  mandateService?: MandateService;
  proofService?: ProofService;
  toolGateway?: ToolGateway;
  toolRegistry?: ToolRegistryService;
  orchestrator?: HierarchicalOrchestrator;
  rules?: Record<string, RuleFn>;
  /** Database for the L1 cascade cache; defaults to the shared client. */
  dbClient?: DatabaseClient;
}

export function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o !== null && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);
}

function pick(state: Readonly<Record<string, unknown>>, paths: unknown): Record<string, unknown> {
  if (!Array.isArray(paths)) return {};
  return Object.fromEntries(paths.map((p) => [String(p), getPath(state, String(p))]));
}

function fill(template: string, state: Readonly<Record<string, unknown>>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, p) => {
    const v = getPath(state, p);
    return v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v);
  });
}

const str = (v: unknown, fallback: string) => (typeof v === 'string' && v.length > 0 ? v : fallback);

/** Builds a top-level patch that writes `value` at a (possibly dotted) path, preserving siblings. */
export function writeAt(state: Readonly<Record<string, unknown>>, path: string, value: unknown): Record<string, unknown> {
  const [top, ...rest] = path.split('.');
  if (rest.length === 0) return { [top]: value };
  const root = structuredClone((state[top] as Record<string, unknown>) ?? {});
  let cur: Record<string, unknown> = root;
  for (const k of rest.slice(0, -1)) {
    cur[k] = typeof cur[k] === 'object' && cur[k] !== null ? cur[k] : {};
    cur = cur[k] as Record<string, unknown>;
  }
  cur[rest[rest.length - 1]] = value;
  return { [top]: root };
}

export const BUILTIN_RULES: Record<string, RuleFn> = {
  /** Records a not-before time; real waiting is the scheduler's job (WP-5.9), the graph never sleeps. */
  delay: (_s, config) => ({ notBefore: new Date(Date.now() + Number(config.delayMs ?? 0)).toISOString() }),
};

export function createRuntimeHandlers(deps: RuntimeDeps): { handlers: NodeHandlers; compensator: Compensator } {
  const registry = deps.toolRegistry ?? new ToolRegistryService();
  const toolGateway = deps.toolGateway ?? new ToolGateway({ toolRegistry: registry });
  const policyEngine = deps.policyEngine ?? new PolicyEngine();
  const mandates = deps.mandateService ?? new MandateService();
  const proofs = deps.proofService ?? new ProofService();
  const rules = { ...BUILTIN_RULES, ...(deps.rules ?? {}) };
  const vault = new CredentialVault();
  const dbc = () => deps.dbClient ?? db.getClient();
  const toolCtx = (idempotencyKey?: string) => ({ tenantId: TenantContextManager.getTenantId(), idempotencyKey, vault });

  const schemaFor = (node: GraphNode): ZodTypeAny => {
    const schema = deps.schemas?.[String(node.config.outputSchema)];
    if (!schema) throw new Error(`No output schema registered under '${String(node.config.outputSchema)}'.`);
    return schema;
  };
  const callModel = (node: GraphNode, state: Readonly<Record<string, unknown>>, taskId: string, tier: CapabilityTier) =>
    (deps.gateway ?? new ModelGateway()).complete({
      tenantId: TenantContextManager.getTenantId(),
      taskId,
      tier,
      language: typeof state.language === 'string' ? state.language : undefined,
      agentSlug: deps.agentSlug,
      systemPrompt: str(node.config.systemPrompt, 'Reply with one JSON object.'),
      userPrompt: fill(str(node.config.userPrompt, '{{request}}'), state),
      contextData: pick(state, node.config.contextPaths),
      schema: schemaFor(node),
      temperature: typeof node.config.temperature === 'number' ? node.config.temperature : 0,
    });

  const handlers: NodeHandlers = {
    llm: async ({ node, state, idempotencyKey }) => {
      const res = await callModel(node, state, idempotencyKey, (node.config.tier as CapabilityTier) ?? 'T2');
      return {
        patch: {
          ...writeAt(state, str(node.config.writeTo, node.id), res.parsed),
          costUsd: Number(state.costUsd ?? 0) + res.costUsd,
          lastModel: { id: res.modelUsed, source: res.selection.source, repairAttempted: res.repairAttempted },
        },
      };
    },

    cascade: async (ctx) => {
      const { node, state, idempotencyKey } = ctx;
      const schema = schemaFor(node);
      const writeTo = str(node.config.writeTo, node.id);
      const trail: Array<{ level: string; result: string }> = [];
      let costUsd = Number(state.costUsd ?? 0);
      let lastModel = state.lastModel;
      const resolved = (level: string, value: unknown) => ({
        patch: { ...writeAt(state, writeTo, value), costUsd, lastModel, cascade: { ...((state.cascade as object) ?? {}), [node.id]: { level, trail } } },
      });

      // L0: a deterministic rule. Its output is schema-checked too: rules can be wrong.
      if (typeof node.config.rule === 'string') {
        const fn = rules[node.config.rule];
        if (!fn) throw new Error(`No rule registered under '${node.config.rule}'.`);
        const out = await fn(state, node.config, ctx);
        const parsed = out.match === undefined ? undefined : schema.safeParse(out.match);
        if (parsed?.success) return resolved('L0', parsed.data);
        trail.push({ level: 'L0', result: parsed ? 'rule output failed the schema' : 'no rule matched' });
      }

      // L1: per-tenant exact cache; the knowledge version is in the key, so a new version misses.
      const tenantId = TenantContextManager.getTenantId();
      const cacheKey = node.config.cache
        ? CryptoUtils.hashSha256(
            canonicalJson([
              node.config.outputSchema,
              String(getPath(state, str(node.config.knowledgeVersionPath, 'knowledgeVersion')) ?? ''),
              fill(str(node.config.userPrompt, '{{request}}'), state).trim().toLowerCase().replace(/\s+/g, ' '),
              pick(state, node.config.contextPaths),
            ])
          )
        : undefined;
      const hit = cacheKey
        ? await dbc().queryOne<{ value_json: string }>('SELECT value_json FROM cascade_cache WHERE tenant_id = ? AND cache_key = ? AND expires_at > ?', [tenantId, cacheKey, new Date().toISOString()])
        : null;
      if (hit) {
        const cached = schema.safeParse(JSON.parse(hit.value_json));
        if (cached.success) return resolved('L1', cached.data);
        trail.push({ level: 'L1', result: 'cached value no longer matches the schema' });
      }
      if (cacheKey) trail.push({ level: 'L1', result: 'cache miss' });

      // L2 small → L3 frontier, both within the owner's certified models. Still unsure → a human, never a bigger guess.
      const minConfidence = typeof node.config.minConfidence === 'number' ? node.config.minConfidence : undefined;
      const levels: Array<[string, CapabilityTier]> = [['L2', (node.config.smallTier as CapabilityTier) ?? 'T1'], ['L3', (node.config.frontierTier as CapabilityTier) ?? 'T3']];
      for (const [level, tier] of levels) {
        try {
          const res = await callModel(node, state, `${idempotencyKey}:${level}`, tier);
          costUsd += res.costUsd;
          lastModel = { id: res.modelUsed, source: res.selection.source, repairAttempted: res.repairAttempted };
          if (minConfidence !== undefined) {
            const c = getPath(res.parsed, str(node.config.confidencePath, 'confidence'));
            if (typeof c !== 'number' || c < minConfidence) {
              trail.push({ level, result: `confidence ${typeof c === 'number' ? c : 'missing'} below ${minConfidence}` });
              continue;
            }
          }
          if (cacheKey) {
            const now = new Date();
            const expires = new Date(now.getTime() + Number(node.config.cacheTtlSeconds ?? 3600) * 1000).toISOString();
            await dbc().execute('DELETE FROM cascade_cache WHERE tenant_id = ? AND expires_at <= ?', [tenantId, now.toISOString()]);
            await dbc().execute(
              `INSERT INTO cascade_cache (tenant_id, cache_key, schema_name, value_json, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT (tenant_id, cache_key) DO UPDATE SET value_json = excluded.value_json, expires_at = excluded.expires_at`,
              [tenantId, cacheKey, String(node.config.outputSchema), JSON.stringify(res.parsed), expires, now.toISOString()]
            );
          }
          return resolved(level, res.parsed);
        } catch (err) {
          if (!(err instanceof StructuredOutputError || err instanceof GatewayRefusedError || err instanceof GatewayEscalationError)) throw err;
          trail.push({ level, result: err.message });
        }
      }
      // Unresolved: `writeTo` stays unset; the graph's default edge routes to a human.
      return { patch: { costUsd, lastModel, cascade: { ...((state.cascade as object) ?? {}), [node.id]: { level: 'human', trail } } } };
    },

    policy: async ({ node, state }) => {
      const res = await policyEngine.evaluate({
        actionType: (node.config.actionType as EvaluatePolicyRequest['actionType']) ?? 'tool_execution',
        category: node.config.category as EvaluatePolicyRequest['category'],
        context: Array.isArray(node.config.contextPaths) ? pick(state, node.config.contextPaths) : { ...state },
        actorType: 'agent',
        actorId: deps.agentSlug,
      });
      const decision = res.allowed && !res.requiresApproval ? 'allow' : res.requiresApproval || res.escalated ? 'require_approval' : 'block';
      return { patch: { [str(node.config.writeTo, 'policy')]: { decision, verdict: res.verdict, ruleIds: res.violations.map((v) => v.ruleSlug) } } };
    },

    mandate: async ({ node, state }) => {
      const scopePaths = (node.config.scopePaths ?? {}) as Record<string, string>;
      const scope = Object.fromEntries(Object.entries(scopePaths).map(([k, p]) => [k, String(getPath(state, p) ?? '')]));
      const amountRaw = typeof node.config.amount === 'number' ? node.config.amount : typeof node.config.amountPath === 'string' ? getPath(state, node.config.amountPath) : undefined;
      const res = await mandates.authorize({
        agentSlug: deps.agentSlug,
        actionType: str(node.config.actionType, 'unspecified'),
        amount: amountRaw === undefined ? undefined : Number(amountRaw),
        currency: typeof node.config.currency === 'string' ? node.config.currency : undefined,
        scope,
      });
      return { patch: { [str(node.config.writeTo, 'mandate')]: res } };
    },

    tool: async ({ node, state, idempotencyKey }) => {
      const toolSlug = str(node.config.tool, '');
      const fromState = typeof node.config.inputPath === 'string' ? (getPath(state, node.config.inputPath) as Record<string, unknown>) ?? {} : {};
      const rawInput = { ...((node.config.input as Record<string, unknown>) ?? {}), ...fromState };
      // Compiled workflows keep their ${context.x} / ${steps.y.output.z} templates.
      const input = node.config.interpolate
        ? DataInterpolator.interpolate(rawInput, { context: (state.context as Record<string, unknown>) ?? {}, steps: (state.steps as any) ?? {} })
        : rawInput;
      // Identity-bound args (e.g. customerRef) come from run state, overriding anything the model proposed.
      for (const [arg, path] of Object.entries((node.config.bindPaths as Record<string, string>) ?? {})) {
        const value = getPath(state, path);
        if (value === undefined || value === null || value === '') throw new Error(`tool '${toolSlug}': bound argument '${arg}' has no value at '${path}'.`);
        (input as Record<string, unknown>)[arg] = value;
      }
      const res = await toolGateway.executeTool({
        toolSlug,
        input,
        idempotencyKey,
        bypassApproval: getPath(state, 'approval.decision') === 'approved',
      });
      if (res.requiresHumanApproval) return { park: { reason: `Tool '${toolSlug}' requires human approval (execution ${res.executionId}).` } };
      const record = { tool: toolSlug, input, result: res.result ?? {}, executionId: res.executionId };
      const patch = writeAt(state, str(node.config.writeTo, 'action'), record);
      // Optionally also expose the bare result (compiled workflows: {{steps.<id>.output.*}}).
      if (typeof node.config.writeResultTo === 'string') Object.assign(patch, writeAt({ ...state, ...patch }, node.config.writeResultTo, record.result));
      return { patch };
    },

    verify: async ({ node, state, idempotencyKey }) => {
      const action = getPath(state, str(node.config.actionPath, 'action')) as { tool: string; input: Record<string, unknown>; result: Record<string, unknown> } | undefined;
      if (!action) throw new Error('verify: no action in state to verify.');
      const tool = registry.getTool(action.tool);
      const writeTo = str(node.config.writeTo, 'verification');
      if (!tool?.verify) {
        return { patch: writeAt(state, writeTo, { state: 'unverifiable', method: 'none', reason: `Tool '${action.tool}' has no verify() read-back.` }) };
      }
      const v = await tool.verify(action.input, action.result, toolCtx(idempotencyKey));
      return { patch: writeAt(state, writeTo, { state: v.state, observed: v.observed ?? {}, method: 'readback', verifiedAt: new Date().toISOString() }) };
    },

    proof: async ({ node, state, runId }) => {
      const action = getPath(state, str(node.config.actionPath, 'action')) as { tool: string; input: unknown; result: Record<string, unknown> } | undefined;
      const verification = getPath(state, str(node.config.verificationPath, 'verification')) as { state: string; method: string; observed?: unknown; verifiedAt?: string } | undefined;
      if (!action) throw new Error('proof: no action in state.');
      if (verification?.state !== 'verified') {
        throw new Error(`proof: refusing to issue a receipt for an action whose verification is '${verification?.state ?? 'missing'}'.`);
      }
      const tool = registry.getTool(action.tool);
      const policy = state.policy as { decision: string; ruleIds?: string[] } | undefined;
      const mandate = state.mandate as { decision: string; mandateId?: string; mandateVersion?: number } | undefined;
      const externalRef = Object.entries(action.result ?? {}).find(([k, v]) => /id$/i.test(k) && typeof v === 'string')?.[1] as string | undefined;
      const receipt = await proofs.issue({
        runId,
        nodeId: node.id,
        actionType: action.tool,
        riskTier: tool ? toActionTier(tool.definition.riskTier) : 'T1',
        actor: { agentSlug: deps.agentSlug, agentVersion: deps.agentVersion, modelId: (state.lastModel as { id?: string } | undefined)?.id, humanApproverId: getPath(state, 'approval.by') as string | undefined },
        policy: policy ? { decision: policy.decision, ruleIds: policy.ruleIds } : undefined,
        mandate: mandate ? { id: mandate.mandateId, version: mandate.mandateVersion, decision: mandate.decision } : undefined,
        input: action.input,
        output: action.result,
        target: { system: action.tool, externalRef },
        verification: { method: verification.method, state: verification.state, observed: verification.observed, verifiedAt: verification.verifiedAt },
      });
      return { patch: writeAt(state, str(node.config.writeTo, 'receipt'), { id: receipt.body.receiptId, sequence: receipt.body.sequence, hash: receipt.hash }) };
    },

    subgraph: async ({ node, state }) => {
      const orchestrator = deps.orchestrator ?? new HierarchicalOrchestrator();
      const objective = typeof node.config.objectivePath === 'string' ? String(getPath(state, node.config.objectivePath) ?? '') : fill(str(node.config.objective, ''), state);
      const res = await orchestrator.dispatch({
        objective,
        entryAgentSlug: str(node.config.agentSlug, ''),
        contextData: { ...pick(state, node.config.contextPaths), ...((node.config.inputData as Record<string, unknown>) ?? {}) },
      });
      if (res.status === 'needs_approval' || res.status === 'escalated') {
        return { park: { reason: `Agent '${node.config.agentSlug}' needs a human: ${res.primaryOutcome.recommendedAction}` } };
      }
      if (res.status !== 'completed') throw new Error(`Agent '${node.config.agentSlug}' ended '${res.status}': ${res.primaryOutcome.recommendedAction}`);
      return { patch: { ...writeAt(state, str(node.config.writeTo, node.id), res.primaryOutcome), costUsd: Number(state.costUsd ?? 0) + res.totalCostUsd } };
    },

    rule: async (ctx) => {
      const name = str(ctx.node.config.rule, '');
      const fn = rules[name];
      if (!fn) throw new Error(`No rule registered under '${name}'.`);
      return { patch: await fn(ctx.state, ctx.node.config, ctx) };
    },
  };

  const compensator: Compensator = async (node, recorded, idempotencyKey) => {
    const action = getPath(recorded, str(node.config.writeTo, 'action')) as { tool: string; input: Record<string, unknown>; result: Record<string, unknown> } | undefined;
    if (!action) throw new Error('no recorded action');
    const tool = registry.getTool(action.tool);
    if (!tool?.compensate) throw new Error(`tool '${action.tool}' has no compensate()`);
    await tool.compensate(action.input, action.result, toolCtx(`${idempotencyKey}:compensate`));
    await proofs.issue({
      nodeId: node.id,
      actionType: `${action.tool}.compensate`,
      riskTier: toActionTier(tool.definition.riskTier),
      actor: { agentSlug: deps.agentSlug, agentVersion: deps.agentVersion },
      input: action.input,
      output: action.result,
      target: { system: action.tool },
      verification: { method: 'compensation', state: 'compensated', verifiedAt: new Date().toISOString() },
    });
  };

  return { handlers, compensator };
}
