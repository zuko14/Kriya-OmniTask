# 03 — Implementation Plan (Work Packages)

Every unit of work is a **Work Package (WP)**. Status lives in `00_STATUS.md`, not here.
"Sessions" = rough estimate of focused agent sessions; treat it as sizing, not a promise.

Each WP lists: **Goal · Depends on · Tasks · Files · Acceptance (must all be true) · Tests**.

Milestone order: **M0 → M1 → M2 → M3 → M4**, then **M5 / M7** in parallel, then **M6 → M8**.
M0 + M1 + M2 + M3 is the critical path. Nothing customer-facing is "production" before M3 is done.

---

## M0 — Truth & Foundation (make the system honest before making it smart)

### WP-0.1 Kriya rebrand (config + user-visible)  · 1 session
- **Goal:** Everything the user sees says Kriya AI / Kriya Omnitask. Branding stays a config layer (CLAUDE.md §2).
- **Depends on:** —
- **Tasks:**
  1. `src/core/config/branding.ts`: productName `Kriya Omnitask`, companyName `Kriya AI`, tagline `Verified action. AI that acts, and proves it acted right.`, copyright `Kriya AI`. Legal entity name stays configurable (blueprint Decision #1 is pending).
  2. Web: `web/index.html` title + favicon (Kriya mark SVG from design system §1.1), sidebar/topbar wordmark, login screen.
  3. Replace "Xylarc" in user-visible strings (UI copy, API error messages, email/WhatsApp templates, OpenAPI title).
  4. Mechanical rename of file header comments (`Xylarc AI —` → `Kriya Omnitask —`). Package name `xylarc-ai` → `kriya-omnitask`.
  5. Rewrite `CLAUDE.md` §1-§3 identity to Kriya (Kriya AI master brand, Omnitask = runtime, Kriya Health = first solution pack); keep every engineering rule. Note `claude1.md` design Part B is superseded by `KRIYA_AI_DESIGN_SYSTEM.md`.
  6. Do **not** rename DB tables/columns (none contain "xylarc" — verify with grep on migrations).
- **Acceptance:** `grep -ri xylarc src web/src web/index.html package.json` returns 0 hits except an explicit allowlist (e.g. a legal-entity config value if kept); typecheck + all tests pass.
- **Tests:** snapshot/text tests updated; one test asserting `getBrandingConfig().productName === 'Kriya Omnitask'`.

### WP-0.2 Kill fabricated success (P0 honesty fixes)  · 1 session
- **Goal:** No code path reports success it didn't observe. Fixes S2, S3, S4, S6, S7 from `01`.
- **Depends on:** WP-0.3 (needs `APP_MODE`)
- **Tasks:**
  1. `hierarchicalOrchestrator.ts:245-258`: unparseable output → `status: 'failed'`, `confidence: 0`, `policyFlags: ['UNPARSEABLE_MODEL_OUTPUT']`, `requiresApproval: true`.
  2. `outboundQueueService.ts:118-160`: without a real connector call, the message stays `queued`. `sent` is only set from a provider response containing a real message ID. Remove the invented `wamid`. The audit action becomes `channel.message_queued` until the provider confirms.
  3. `toolRegistry.ts:165,197`: built-in demo tools are registered only in `sandbox`/`test`, and their outputs carry `sandbox: true`.
  4. `stripePaymentAdapter.ts`: refuses to run outside sandbox until WP-5.3 replaces it.
  5. `DeterministicLLMAdapter` and the fake provider adapters move to `tests/fixtures/` or a `sandbox/` module that `APP_MODE=production` cannot import.
- **Acceptance:** grep for `_secret_mock`, `wamid.${`, `Math.random() * 1000` in `src/` → 0 in production paths; new tests prove each fixed path returns a non-success state.
- **Tests:** one regression test per fix (5 tests).

### WP-0.3 Runtime mode gate  · 0.5 session
- **Goal:** Sandbox can never leak into production (CLAUDE.md §32).
- **Tasks:** add `APP_MODE: production | staging | sandbox | test` to `src/core/config/config.ts`. Production boot **fails fast** if: no real model provider configured, `DB_DRIVER` isn't `postgres`, JWT/encryption secrets are defaults, or any sandbox adapter is registered. `src/storage/db.ts:131` throws on an unknown driver instead of silently using in-memory SQLite (fixes S5).
- **Acceptance:** `APP_MODE=production` with a sandbox adapter → process exits with a clear error. Test covers each failure reason.

### WP-0.4 CI, container, repo hygiene  · 1 session
- **Tasks:** `.github/workflows/ci.yml` (install, typecheck backend + web, vitest backend + web, web build); multi-stage `Dockerfile` (non-root user, `npm ci --omit=dev`); complete `.env.example` with every config key, grouped and commented; commit the current working tree in logical commits on a branch (the user decides when to push).
- **Acceptance:** CI config runs green locally via the same commands; `docker build` succeeds.

### WP-0.5 Doc hygiene  · 0.5 session
- **Tasks:** move superseded Xylarc docs to `docs/archive/xylarc/` with a header line "Superseded by docs/kriya/ on 2026-10-01"; keep `FINAL_PRODUCTION_READINESS_REPORT.md` linked from `01`.

---

## M1 — Real Brain: Model Gateway

### WP-1.1 Consolidate to one Model Gateway  · 1 session
- **Goal:** One entry point for every model call. Fixes S14 (routers).
- **Depends on:** WP-0.2
- **Tasks:** create `src/model/gateway/modelGateway.ts` exposing `complete({ tier, schema, messages, budgetCtx, tenantPolicy })`. Fold in: certification + owner choice (`src/model/certification/certifiedModelRouter.ts`), fallback chain (`src/model/resilience/fallback/modelFallbackManager.ts`), cost attribution. Migrate callers (`hierarchicalOrchestrator`, `modelCertificationRoutes`), then delete `src/orchestration/routing/modelRouter.ts` and `src/model/resilience/router/dynamicModelRouter.ts` once there are no callers. Write ADR-005.
- **Acceptance:** `grep -r "new ModelRouter\|DynamicModelRouter" src` → 0; all tests pass.

### WP-1.2 Real provider adapters  · 1-2 sessions
- **Goal:** Real inference with native `fetch` (no SDK dependency).
- **Tasks:**
  - `AnthropicAdapter`: Messages API; tool-use for structured output; `cache_control` on stable prefix blocks; real `usage` tokens incl. cache read/write.
  - `OpenAICompatibleAdapter`: Chat Completions with `response_format: json_schema` where supported; `baseUrl` configurable, so one adapter covers OpenAI, OpenRouter, Groq, Gemini (OpenAI-compatible endpoint), DeepSeek, and local Ollama/vLLM.
  - Common: `AbortController` timeout, retry with jittered exponential backoff on 429/5xx/network errors (honour `retry-after`), no retry on 4xx validation errors, typed `ProviderError` (rate_limit | auth | timeout | server | invalid_request), cost from a versioned price table (`src/model/gateway/pricing.ts`) keyed by model id. Unknown model → cost `null` + warning; never a guessed number.
  - API keys only from the credential vault / BYO brain credential (`brainCredentialService`), never from code or logs. Redact keys in errors.
- **Acceptance:** recorded-fixture tests for success, 429-then-success, timeout, malformed JSON, auth failure on both adapters; a live smoke test runs only when `KRIYA_LIVE_TEST_<PROVIDER>_KEY` is set.

### WP-1.3 Structured output contract  · 0.5 session
- **Tasks:** `complete()` takes a Zod schema → converts to JSON Schema → validates the response → on failure, **one** repair attempt with the validation error → then throws `StructuredOutputError`. Never default-fills confidence or status.
- **Acceptance:** tests for valid, repaired, and unrepairable outputs.

### WP-1.4 Spend protection & BYO keys  · 0.5 session
- **Tasks:** pre-call budget reservation and post-call settlement against `src/cost/budget`; per-tenant/agent/run caps; the 70/85/95/100% thresholds; BYO vs managed key per tenant (blueprint §18).
- **Acceptance:** a call that would exceed the cap is refused before the HTTP request is made (test with a spy fetch).

---

## M2 — Graph Runtime & Loop Engineering

### WP-2.1 Graph definition model + validator  · 1-2 sessions
- **Depends on:** WP-1.3
- **Tasks:** `src/runtime/graph/types.ts` (node kinds from `02` §3.1, typed state, edges, reducers); `validator.ts` enforcing the static rules (tool → verify → proof before success-end; loop bounds; policy before tool; mandate before T2+). Port `dagExecutor` node types into this model; existing workflow definitions must still load (adapter). Write ADR-004.
- **Acceptance:** validator rejects each forbidden graph shape (one test per rule); existing workflow tests pass unchanged.

### WP-2.2 Durable executor with checkpoints  · 2 sessions
- **Depends on:** WP-2.1
- **Tasks:** migration `037_graph_runtime_schema.sql` (`graph_runs`, `graph_checkpoints`, with `tenant_id` and indexes); executor persists after each node; `resume(runId)`; idempotency key per side-effect node; parked states for `human_gate` and verification waits.
- **Acceptance:** a test kills execution mid-graph (throws in a node), resumes, and proves no tool ran twice and the final state equals an uninterrupted run.

### WP-2.3 Bounded agent loop  · 1 session
- **Depends on:** WP-2.2
- **Tasks:** reusable `agentLoop` subgraph (plan → act → observe → check) with `maxIterations`, `maxTokens`, `maxCostUsd`, wall clock; no-progress detection (repeated tool+args, unchanged state hash); reflection only after a failed deterministic check.
- **Acceptance:** tests for each termination reason; each ends in `escalated`/`failed`, never `verified`.

### WP-2.4 Cost cascade  · 1 session
- **Depends on:** WP-1.1, WP-2.1
- **Tasks:** `cascade` node: L0 rule/skill lookup → L1 tenant cache → L2 small model → L3 frontier, all within the owner's certified model set; per-level metrics; cache invalidation on knowledge version change.
- **Acceptance:** tests show L0 hits make zero model calls, an L2 schema failure escalates to L3, and L3 uncertainty escalates to a human.

### WP-2.5 Human gate (interrupt/resume)  · 0.5 session
- **Tasks:** `human_gate` creates an Attention item (`src/attention`) with structured context; approve/reject endpoints resume the run; timeout policy escalates.
- **Acceptance:** an end-to-end test parks a run, approves it via the API, and the run completes.

### WP-2.6 Traces  · 1 session
- **Tasks:** span per node / model call / tool call (OpenTelemetry-shaped attributes: run, node, model, tokens, cost, latency, outcome) into `src/observability`; PII redaction; Decision Trace API serving the run timeline.
- **Acceptance:** a test run produces a complete ordered trace; no raw phone numbers or emails in spans.

### WP-2.7 Replace the orchestrator  · 1 session
- **Depends on:** WP-2.3, WP-2.4
- **Tasks:** the orchestrator becomes a top-level graph: firewall → intent via cascade (not keywords) → route to agent subgraph → aggregate. Delete `classifyTargetAgentSlug`. Keep `/orchestration` API contract (versioned; CLAUDE.md §32).
- **Acceptance:** existing orchestration API tests pass; keyword classifier is gone.

---

## M3 — Verified Action Core (Mandate · Proof · Verify)

### WP-3.1 Kriya Mandate  · 1-2 sessions
- **Tasks:** migration `038_mandate_schema.sql`; `src/mandate/{types,repository,service}.ts`; CRUD API (owner/admin only, audited); `mandate` graph node; second check inside the Tool Gateway; daily-usage counters done atomically (transaction / row lock).
- **Acceptance:** tests for allow, over per-action limit, over daily limit, expired, revoked, wrong scope, and a concurrent double-spend attempt.

### WP-3.2 Risk tiers T0-T3  · 0.5 session
- **Tasks:** map `LOW/MEDIUM/HIGH/CRITICAL` → `T0/T1/T2/T3` (blueprint §14) in one place; tier lives on the tool registry entry; T3 always requires a human regardless of model confidence.
- **Acceptance:** policy tests per tier.

### WP-3.3 Kriya Proof v0  · 2 sessions
- **Tasks:** migration `039_proof_receipts_schema.sql`; `src/proof/*`: canonical JSON, per-tenant hash chain (reuse `cryptoAuditLedger` primitives), Ed25519 signing via `node:crypto` with key id + rotation; `proof` graph node; endpoints (get, verify, export); spec draft `docs/kriya/specs/proof-receipt-v0.md`; write ADR-007.
- **Acceptance:** tamper tests (alter a field / delete a receipt / reorder → verification fails); offline verification with only the public key; receipt is written before the notify step (ordering test).

### WP-3.4 Verification read-back  · 1-2 sessions
- **Tasks:** `verify()` on the tool contract; `verify` node; `submitted` → `verified | verification_failed`; a durable re-check job for async confirmations (payment webhooks, WhatsApp statuses) with a deadline → escalate.
- **Acceptance:** tests for immediate verify, delayed verify via webhook, mismatch → escalation, and deadline expiry → escalation.

### WP-3.5 Compensation (saga)  · 1 session
- **Tasks:** `compensate()` on tools; executor runs compensations in reverse order on a downstream failure where defined; outcome `compensated` with a receipt.
- **Acceptance:** a multi-tool graph failing at step 3 compensates steps 2 and 1 (test).

### WP-3.6 Tool contract upgrade  · 1 session
- **Tasks:** extend `src/tools/types/toolTypes.ts` + registry validation: schema in/out, tier, idempotency, timeout, retry, verify, compensate, allowed agents/tenants, credential scope. Registry refuses incomplete tools in production.
- **Acceptance:** registering a T2 tool without `verify()` fails in production mode (test).

---

## M4 — The Phase-0 Workforce (five agents as charters)

### WP-4.1 Charter schema + registry migration  · 1 session
- **Tasks:** charter type (from `02` §9) stored with agent versions (`src/agents`); lifecycle states unchanged; charters reference graphs and eval suites.

### WP-4.2 Intake / Concierge agent  · 1-2 sessions
- Purpose-bound WhatsApp intake: language detect (`src/multilingual`), intent + entities via the cascade, consent check, hand-off to Scheduling/Payments/Document/Attention. Absorbs `leadQualificationSpecialist` (scoring becomes a configurable policy, not hardcoded keywords) and the FAQ part of `customerSupportSpecialist` (knowledge retrieval with citations; "I can't verify" when retrieval is empty).

### WP-4.3 Scheduling agent  · 1-2 sessions
- Only writer of slots. Availability from the system of record (calendar/HMS connector), slot hold → confirm → read-back → receipt. Absorbs `calendarBookingSpecialist`.

### WP-4.4 Payments & Mandate agent  · 1-2 sessions
- Payment links, holds, refunds within Mandate; over-limit → human gate; webhook verification; receipts. Depends on WP-5.3.

### WP-4.5 Document (Lens) agent  · 1-2 sessions
- Deterministic parsers for known templates first (L0), model extraction for unknown ones (L2/L3); zero-retention (process in memory, store structured output + hashes only); low confidence → human.

### WP-4.6 Attention / Escalation agent + Verification agent  · 1 session
- Routing rules to the right human (role, branch, hours); the Verification agent runs the read-back jobs.

### WP-4.7 Reference workflow: "doctor emergency leave"  · 1 session
- Blueprint §14 worked example built end to end on the five agents: detect → find affected → cancel/release (T1) → refund under limit (T2) → over-limit approval (T3) → offer rebooking → verify settlement. Runs in sandbox with recorded connectors. **This is the M4 acceptance demo.**
- Each agent WP's acceptance: golden eval set (≥ 30 cases incl. adversarial/prompt injection, Hindi/Telugu/code-mixed for Intake), all graph-validator rules pass, cost per run recorded.

Retired by M4: `src/workforce/specialists/*` once their logic is absorbed (see `05`).

---

## M5 — Execution Layer (Reach) & Data  (can run in parallel with M4 after M3)

| WP | Scope | Sessions | Key acceptance |
|---|---|---|---|
| WP-5.1 | **Postgres adapter** (`pg` dependency, justified: required driver). Migration runner supports both; SQLite = tests only. Pool, statement timeouts, transactions. | 2 | Full test suite runs against Postgres in CI (service container) |
| WP-5.2 | **WhatsApp Cloud API send** + status webhooks → verification; templates, 24h session window, opt-out handling; purpose-bound flows | 1-2 | Sandbox number end-to-end; status `delivered` drives `verified` |
| WP-5.3 | **Payments:** Razorpay (links, refunds, webhook HMAC) + real Stripe | 2 | Test-mode keys end-to-end; refund read-back |
| WP-5.4 | **Connector framework** + Google Calendar connector (OAuth via vault) | 1-2 | Hold/confirm/read-back on a test calendar |
| WP-5.5 | **Kriya Reach browser tool:** Playwright in an isolated worker process, domain + action allowlist, per-run session isolation, screenshot evidence → Proof, kill switch | 2 | Allowlist violation blocked (test); evidence stored |
| WP-5.6 | **Voice** via a partner adapter (Indic STT/TTS + telephony), STT confidence gating, per-language benchmark before "supported" | 2-3 | Only after M4; per-language eval report |
| WP-5.7 | **MCP server** exposing Kriya actions, gated by Mandate, recorded in Proof | 1-2 | An external MCP client call produces a receipt |
| WP-5.8 | **Real embeddings** (provider API) + pgvector; hash projection kept for tests only | 1 | Retrieval eval beats the BM25 baseline on a fixed set |
| WP-5.9 | **Durable job queue** on Postgres (`FOR UPDATE SKIP LOCKED`), retries, DLQ, schedules (business hours, timezones, quiet hours) | 1-2 | Crash-during-job test; no double execution |

---

## M6 — Outcomes & Learning

| WP | Scope | Sessions |
|---|---|---|
| WP-6.1 | Outcome instrumentation: verified-action rate, resolution rate, tool-call reliability, recovery rate, escalation rate, cost per verified outcome, per tenant/agent/workflow (blueprint KPI framework). Each metric defines source, calculation, window, drill-down (CLAUDE.md §39). | 1-2 |
| WP-6.2 | Evals-as-CI: golden sets per agent run in CI; a model swap or charter change can't deploy on regression; re-certification uses the same suites (`src/model/certification`). | 1-2 |
| WP-6.3 | Error-budget autonomy throttling wired from outcomes → autonomy level (CLAUDE.md §37). | 1 |
| WP-6.4 | Governed adaptation: proposals from outcome data, human approval, canary (`src/adaptation`, `src/deployment`). | 1-2 |

---

## M7 — Kriya UI/UX (see `04_UI_UX_KRIYA_DESIGN.md` for detail)

| WP | Scope | Sessions |
|---|---|---|
| WP-7.1 | Kriya tokens + IBM Plex Sans + glass recipe + aura + light/dark themes, with old token names aliased | 1 |
| WP-7.2 | Brand assets: logo SVG component, favicon, inline icon sprite (no emoji), login screen | 0.5 |
| WP-7.3 | Primitive components restyled (Button, Card, Stat, Table, Badge, Modal, Toast, Nav, Inputs) | 1-2 |
| WP-7.4 | Page-by-page migration of all `web/src/pages/app/*` and `web/src/pages/platform/*`; remove the aliases | 2-3 |
| WP-7.5 | New screens: Run Trace (graph view), Proof Receipts + verify, Mandates, Verification Pending queue, Cost per Outcome | 2-3 |
| WP-7.6 | Accessibility pass (contrast table from DS §11, focus, reduced motion), responsive breakpoints, retire the legacy `src/admin/ui` | 1 |

---

## M8 — Production Hardening & Launch Gate

| WP | Scope | Sessions |
|---|---|---|
| WP-8.1 | Security: threat model for agent/tool paths, SSRF guards on all fetchers, rate limits, secret rotation, dependency audit, VAPT checklist | 1-2 |
| WP-8.2 | DPDP operations (obligations from May 2027): consent ledger, rights requests (access/erasure) with erasure receipts in Proof, retention jobs, breach-notification runbook | 2 |
| WP-8.3 | Observability: OTel export, SLOs (availability, p95 latency, verified-action rate per tier), alerts, dashboards | 1 |
| WP-8.4 | Reliability drills: load test, chaos **in staging only** (move `src/hardening/chaos` behind `APP_MODE!=production`), backup/restore drill, runbooks | 1-2 |
| WP-8.5 | Release: versioned API, canary deploys, one-step rollback, India-region hosting config | 1 |
| WP-8.6 | **Launch gate review**: every item below checked with evidence | 0.5 |

### Launch gate (all required before the first real tenant)
- [ ] No simulated adapter reachable in `APP_MODE=production` (boot check + test)
- [ ] Postgres in production; backup restored successfully in a drill
- [ ] Every consequential action path: policy → mandate → tool → verify → proof (validator enforced)
- [ ] Live provider smoke tests pass for at least 2 model providers (fallback proven)
- [ ] WhatsApp + one payment provider verified end to end in test mode
- [ ] Golden eval suites pass for all five agents; measured verified-action rate published per tier
- [ ] Tenant isolation suite passes on Postgres
- [ ] Kill switches (global / tenant / agent / tool) tested
- [ ] CI green; rollback rehearsed
- [ ] No unsupported claims in UI or marketing copy (no "100%", no uncertified "compliant")
