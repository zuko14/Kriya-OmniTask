# ADR-010 — Agent charters and the cost cascade node

**Status:** Accepted · 2026-10-01 · Session 07 (WP-4.1, WP-2.4)

## Context
Blueprint §14-15 and `docs/kriya/02_TARGET_ARCHITECTURE.md` §5 and §9 require agents defined by charters,
not prompts, and every decision tried at the cheapest level first. Before this session, agents were rows
with a free-form `config_json`. Every model decision called the model directly.

## Decision
1. **Charters** (`src/agents/charter/agentCharter.ts`, migration 040) are versioned, append-only and
   content-hashed per tenant. A charter names the outcome the agent owns, a closed tool list, the state paths
   the planner may see (`dataScope`), an autonomy tier cap, budgets, the model tier, an eval suite and an owner.
   Code binds a charter to the bounded agent loop:
   - risk tiers come from the tool registry, never from the charter;
   - a tool above the cap gets a human gate on every use, and T2/T3 still pass Mandate;
   - publishing runs the graph validator, so an unsafe charter cannot be published;
   - receipts record `actor.agentVersion`.
2. **`cascade` node kind** (`src/runtime/graph/handlers.ts`) runs the levels in order: L0 named rule
   (schema-checked) → L1 per-tenant exact cache → L2 small-tier model → L3 frontier-tier model → unresolved.
   - The L1 cache key covers tenant, schema, knowledge version, normalised prompt and context.
   - Only accepted answers are cached.
   - A missing confidence counts as below threshold.
   - Unresolved leaves the output unset. The validator requires a default edge, which routes to a human.
   - Schema and gateway failures climb a level and are recorded in a trail. Other errors propagate.

## Consequences
- The L1 cache is a tenant-scoped table (`cascade_cache`, migration 041). It survives restarts and is shared
  by instances on the same database. Expired rows are pruned on write. Values are re-validated against the schema on read.
- Charters can name a registered **fixed graph** (`graph: 'intake'`) with `settings` validated by that graph.
  Such charters declare no loop tools. `buildAgentFromCharter` is the one way to turn any charter into a runnable graph.
  `DEFAULT_INTAKE_CHARTER` is the Intake charter (T0, eval suite `intake-golden-v1`).
- Activating an older charter version (rollback) is not built. `agents.version` points at the last published version.
