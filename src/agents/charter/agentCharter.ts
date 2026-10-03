/**
 * Kriya Omnitask — Agent charters (docs/kriya WP-4.1, 02 §9: "charters, not prompts")
 *
 * A charter is the formal, versioned contract for one agent: the outcome it owns, the closed list
 * of tools it may use, the state it may see, the highest risk tier it may execute WITHOUT a human,
 * and its budgets. Code turns a charter into the bounded agent loop (WP-2.3):
 *   - tool risk tiers come from the tool registry (one source of truth, WP-3.2), never the charter;
 *   - a tool above the autonomy cap gets a human gate on every use; T2/T3 still pass Mandate;
 *   - the planning model sees only `dataScope` paths; budgets bound iterations and spend.
 * Published versions are append-only and hashed; receipts name the version that acted.
 */

import { z, ZodTypeAny } from 'zod';
import { DatabaseClient, db } from '../../storage/db.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import { CryptoUtils } from '../../core/utils/crypto.js';
import { canonicalJson } from '../../core/utils/canonicalJson.js';
import { auditLogger } from '../../security/audit/auditLogger.js';
import { ConflictError, NotFoundError, ValidationError } from '../../core/errors/errors.js';
import { ActionTier, ActionTierSchema } from '../../runtime/graph/types.js';
import { AgentLoopSpec, buildAgentLoop } from '../../runtime/graph/agentLoop.js';
import { ToolRegistryService } from '../../tools/registry/toolRegistry.js';
import { toActionTier } from '../../trust/riskTiers.js';
import { RuleFn } from '../../runtime/graph/handlers.js';
import { GraphDefinition } from '../../runtime/graph/types.js';
import { buildIntakeAgent, IntakeDeps, IntakeSettingsSchema } from '../phase0/intakeAgent.js';

/**
 * Fixed-graph agents (a designed graph instead of the open agent loop). Each validates its own settings,
 * so a charter cannot be published with settings the graph would reject.
 */
export const FIXED_GRAPHS = {
  intake: { settingsSchema: IntakeSettingsSchema },
} as const;
export type FixedGraphId = keyof typeof FIXED_GRAPHS;

const SLUG = /^[a-z0-9_-]+$/;

export const AgentCharterSchema = z
  .object({
    slug: z.string().min(2).max(64).regex(SLUG),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    /** The business outcome this agent is accountable for. */
    owns: z.string().min(3).max(200),
    /** Instruction for the planning step. Policy, tiers and limits are NOT here: code enforces them. */
    goal: z.string().min(10).max(4000),
    tools: z
      .array(
        z.object({
          slug: z.string().min(1).regex(SLUG),
          /** What the planner is told about the tool and its args. */
          description: z.string().min(3).max(500),
          /** Plan arg holding a money amount, checked against the Mandate (T2/T3 tools). */
          amountArg: z.string().regex(/^[a-zA-Z0-9_.]+$/).optional(),
          /** Args set by code from run state (arg → state path), e.g. {customerRef: 'customer.ref'}. */
          bind: z.record(z.string().regex(/^[a-zA-Z0-9_.]+$/)).optional(),
        })
      )
      .max(12)
      .default([])
      .refine((ts) => new Set(ts.map((t) => t.slug)).size === ts.length, { message: 'tool slugs must be unique' }),
    /** Run a registered fixed graph instead of the agent loop; `settings` configure it. */
    graph: z.enum(Object.keys(FIXED_GRAPHS) as [FixedGraphId, ...FixedGraphId[]]).optional(),
    settings: z.record(z.unknown()).default({}),
    /** State paths the planning model may see (context minimisation). */
    dataScope: z.array(z.string().regex(/^[a-zA-Z0-9_.]+$/)).min(1).default(['context']),
    /** Highest tier executed without a human. Above it, every action waits for approval. */
    autonomyTierCap: ActionTierSchema,
    budgets: z
      .object({
        maxIterations: z.number().int().min(1).max(12).default(6),
        maxCostUsd: z.number().positive().max(5).default(0.05),
      })
      .default({}),
    /** Capability tier the planning step needs; the Model Gateway only uses models certified for it. */
    modelTier: z.enum(['T1', 'T2', 'T3', 'T4']).default('T2'),
    /** Golden eval suite gating this version (evals-as-CI, WP-6.2). */
    evalSuiteId: z.string().min(1).optional(),
    /** Accountable human or team. */
    owner: z.string().min(1),
  })
  .strict()
  .refine((c) => c.graph !== undefined || c.tools.length > 0, { message: 'an agent-loop charter needs at least one tool', path: ['tools'] })
  .refine((c) => c.graph === undefined || c.tools.length === 0, { message: 'a fixed-graph charter declares no loop tools (its graph defines what it can do)', path: ['tools'] })
  .refine((c) => c.graph !== undefined || Object.keys(c.settings).length === 0, { message: 'settings are only for fixed-graph charters', path: ['settings'] });
export type AgentCharter = z.infer<typeof AgentCharterSchema>;
export type AgentCharterInput = z.input<typeof AgentCharterSchema>;

const TIER_RANK: Record<ActionTier, number> = { T0: 0, T1: 1, T2: 2, T3: 3 };

/** Binds a charter to the registry and returns the loop spec. Throws ValidationError on an unknown tool. */
export function charterToLoopSpec(
  input: AgentCharterInput,
  registry: ToolRegistryService,
  overrideAutonomyTierCap?: ActionTier
): AgentLoopSpec {
  const charter = AgentCharterSchema.parse(input);
  if (charter.graph) throw new ValidationError(`Charter '${charter.slug}' runs the fixed graph '${charter.graph}', not the agent loop.`);
  const effectiveTierCap = overrideAutonomyTierCap ?? charter.autonomyTierCap;
  return {
    id: `${charter.slug}.loop`.replace(/[^a-z0-9_.-]/g, '_'),
    goal: charter.goal,
    tier: charter.modelTier,
    maxIterations: charter.budgets.maxIterations,
    maxCostUsd: charter.budgets.maxCostUsd,
    contextPaths: charter.dataScope,
    tools: charter.tools.map((t) => {
      const registered = registry.getTool(t.slug);
      if (!registered) throw new ValidationError(`Charter '${charter.slug}' names tool '${t.slug}', which is not registered.`);
      const tier = toActionTier(registered.definition.riskTier);
      return {
        slug: t.slug,
        tier,
        description: t.description,
        ...(t.amountArg ? { amountArg: t.amountArg } : {}),
        ...(t.bind ? { bind: t.bind } : {}),
        ...(TIER_RANK[tier] > TIER_RANK[effectiveTierCap] ? { requireApproval: true } : {}),
      };
    }),
  };
}

export interface BuiltAgent {
  graph: GraphDefinition;
  schemas: Record<string, ZodTypeAny>;
  rules: Record<string, RuleFn>;
  /** Pass to createRuntimeHandlers so receipts name the acting version. */
  agentSlug: string;
  agentVersion: string;
}

/** The one way to turn a charter into a runnable graph (agent loop or fixed graph). */
export function buildAgentFromCharter(
  input: AgentCharterInput,
  opts: {
    registry: ToolRegistryService;
    intake?: Omit<IntakeDeps, 'settings'>;
    effectiveAutonomyTierCap?: ActionTier;
  }
): BuiltAgent {
  const charter = AgentCharterSchema.parse(input);
  const base = { agentSlug: charter.slug, agentVersion: charter.version };
  if (charter.graph === 'intake') {
    const settings = FIXED_GRAPHS.intake.settingsSchema.parse(charter.settings);
    const { graph, schemas, rules } = buildIntakeAgent({ ...opts.intake, settings });
    return { graph, schemas, rules, ...base };
  }
  const { graph, schemas, rules } = buildAgentLoop(
    charterToLoopSpec(charter, opts.registry, opts.effectiveAutonomyTierCap)
  );
  return { graph, schemas, rules, ...base };
}

/** Default Intake charter (WP-4.2): T0, a fixed graph, no tools; tenants override `settings`. */
export const DEFAULT_INTAKE_CHARTER: AgentCharterInput = {
  slug: 'intake',
  version: '1.0.0',
  owns: 'first contact: safety triage, consent, intent capture and hand-off',
  goal: 'Understand what the customer needs and hand it to the agent or person who owns it. Answer questions only from verified knowledge.',
  graph: 'intake',
  autonomyTierCap: 'T0',
  modelTier: 'T1',
  owner: 'operations_lead',
  evalSuiteId: 'intake-golden-v1',
};

export interface CharterRecord {
  id: string;
  tenant_id: string;
  agent_slug: string;
  version: string;
  charter_json: string;
  charter_hash: string;
  published_by: string;
  created_at: string;
  updated_at: string;
}

export interface PublishedCharter {
  charter: AgentCharter;
  hash: string;
  publishedBy: string;
  publishedAt: string;
}

export class CharterService {
  constructor(
    private readonly registry: ToolRegistryService,
    private readonly customClient?: DatabaseClient
  ) {}

  private get client(): DatabaseClient {
    return this.customClient ?? db.getClient();
  }

  /**
   * Publishes a charter version. Refused if a tool is unknown or the resulting graph is unsafe
   * (buildAgentLoop runs the static validator). Re-publishing identical content is a no-op;
   * different content under an existing version is a conflict — versions are immutable.
   */
  public async publish(input: AgentCharterInput, publishedBy: string): Promise<PublishedCharter> {
    const charter = AgentCharterSchema.parse(input);
    buildAgentFromCharter(charter, { registry: this.registry }); // refuses unknown tools, invalid settings, unsafe graphs
    const tenantId = TenantContextManager.getTenantId();

    const agent = await this.client.queryOne<{ id: string }>('SELECT id FROM agents WHERE tenant_id = ? AND slug = ?', [tenantId, charter.slug]);
    if (!agent) throw new NotFoundError(`No agent '${charter.slug}' in this tenant; register the agent before publishing its charter.`);

    const hash = CryptoUtils.hashSha256(canonicalJson(charter));
    const existing = await this.client.queryOne<CharterRecord>(
      'SELECT * FROM agent_charters WHERE tenant_id = ? AND agent_slug = ? AND version = ?',
      [tenantId, charter.slug, charter.version]
    );
    if (existing) {
      if (existing.charter_hash !== hash) {
        throw new ConflictError(`Charter '${charter.slug}' ${charter.version} is already published with different content; publish a new version.`);
      }
      return this.toPublished(existing);
    }

    const now = new Date().toISOString();
    const id = `chr_${CryptoUtils.generateId()}`;
    await this.client.transaction(async (tx) => {
      await tx.execute(
        `INSERT INTO agent_charters (id, tenant_id, agent_slug, version, charter_json, charter_hash, published_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, tenantId, charter.slug, charter.version, canonicalJson(charter), hash, publishedBy, now, now]
      );
      await tx.execute('UPDATE agents SET version = ?, updated_at = ? WHERE id = ? AND tenant_id = ?', [charter.version, now, agent.id, tenantId]);
    });
    await auditLogger.logEvent({ action: 'agent.charter_published', resourceType: 'agent', resourceId: agent.id, details: { slug: charter.slug, version: charter.version, hash, publishedBy } });
    return { charter, hash, publishedBy, publishedAt: now };
  }

  /** A specific version, or the highest published one. Re-checks the stored hash (tamper-evident). */
  public async get(slug: string, version?: string): Promise<PublishedCharter | null> {
    if (!version) return (await this.history(slug)).at(-1) ?? null;
    const row = await this.client.queryOne<CharterRecord>(
      'SELECT * FROM agent_charters WHERE tenant_id = ? AND agent_slug = ? AND version = ?',
      [TenantContextManager.getTenantId(), slug, version]
    );
    return row ? this.toPublished(row) : null;
  }

  /** All published versions, lowest semver first. */
  public async history(slug: string): Promise<PublishedCharter[]> {
    const rows = await this.client.query<CharterRecord>(
      'SELECT * FROM agent_charters WHERE tenant_id = ? AND agent_slug = ?',
      [TenantContextManager.getTenantId(), slug]
    );
    const semver = (v: string) => v.split('.').map(Number);
    rows.sort((a, b) => {
      const [x, y] = [semver(a.version), semver(b.version)];
      return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
    });
    return rows.map((r) => this.toPublished(r));
  }

  private toPublished(row: CharterRecord): PublishedCharter {
    const charter = AgentCharterSchema.parse(JSON.parse(row.charter_json));
    if (CryptoUtils.hashSha256(canonicalJson(charter)) !== row.charter_hash) {
      throw new Error(`Charter '${row.agent_slug}' ${row.version} failed its integrity check (stored content does not match its hash).`);
    }
    return { charter, hash: row.charter_hash, publishedBy: row.published_by, publishedAt: row.created_at };
  }
}
