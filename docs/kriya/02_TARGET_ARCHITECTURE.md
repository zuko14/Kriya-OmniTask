# 02 — Target Architecture: Kriya Omnitask

Source of direction: blueprint §03, §04, §13, §14, §15, §28. Changes to this document go through
an ADR in `docs/architecture/decisions/`. Supersedes `docs/architecture/target-architecture.md`
(Xylarc era) for this program.

## 1. The one primitive: the Verified Action

Every vertical product is a set of these. Nothing else is the core.

```
Intent ─► Authorise ─► Decide ─► Execute ─► Verify ─► Prove ─► Notify
(models)  (Mandate)   (policy,   (tools,    (read-back (signed,  (only after
                       state      Reach,     from the   hash-     the receipt
                       machine,   channels)  target     chained   exists)
                       NOT model)            system)    receipt)
             └──────── any failure or uncertainty ─► Escalate (by risk tier) ───┘
```

Outcome states (closed enum, used everywhere, including UI):

| State | Meaning | Reported to user as |
|---|---|---|
| `proposed` | Model proposed an action; nothing executed | "Preparing…" |
| `blocked` | Policy, Mandate or firewall refused | "Needs review" + reason |
| `awaiting_approval` | Human gate (T3 or over-limit) | "Awaiting approval" |
| `submitted` | Executed; target system not yet confirmed | "Submitted, awaiting confirmation" |
| `verified` | Read-back confirmed in the target system; receipt written | "Done" |
| `verification_failed` | Read-back contradicts the action | Escalated, never "done" |
| `compensated` | Rolled back via a compensating action | "Reversed" + reason |
| `failed` | Execution error after retries | Escalated |

## 2. Layer map (blueprint §13 → code)

| # | Layer | Stance | Code home (target) | Exists today? |
|---|---|---|---|---|
| 1 | Interfaces & channels | INTEGRATE | `src/channels/*`, `src/api/*`, new `src/interop/mcp` | Inbound real, outbound fake |
| 2 | Identity & Authority → **Kriya Mandate** | **OWN** | `src/security/auth`, new `src/mandate/*` | Auth yes, Mandate no |
| 3 | Intelligence → Omnitask Router | BUILD THIN | `src/model/gateway/*` (consolidated) | Mock only |
| 4 | Agent runtime | BUILD | `src/runtime/graph/*` (evolved from `src/workflows/engine`) | Single-shot |
| 5 | Policy & workflow | **OWN** | `src/policy/*`, `src/orchestration/firewall`, risk tiers | Partial |
| 6 | Integration fabric → **Kriya Reach** | BUILD + INTEGRATE | `src/tools/*`, new `src/reach/*` | Fabricated IDs |
| 7 | Proof & governance → **Kriya Proof** | **OWN** | new `src/proof/*` built on `cryptoAuditLedger` | Ledger yes, receipts no |
| 8 | Observability & outcomes | BUILD OUTCOMES | `src/observability`, `src/cost`, new `src/outcomes` | Traces partial |
| 9 | Operational intelligence → Kriya Lens + Twin | OWN (later) | `src/digitaltwin`, `src/knowledge` | Partial |
| 10 | Autonomous optimisation | LATER (Phase 3+) | — | No; don't build yet |

## 3. Graph engineering: one durable graph runtime

**Decision (ADR-004, to write in WP-2.1):** evolve `dagExecutor` into a single graph runtime used
by *both* workflows and agents. Two engines would be duplicate infrastructure (CLAUDE.md §43).
Build thin in TypeScript on our own DB (blueprint §28: "Durable workflow execution: BUILD, then
evaluate"). Re-evaluate Temporal / Restate / Inngest only if checkpoint load or ops pain proves it.

### 3.1 Graph model

- **State:** one Zod schema per graph. Every node reads typed state and returns a typed *patch*.
  Reducers merge patches deterministically. No free-text hand-offs for consequential steps.
- **Node kinds** (closed set):

| Kind | Does | Side effects? |
|---|---|---|
| `rule` | Deterministic function (classifier, validator, state machine step). Cost ≈ 0 | No |
| `llm` | One model call through the Model Gateway with a schema-bound output | No (proposes only) |
| `policy` | Policy engine + risk tier evaluation → allow / block / require_approval | No |
| `mandate` | Delegated-authority check (scope, amount, expiry, revocation) | No |
| `tool` | Executes a registered tool via the Tool Gateway with an idempotency key | **Yes** |
| `verify` | Calls the tool's `verify()` read-back; sets `verified` / `verification_failed` | Read-only |
| `proof` | Writes the signed, hash-chained receipt | Append-only |
| `human_gate` | Interrupt: persists the run, creates an Attention item, resumes on decision | No |
| `router` | Pure condition over state → next edge | No |
| `subgraph` | Invokes another graph (agent-to-agent delegation, depth-limited) | Inherits |
| `end` | Terminal with a final outcome state from §1 | No |

- **Edges:** deterministic predicates over state only. A model never chooses an edge directly;
  it writes a field (e.g. `intent`) which a `router` node validates against an enum.
- **Static validation at publish time:** every path from `tool` reaches `verify` then `proof`
  before any `end` that reports success; every cycle has a loop bound; every `tool` node is
  preceded on all paths by `policy` (and by `mandate` if tier ≥ T2). Graphs failing this can't deploy.

### 3.2 Durability

- Checkpoint after every node: `graph_runs`, `graph_checkpoints` (run_id, step, node, state_hash,
  state_json, created_at). Resume from the last checkpoint after a crash or deploy.
- Side-effecting nodes use idempotency key `run_id:node_id:attempt_scope` so a resumed run
  can't double-charge or double-send.
- Long waits (`human_gate`, verification polling, scheduled follow-ups) don't hold memory.
  The run is parked and re-queued by the durable job queue (WP-5.9).

### 3.3 Knowledge graph (the other "graph")

The Business Digital Twin (`src/digitaltwin/graph`) becomes the typed relationship store:
customer ↔ case ↔ appointment ↔ payment ↔ document ↔ counterparty. Agents query it through tools
for relationship questions (who shares a billing contact, which claims belong to this employer).
Vector search stays for unstructured text. Domain ontologies (health, claims) are pack
configuration on top. Phase 1+; the schema hooks go in now.

## 4. Loop engineering: three nested loops, all bounded

| Loop | Scope | Cycle | Hard bounds | Exit |
|---|---|---|---|---|
| **Inner** (agent step loop) | One agent turn | plan → act (tool) → observe → check | `maxIterations` (default 6), `maxTokens`, `maxCostUsd`, wall clock | goal state reached, budget hit, or **no-progress** detected (same tool + same args twice, or state hash unchanged) → escalate |
| **Middle** (action reliability loop) | One consequential action | execute → verify → retry with backoff / compensate | `maxAttempts` per tool (registry), verification deadline | `verified`, `compensated`, or escalate. Never silently completed |
| **Outer** (improvement loop) | Fleet over weeks | outcomes → evals → proposed change → human approval → canary → production | Human approval always; error budget | Governed adaptation only (CLAUDE.md §37). Never self-modifying on live traffic |

Rules:
- Termination is decided by code, not by the model saying "I'm done".
- Reflection or self-critique runs only when a deterministic check failed (schema invalid,
  verification mismatch), never as a default extra call. That's a cost rule as well as a quality rule.
- Error-budget throttling: when an agent's verified-action rate drops below its tier target, its
  autonomy steps down automatically (e.g. T2 → T1 requires approval) until reviewed.

## 5. Cost architecture: cheap by construction

Target metric: **cost per verified outcome**, not tokens (blueprint KPI framework; CLAUDE.md §24).

### 5.1 The cascade (every decision tries the cheapest level first)

| Level | Mechanism | Typical use | Escalate to next level when |
|---|---|---|---|
| L0 | Deterministic rules, regex, state machines, Skill Library (`src/skills`) | Menu replies, slot math, policy, routing of known intents, validation | No rule matches |
| L1 | Exact / normalised cache (per tenant, TTL, invalidated on knowledge change) | Repeated FAQs, repeated classifications | Cache miss |
| L2 | Small fast model with strict JSON schema output | Intent + entity extraction, classification, short replies | Schema invalid after 1 repair, or confidence below the tier threshold |
| L3 | Frontier model | Multi-step planning, ambiguous or complex documents, exceptions | Still uncertain → human, never a bigger guess |

### 5.2 Other cost levers (all required, none optional)

- **Prompt caching:** the context assembler orders content stable → volatile (charter, policies,
  tool schemas first; conversation last) so provider prompt caches hit.
- **Context minimisation:** scoped retrieval, top-k caps, compaction (`src/context`). The model
  never gets the whole history.
- **Structured outputs / forced tool calls** instead of free text, so there are no parse-retry loops.
- **Batch APIs** for non-urgent work (nightly summaries, evals, re-indexing).
- **Pre-call budget check** per run, per agent and per tenant (`src/cost/budget`); thresholds at
  70/85/95/100% (CLAUDE.md §24).
- **Owner-chosen model is respected:** the business owner selects a certified model per
  capability tier (`src/model/certification`). The cascade operates *within* the owner's
  allowed set; it never silently upgrades to a model the owner didn't approve or isn't paying for.
- **No published cost numbers until measured.** Cost per verified action is instrumented in
  WP-6.1, then published.

## 6. Kriya Mandate: delegated authority

```
mandate {
  id, tenant_id, principal_id (human or org who delegates), agent_id,
  action_types[], resource_scope (e.g. branch, department),
  limits { per_action_amount, daily_amount, currency, max_count_per_day },
  valid_from, valid_until, revoked_at, created_by, version
}
```
- Checked in a `mandate` node before every T2/T3 tool call, and again inside the Tool Gateway
  (defence in depth).
- Over-limit → `awaiting_approval`, never truncated or split to dodge the limit.
- Every check result (allow/deny + mandate version) is embedded in the Proof receipt.
- Later: map to IdP agent identities (e.g. Entra Agent ID) and UPI agent-payment rails. Integrate rails, own the policy.

## 7. Kriya Proof: receipts

```
receipt {
  receipt_id, tenant_id, run_id, action_type, risk_tier,
  actor { agent_id, agent_version, model_id?, human_approver_id? },
  mandate { id, version, decision },
  policy  { rule_ids[], decision },
  input_hash, output_hash,            // hashes, not raw PII (zero-retention friendly)
  target  { system, external_ref },   // e.g. razorpay refund id
  verification { method, observed_state, verified_at },
  prev_hash, hash,                    // per-tenant chain
  signature (Ed25519, key id), issued_at
}
```
- Canonical JSON (sorted keys) → SHA-256 → Ed25519 signature via `node:crypto`. No new dependency.
- Written **before** the user is told "done". If writing the receipt fails, the action is not reported as done.
- Endpoints: `GET /proof/receipts/:id`, `GET /proof/verify/:id` (anyone holding the receipt and
  the public key can verify it offline), and a tenant export bundle for auditors.
- Publish the receipt format as an open spec draft (`docs/kriya/specs/proof-receipt-v0.md`), per blueprint §12 step 3.

## 8. Kriya Reach: tools and execution

Every tool registry entry must declare (CLAUDE.md §39): input/output Zod schema, risk tier
(T0-T3), idempotency strategy, timeout, retry policy, **`verify()` read-back**, optional
**`compensate()`**, allowed agents/tenants, and credential scope from the vault.

| Connector | Priority | Notes |
|---|---|---|
| WhatsApp Cloud API (send + status webhooks) | P0 | Purpose-bound flows only (general chatbots banned on WhatsApp Business API from 15 Jan 2026). Delivered/read status = verification. |
| Payments: Razorpay (India-first), Stripe | P0 | Webhook signature verification; refund read-back. |
| Calendar (Google first) / booking REST | P0 | Slot holds; read-back of the event. |
| Browser / computer-use (Playwright in an isolated worker) | P1 | Integrate models, build the *verification wrapper*: URL/action allowlist, screenshot evidence into Proof, read-back. Blueprint downgrades clicking as a moat. |
| Email (SMTP/provider API) | P1 | |
| Voice (Indic partner adapter, STT/TTS) | P2 | Partner, don't build. STT confidence gating; per-language evaluation (CLAUDE.md §19). |
| MCP server (Kriya actions as MCP tools) | P1 | Gated by Mandate, recorded in Proof. A2A gateway is Phase 2. |

## 9. Agents: charters, not prompts (blueprint §14-15)

```
charter { slug, version, owns (outcome), tools[], data_scope, decides_within (policy refs),
          escalates_when[], remembers (twin fields, not prompts), proves (receipt types),
          autonomy_tier_cap, budgets, eval_suite_id, owner }
```
Phase 0 agents (exactly five, plus the system verifier):

| Agent | Owns | Auto-executes up to | Needs a human for |
|---|---|---|---|
| Intake / Concierge | first contact, intent capture | T0-T1 | none (hands off) |
| Scheduling | slots and resources (**only writer** of slots) | T1 | overbooking exceptions |
| Payments & Mandate | collections, holds, refunds (**only writer** of the ledger) | T2 within Mandate | above limit, disputes |
| Document (Lens) | extract and validate documents, zero-retention | T1 | low-confidence parses |
| Attention / Escalation | routing to the right human | T0 | always hands to a human |
| Verification (system) | read-back checks of other agents' actions | T0 | mismatches |

Conflict precedence: safety → compliance → the customer's explicit instruction → cost/efficiency. Ties go to a human.
Single writer per resource. The twin holds state; prompts never carry memory.

## 10. Technology choices: use where it fits

| Technique | Use it for | Don't use it for |
|---|---|---|
| State-graph runtime with checkpoints | Every agent and workflow | — |
| Model cascade (L0→L3) | Every decision | Skipping L0 because "the model can do it" |
| Structured outputs / tool calling | All model → system boundaries | Free-form agent-to-agent prose |
| Prompt caching | Stable charter/policy/tool prefixes | Volatile per-message content |
| Evals-as-CI (golden sets, regression gates) | Every agent version, every model swap | Replacing production verification |
| OpenTelemetry-shaped spans (GenAI conventions) | Traces per node / model / tool call | Storing raw PII in spans |
| MCP | Exposing Kriya actions to other agents; consuming vetted tools | Arbitrary third-party tool access |
| Computer-use / browser agents | Portals with no API, inside the verification wrapper | Anything with an API |
| Vector search (pgvector + real embeddings) | Unstructured knowledge | Authoritative facts (prices, slots, balances come from systems of record) |
| Knowledge graph (twin) | Relationship questions | Free-text search |
| Ensemble / cross-model check | T2-T3 decisions only | T0 (waste) |

## 11. ADRs to write (one per decision, in `docs/architecture/decisions/`)

- ADR-004 Single graph runtime (evolve DAG executor) vs. adopting an external engine
- ADR-005 Model Gateway consolidation (three routers → one)
- ADR-006 Postgres as the production store; SQLite for tests only
- ADR-007 Proof receipt format v0 and the signing key lifecycle
- ADR-008 Mandate model and enforcement points
- ADR-009 Kriya design system adoption (supersedes `claude1.md` Part B tokens)
