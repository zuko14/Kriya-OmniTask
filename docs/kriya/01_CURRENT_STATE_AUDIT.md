# 01 — Current State Audit (as of 2026-10-01)

Evidence-based. Every claim cites a file. "Real" means it talks to a real system or does real
computation; "Simulated" means it returns invented data. Re-verify before relying on a line
number — code moves.

## 1. Baseline numbers

| Check | Result (2026-10-01) |
|---|---|
| `npx tsc --noEmit` | clean, exit 0 |
| `npx vitest run` (backend) | **170 files, 457 tests, all passing** |
| Test files incl. web | 208 |
| DB migrations | 36 (`src/storage/migrations/001…036`) |
| Backend modules | 37 top-level dirs under `src/`, ≈ 43 API route files |
| Git history | 1 commit (`07bf9ef first commit`); large uncommitted working set |
| CI / Docker | **none** (no `.github/`, no `Dockerfile`); `.env.example` exists |
| Brand | "Xylarc" appears **349 times across 298 files** in `src/` + `web/src/` |

**Read this correctly:** the tests are green, but they test a system that never calls a real
model, never sends a real message and never charges a real payment. Green tests ≠ production.

## 2. What is real and worth keeping

| Area | Evidence | Verdict |
|---|---|---|
| Auth (JWT, RBAC, elevation) | `src/security/auth/jwt.ts`, `src/api/middleware/*` | Real crypto. Keep. |
| Tenant isolation | AsyncLocalStorage `src/core/context/tenantContext.ts`, repo-level `tenant_id` filters, `tests/security/*Isolation.test.ts` | Real. Keep. (P0 cross-tenant admin bug was fixed 2026-08-15 per `docs/verification/FINAL_PRODUCTION_READINESS_REPORT.md`.) |
| Schema | 36 migrations covering every domain | Real, comprehensive. Keep; Postgres port needed. |
| Crypto utils | AES-256-GCM, PBKDF2 `src/core/utils/crypto.ts` | Real. Keep. |
| Audit ledger | SHA-256 chain `src/security/hardening/ledger/cryptoAuditLedger.ts` | Real. **Seed of Kriya Proof.** Keep and extend. |
| Webhook verification | Meta HMAC `src/channels/security/webhookVerifier.ts` | Real. Keep. |
| Frequency governor | `src/channels/governor/frequencyGovernor.ts` | Real logic. Keep. |
| Safety firewall | `src/orchestration/firewall/agentSafetyFirewall.ts` (pattern scan) | Real but regex-only. Keep as first layer. |
| Workflow DAG executor | `src/workflows/engine/dagExecutor.ts` (485 lines) | Real engine, acyclic only, no durable checkpoints. **Evolve into the graph runtime.** |
| Credential vault | `src/tools/vault/credentialVault.ts` | Real encryption. Keep. |
| Context / token architecture | `src/context/*` (assembly, budget, compaction) | Real logic. Keep; feed real models. |
| Isolated fetcher | `src/retrieval/external/fetcher/isolatedFetcher.ts` | Injectable fetch; check SSRF guards when wiring live. |
| Web consoles | React, `web/src/pages/app/*`, `web/src/pages/platform/*` | Real UI, wired to API. Needs Kriya redesign (see `04`). |

## 3. What is simulated: the production blockers

Ordered by severity. **P0 = fabricates success or loses data. Must be fixed before any real tenant.**

| # | Sev | Finding | Evidence |
|---|---|---|---|
| S1 | **P0** | **No real LLM is ever called.** All provider adapters return template strings. | `src/model/resilience/adapters/modelProviderAdapter.ts:31-159` |
| S2 | **P0** | Default LLM adapter returns `status: completed, confidence: 0.95` for *any* prompt. | `src/orchestration/routing/modelRouter.ts:72-85` (`DeterministicLLMAdapter`), default at `:104` |
| S3 | **P0** | Orchestrator **fabricates success** on unparseable model output: `status: completed, confidence: 0.90`. | `src/orchestration/orchestrator/hierarchicalOrchestrator.ts:245-258` |
| S4 | **P0** | **Outbound messages are never sent**, yet are marked `sent` with an invented `wamid.*` ID, written to the timeline, and audited as `channel.message_sent`. | `src/channels/queue/outboundQueueService.ts:118-160` |
| S5 | **P0** | `DB_DRIVER=postgres` **silently falls back to in-memory SQLite**: all data lost on restart. | `src/storage/db.ts:131-133` |
| S6 | **P0** | Stripe adapter fabricates payment intent IDs and `_secret_mock` client secrets. | `src/billing/stripe/stripePaymentAdapter.ts` (~line 34-38) |
| S7 | **P0** | Built-in tools fabricate external IDs (`book-<ts>-<rand>`, `wa-<ts>-<rand>`). | `src/tools/registry/toolRegistry.ts:165, 197` |
| S8 | P1 | Embeddings are a deterministic hash projection, not semantic. RAG quality is not real. (FIXED S20 / WP-5.8: `OpenAICompatibleEmbeddingAdapter` with OpenRouter/OpenAI/Gemini native fetch, pricing table cost attribution, pgvector dual-mode schema & HNSW index, EmbeddingService batching, and production safety guard refusing deterministic fallback; verified by empirical semantic evaluation beating BM25 in `realEmbeddingsAndPgvector.test.ts`) | `src/knowledge/embeddings/embeddingService.ts` |
| S9 | P1 | Agent routing is keyword `includes()` (`"book"` → booking agent). | `hierarchicalOrchestrator.ts:309-324` |
| S10 | P1 | "Specialists" are fixed if/else scoring with no model, tools, loop or verification (e.g. BANT keyword scoring). | `src/workforce/specialists/*.ts` |
| S11 | P1 | No verification read-back anywhere; the "verifier" is another call to the mock model. | `hierarchicalOrchestrator.ts:153-167` |
| S12 | P1 | No Mandate (delegated authority), no action receipts (Proof), no T0-T3 tiering in code. | grep `mandate|receipt` → no domain code |
| S13 | P1 | No voice (STT/TTS/telephony), no browser automation, no Razorpay, no calendar connector. (PARTIALLY MITIGATED: Calendar connector implemented with Vault OAuth and two-way sync in WP-5.4; payment webhook settlement implemented for Razorpay/Stripe/Kriya Pay in WP-4.4; browser automation implemented with HermeticMockBrowserDriver/PlaywrightBrowserDriver, domain allowlists, anti-SSRF, kill switch, and Ed25519 proof receipts in WP-5.5; voice WP-5.6 remains) | grep `playwright|twilio|razorpay` → none |
| S14 | P1 | Three overlapping model routers; two circuit breakers. | see `05_REMOVALS_AND_CONSOLIDATION.md` |
| S15 | P2 | Chaos engine uses `Math.random` and lives in the production source tree. | `src/hardening/chaos/chaosInjectionEngine.ts:29` |
| S16 | P2 | Legacy string-embedded admin UI still served alongside the React console. (FIXED S-UI-06: `src/admin/ui/*` and `adminUiRoutes.ts` deleted, registration and exports removed; `/admin*` now 404, guarded by `tests/security/adminUiIsolation.test.ts`; maintenance + briefing actions live in the React console; hardening triggers remain API-only, consistent with WP-8.4 staging-only chaos) | `src/admin/ui/*`, `src/api/routes/adminUiRoutes.ts` |
| S17 | P2 | No CI, no container image, no deploy pipeline, one git commit. | repo root |
| S18 | **P0** | Resilience-layer provider adapters (certified router / Brain fallback chain) are template strings | `src/model/resilience/adapters/modelProviderAdapter.ts` |
| S19 | **P0** | Eval benchmark uses the **expected answer as the agent's answer**, so every eval passes by construction | `src/evaluation/benchmark/benchmarkRunner.ts:37-43` |
| S20 | P1 | Certification "stage 6 live-fire" reports hardcoded results without running anything | `src/model/certification/alignmentCheckHarness.ts:166-186`, `src/model/brain/services/alignmentStreamService.ts:332-357` |
| S21 | P1 | Adaptation "simulation" scores proposals without running a golden suite (FIXED Session 27: Production replay evaluator executes candidate proposals against real agent golden suites with zero golden regressions policy, automated failure harvester, deterministic canary router, and Ed25519 proof receipts; verified in `tests/unit/governedAdaptationProduction.test.ts`) | `src/adaptation/services/adaptationSimulationEngine.ts:60` |
| S22 | P1 | Public API accepts `mockFailures` to inject provider failures | `src/api/routes/modelResilienceRoutes.ts:85` |
| S23 | P2 | Alignment cost estimate is a hardcoded $3.2/M tokens and ×85 INR | `src/model/brain/services/alignmentStreamService.ts:39-40` |
| S24 | P1 | Faithfulness grader is lexical; penalises correct paraphrases (FIXED Session 25: claim-level entity extraction for numbers, dates, currency, proper nouns + discourse stopword filtering; verified in `tests/unit/qualityReviewer.test.ts` and `tests/unit/evalsAsCi.test.ts`) | `src/verification/reviewer/qualityReviewer.ts`, `src/observability/drift/driftDetector.ts` |
| S25 | P2 | Legacy admin page shows hardcoded fake hostnames/metrics (FIXED S-UI-06: page retired with S16; its unauthenticated hardcoded `/admin/api/status` "healthy" endpoint is gone too) | `src/admin/ui/dashboardHtml.ts` |
| S26 | P2 | Web console duplicates branding values | `web/src/lib/branding.ts` |
| S27 | P1 | Single-run certification is noisy for stochastic models; needs pass^k over repeated runs (FIXED Session 25: pass^k consistency trials with consistencyThreshold in `probeSuite.ts` + provider vs reasoning error categorization; verified in `tests/unit/probeSuite.test.ts` and `tests/unit/evalsAsCi.test.ts`) | `src/model/certification/probeSuite.ts`, `src/evaluation/ci/service/evalsAsCiService.ts` |
| S28 | **P0** | BYO key "validation" accepted any key not starting with `sk-invalid` (FIXED S04) | `src/model/brain/services/brainCredentialService.ts` |
| S29 | P1 | DAG workflows can run tool steps with no policy check | `src/workflows/engine/dagExecutor.ts` |
| S30 | P2 | Degradation "decompose" returns sub-tasks that nothing executes | `src/model/certification/certifiedModelRouter.ts` |
| S32 | **P0** | Audit-ledger and idempotency hashes ignored nested fields (FIXED S06) | `cryptoAuditLedger.ts`, `idempotencyManager.ts` |
| S31 | P2 | Gateway relies on the async tenant context for vault reads; add an explicit assertion (FIXED S17: `ModelGateway.complete` asserts `TenantContextManager.get()?.tenantId === req.tenantId` throwing `TenantIsolationError` on mismatch, and requires active matching context before decrypting BYO vault secrets; verified in `spendProtectionAndGatewayConsolidation.test.ts`) | `src/model/gateway/modelGateway.ts` |
| S33 | P1 | Hinglish (romanised Hindi) had no certification probes, so no model could hold a `hinglish` cell: every Hinglish message would escalate to a human in production (FIXED S07: probe set added) | `src/model/certification/probeSuite.ts` |
| S34 | P2 | An injected `adapterFor` ignores `candidate.source`, so in test mode the sandbox path can send `sandbox-model` to a real provider (fails loudly; test-harness only) | `src/model/gateway/modelGateway.ts:217` |
| S35 | P1 | One shared SQLite connection: a concurrent caller's writes landed inside another caller's open transaction (lost on its rollback), and concurrent runs failed with "cannot start a transaction within a transaction" (FIXED S07b) | `src/storage/db.ts` |
| S36 | P2 | `ModelPolicySchema` still defaults to `gemini-2.5-pro` / `gemini-2.5-flash`; the Model Gateway ignores it, but the console shows it | `src/agents/types/agentTypes.ts:60` |
| S37 | P1 | Safety: Intake treated "severe chest pain right now" as a routine hand-off (FIXED S07b: L0 emergency triage before consent + `emergency` intent → P0 Attention item + emergency reply) | `src/agents/phase0/intakeAgent.ts` |
| S38 | P1 | FAQ answers could come back in the wrong language/script (live: an English question answered in Chinese) (FIXED S07b: explicit reply language + deterministic script check) | `src/agents/phase0/intakeAgent.ts` |
| S39 | P2 | 22 CSS custom properties (`--foreground`, `--signal-success`, `--signal-warning`, `--color-halt`, …, ~70 references) were used but never defined, so those colours/radii rendered unset (MITIGATED S-UI-01: aliased in `tokens.css`; removed with the aliases in WP-7.4) | `web/src/pages/app/BrainConsole.*`, `TenantSettings.tsx`, `AnalyticsDashboard.module.css`, `pages/platform/PlatformModelRegistry.*`, `PlatformSkills.module.css`, `components/CommandPalette.module.css`, `DecisionTraceDrawer.module.css` |
| S40 | P1 | Executive Overview shows hardcoded numbers and records as if live ("8,421 tasks completed today", fixed `tx-901…` rows with fake `sha256-…` hashes, fixed timestamp `2026-08-20T10:45:00Z`): untraceable metrics (CLAUDE.md §8) and a launch-gate "no unsupported claims" blocker. Its activity feed also takes `tenantId` from `localStorage['tenant_id']` with a `'default-tenant'` fallback instead of the authenticated tenant; the server rejects the mismatch (`realtimeStreamRoutes.ts:44`), so not a leak, but the feed can't load for real tenants (FIXED S-UI-04: screen now renders only `/api/v1/observability/metrics` + `/api/v1/attention/metrics` with source and read time, labelled "all time"; tenant from `auth.tenant.id`; funnel/bookings/trend replaced by an explicit "no data source yet" state; fake evidence modal removed; tests rewritten) | `web/src/pages/app/ExecutiveOverview.tsx:16-30, 84` |
| S41 | P1 | Live test "Intake → Scheduling with a real model" failed twice on 2026-10-02 (~09:05 and ~09:25): the graph returned in ~185 ms, $0 cost, no `delivery` (`res.state.delivery` undefined), so no model call happened. It passed in the full run ~10:00 (660/0/1). Most likely the backend stream had files mid-edit; if it recurs, the run returning in under a second without an error is itself a defect (it should fail loudly, not end with no delivery). Recurred ~10:37 in the full run (688/1/1, same `delivery` undefined): **3 of 4 full runs failed today**, so intermittent, not transient. Status: OPEN. Owner: backend stream | `tests/unit/schedulingAgent.test.ts:305` |
| S42 | P3 | Auth token reads `sessionStorage` unguarded; with site storage blocked the console throws on render instead of showing a "storage blocked, can't sign in" state | `web/src/lib/authContext.tsx:56`, `web/src/lib/apiClient.ts:33` |
| S43 | P2 | DS §11.2 claims white on the brand-gradient midpoint is 4.6:1; measured (WCAG 2.1 formula) white on `#10B981` / `#2FA8D8` / `#3D8BFD` = **2.54 / 2.72 / 3.33**. The primary CTA label (0.88rem/600, not "large text") therefore fails AA 4.5:1 on every gradient CTA, starting with the login "Sign in" button. Options (design decision): navy `#040A11` label on the gradient (~7:1), or a darker gradient for CTAs only. Decide before WP-7.3 restyles Button; enforce in WP-7.6 (DECIDED D15: navy label. FIXED S-UI-03 in `.btn-accent`, the login CTA and AttentionCard Approve; page-level white-on-colour buttons migrate in WP-7.4; the DS §11.2 table itself still states 4.6:1 and should be corrected by the design owner) | `KRIYA_AI_DESIGN_SYSTEM.md` §11.2, `web/src/pages/Login.module.css` `.submit` |
| S44 | **P0** | Decision Trace drawer fabricated verification: on **any** API failure (500/403/404/network) it rendered a synthetic trace ("completed", "Lead record committed and verified in CRM", `crm_lead_id: lead_44812`, `status: verified ✓`); also defaulted unknown outcomes to `succeeded`, missing tokens to `1200` and missing trust tier to `A` (FIXED S-UI-03: honest error per status, no substitution, unknown outcome → escalated, no invented tokens/tier; regression tests in `web/src/components/honesty.test.tsx`) | `web/src/components/DecisionTraceDrawer.tsx:63-122, 198-203` |
| S45 | P1 | Activity Theatre inflated activity: "done today" = real count **+ 42**; every unrecognised event type (`agent.state_changed`, `approval.required`, `security.event`, `stream.ping`) shown as "completed" and counted as done (as was `task.started`); running tasks given a fixed `elapsedSeconds: 3.2`; with no fleet data a hardcoded agent hierarchy rendered as live at 40-90% load and fed "N working" (FIXED S-UI-03: only `task.completed` counts as done, unknown events are informational, approval/security flagged, elapsed shown only when reported, placeholder fleet idle at 0 load, "working" from live agent states only). Remaining: the "today" window is the stream buffer, not a calendar day; the placeholder layout still names reference agents (WP-7.4 should show an empty state instead) | `web/src/components/theatre/ActivityTheatre.tsx`, `NowRunningStrip.tsx` |
| S46 | P3 | Job-queue claim query interpolates queue names into SQL (`CASE queue_name WHEN '${q}' ...`). Not exploitable today: the only caller passes worker config (`jobWorker.ts:127`), no request input; but the guard is a TypeScript type only (no runtime check), so a future caller passing request data would be SQL injection. Fix: runtime allowlist of `high/default/low/batch` before building the CASE (or bind as parameters). Flagged by automated security review during S-UI-03; owner: backend stream (WP-5.9), not edited by the UI stream (FIXED S16: runtime allowlist `Set(['high', 'default', 'low', 'batch'])` validated in `claimNextPendingJob`, throwing `ValidationError` on unapproved queue names; verified in `orchestratorGraphMigration.test.ts`) | `src/infrastructure/repositories/infrastructureRepository.ts:110-112` |
| S47 | **P0** | `brainRoutes.ts`: all 13 endpoints have **no authentication** and take the tenant from the client-supplied `x-tenant-id` header (fallback `'tenant_default'`). Anyone who can reach the API can read any tenant's brain config/spend/coverage and **store, rotate or revoke any tenant's model API keys** (`storeValidatedKey`, `rotateKey`, `revokeBrain`). Found by the UI stream during WP-7.4; owner: backend stream. Fix: `preHandler: [authenticate, requirePermission(...)]` and tenant only from `request.user.tenantId` (FIXED S16: all 13 endpoints protected with `preHandler: [authenticate, requirePermission]`; tenant resolved strictly from `request.user.tenantId` wrapped in `TenantContextManager.withTenant`; client header fallback removed; verified in `orchestratorGraphMigration.test.ts`) | `src/api/routes/brainRoutes.ts:23-30` and every route below it |
| S48 | **P0** | `modelCertificationRoutes.ts` (5) and `skillRoutes.ts` (5) have **no authentication**: anyone can run alignment checks (real model spend), invalidate every certification (`/models/:id/invalidate`, which takes certified models out of the gateway), call `route-task` with any `tenantId` in the body and `forceProviderOutage`, and execute/test skills. No global auth hook exists (`server.ts` onRequest only sets correlation ids). Owner: backend stream. Fix: authenticate + platform-operator permission on all; drop body `tenantId` (FIXED S16: all endpoints secured with `authenticate` and `requirePermission` (`agent:read`, `agent:deploy`, `tool:execute`); request body `tenantId` overrides purged in favor of `request.user.tenantId`; verified in `orchestratorGraphMigration.test.ts`) | `src/api/routes/modelCertificationRoutes.ts`, `src/api/routes/skillRoutes.ts`, `src/api/server.ts:77-81` |
| S49 | P1 | `escalationRoutes.ts` (3 endpoints, incl. `GET /api/v1/escalation/traces/:taskId` used by the Decision Trace drawer) have **no authentication**; tenant comes from `TenantContextManager` with no authenticated context. Owner: backend stream (FIXED S16: all endpoints secured with `authenticate` and `requirePermission` (`agent:write`, `audit:read`); tenant scoped strictly to `request.user.tenantId`; verified in `orchestratorGraphMigration.test.ts`) | `src/api/routes/escalationRoutes.ts:13, 53, 72` |
| S50 | P1 | Client-controlled tenant fallbacks: `adaptationRoutes.ts` falls back to `x-tenant-id` header then `'default-tenant'` when the tenant context is missing; `channelRoutes.ts:76` (WhatsApp webhook POST) takes tenant from `x-tenant-id` or `'system'`. Tenant must come only from the authenticated principal (or, for webhooks, from the verified phone-number mapping). Owner: backend stream (FIXED S16: `adaptationRoutes.ts` fallbacks replaced with authenticated `request.user.tenantId`; `channelRoutes.ts` unverified `'system'` fallback removed; verified in `orchestratorGraphMigration.test.ts`) | `src/api/routes/adaptationRoutes.ts:29,56,67,95,188`, `src/api/routes/channelRoutes.ts:76` |
| S51 | **P0** | Platform Model Registry and Skill Library showed **invented data** whenever their API call did not succeed: 5 "certified" models (Gemini/GPT-4o/Claude) with 94-99% pass rates, and 14 skills all "passed" with invocation counts. Both used raw `fetch` **without the auth token**, so behind auth they would always fail and always show the fake data. Registry also had a "Trigger Version Bump" simulation button that invalidated real certifications with a made-up version, an alignment check hard-wired to `gemini-2.5-pro`/`google` (conflicts with D2), and hardcoded "T1–T4", "7 Stages", "100% Typed", "Just now" metrics; every skill was labelled "✓ Deterministic" regardless of `is_deterministic` (FIXED S-UI-04: `apiFetch`, honest error/empty states, no sample rows, simulation control removed, operator enters model id/version with provider `openrouter`, metrics only from data with read time, determinism shown from the record; tests added) | `web/src/pages/platform/PlatformModelRegistry.tsx`, `PlatformSkills.tsx` |
| S52 | P1 | Smaller console fabrications/unsafe defaults (FIXED S-UI-04): Conversations send minted a new idempotency key per click (retries could double-send) and reported "dispatched successfully … ID: queued" regardless of the server status → one key per composed message reused on retry, banner states the server's actual status/id; Security secret rotation generated secrets with `Math.random` → `crypto.getRandomValues` (32 bytes); Fleet showed cluster health "HEALTHY" and 0 nodes / 0.0% when diagnostics were missing → "—"; Agent detail showed `gemini-2.5-pro` when no model policy existed → "Not set"/"Unreadable policy"; unreadable workflow DAGs showed "0 steps" → explicit error | `web/src/pages/app/Conversations.tsx`, `pages/platform/PlatformSecurity.tsx`, `PlatformFleet.tsx`, `pages/app/AgentDetail.tsx`, `WorkflowDetail.tsx`, `WorkflowList.tsx` |
| S53 | P2 | Observability metrics return `avgGroundingScore: 1.0` (a perfect score) when the tenant has **no** traces: a default confidence presented as a measurement. Owner: backend stream. Fix: return `null` when there is nothing to average (the console does not display this field) (FIXED S16: `traceRepository.getMetricsOverview` returns `avgGroundingScore: null` when `totalTraces === 0`; type updated to `number | null`; verified in `orchestratorGraphMigration.test.ts`) | `src/observability/repositories/traceRepository.ts:305-316` |
| S54 | P1 | Console overclaims found in WP-7.4 part 2 (FIXED S-UI-05): Brain Console alignment run showed fixed results as if measured ("schema 40/40 · tools 20/20 · bounds ✓", "T1 ✓ · T2 ✓", "key valid · quota ok") and a constant "Spend so far: ≈₹34 est."; a check that failed to start or poll was only `console.error`ed, leaving a silent spinner. The Activity Theatre drew a hardcoded reference agent team whenever no layout was configured (`HierarchyCanvas` default nodes), and an empty stream claimed "Workforce Resting — All scheduled tasks completed". Now: stage text describes what is checked; cost only from the report card; start/poll failures shown as alerts; no layout → empty state naming agents actually reporting; empty stream says only that nothing was reported | `web/src/pages/app/BrainConsole.tsx`, `web/src/components/theatre/ActivityTheatre.tsx`, `ActivityStream.tsx` |
| S55 | P1 | Cost-per-outcome report (WP-6.1) overclaims per workflow: `outcomesCount: stats.verified || stats.runs` counted runs as outcomes, `costPerOutcomeUsd` became cost per run, `verifiedActionRate` reported 100% with zero verified actions, `byModel.avgLatencyMs` was 0 with no calls, and unknown cascade levels counted as `L0_rule`. (FIXED Session 24: `stats.verified` strictly used without fallback, `costPerOutcomeUsd` null without verified outcomes, `verifiedActionRate` 0 when verified=0, `avgLatencyMs` null when calls=0, unknown cascade levels filtered; verified in `tests/unit/verificationAndProofRoutes.test.ts` and `outcomeInstrumentation.test.ts`) | `src/outcomes/service/outcomeInstrumentationService.ts:228-236, 298, 642` |

### Fix log
| Item | Fixed in | How |
|---|---|---|
| S1 | Session 02 (partial) | Real `OpenRouterAdapter`; `ModelRouter` uses it outside sandbox. S18 still open. |
| S2 | Session 02 | Deterministic adapter refuses to construct outside sandbox/test; its output is labelled `[SANDBOX]` |
| S3 | Session 02 | Unparseable output → `failed`, confidence 0, needs approval; verifier verdict now enforced |
| S4 | Session 02 | Queued-not-sent outside sandbox; sandbox sends labelled |
| S5 | Session 02 | Unknown DB driver throws; production readiness requires Postgres |
| S6 | Session 02 | Stripe intents refuse outside sandbox |
| S7 | Session 02 | Connector-less tools refuse outside sandbox; WhatsApp tool idempotency key deterministic |
| — | Session 02 | Also fixed: `contextData` was silently dropped before reaching the model; unknown-model cost was guessed |
| S1 | Session 03 | Fully fixed (resilience adapters real too); live-verified against OpenRouter |
| S18 | Session 03 | Resilience adapters execute through OpenRouter / local OpenAI-compatible server |
| S19 | Session 03 | Benchmark grades a real candidate's answer; sandbox runs labelled |
| S20 | Session 03 | Certification = real probe suite (`probeSuite.ts`) for harness and streaming check |
| S21 | Session 27 (fully resolved) | Production replay evaluator executes candidate proposals against real agent golden suites (`ALL_GOLDEN_SUITES`), enforcing zero regressions, reproduction checks, human gating, deterministic canary routing, and Ed25519 proof receipts |
| S22 | Session 03 | Failure injection sandbox-only (adapters + API 400) |
| S23 | Session 03 | Estimate from real probe tokens × live price; INR only with configured rate |
| — | Session 03 | Also fixed: lost-update on alignment runs (cancel overwritten); truncated replies; fake `keyLastFour` |
| S28 | Session 04 | Real OpenRouter `/key` handshake; unsupported providers refused |
| — | Session 04 | Also fixed: expired certifications were treated as valid; agents never used the owner's certified brain (now via the Model Gateway) |
| S32 | Session 06 | Canonical JSON at every depth for ledger, idempotency and checkpoint hashes |
| S33 | Session 07 | Hinglish probe set (appointment, count/fee, intent) in the real probe suite; live certification includes `hinglish` |
| S35 | Session 07b | SQLite client serialises statements and transactions (lock + per-async-context transaction tracking; nested → SAVEPOINT). Multi-instance concurrency still needs Postgres (WP-5.1) |
| S37 | Session 07b | Emergency triage (en/hi/te/ta/Hinglish/Telugu-English patterns + model intent) runs before consent; P0 Attention item; reply configurable per tenant (D7) |
| S38 | Session 07b | Reply language/script passed explicitly; answers not in the customer's script are withheld ("can't verify") |
| S7 (partial: booking) | Session 08 | Appointment booking: stateless fabricated IDs replaced by real appointment book system of record (`src/scheduling/appointmentBook.ts`, migration 042) with partial unique index, read-back `verify()`, saga `compensate()`, and code-bound `customerRef` (ADR-011, WP-4.3) |
| S37 (paging & hours) | Session 09 | Attention routing matrix: P0 emergency bypasses branch working hours to route immediately to emergency role with 0 delay (D7, WP-4.6); Verification agent runs async read-back jobs (`verification_jobs`) failing closed into Attention on discrepancies |
| S46 | Session 16 | Job-queue claim query allowlist validation against `high/default/low/batch` in `claimNextPendingJob` |
| S47 | Session 16 | Authenticate + RBAC (`agent:read`, `agent:write`, `billing:read`) on all 13 `brainRoutes.ts` endpoints; client `x-tenant-id` header fallback removed |
| S48 | Session 16 | Authenticate + RBAC on `modelCertificationRoutes.ts` and `skillRoutes.ts`; client-controlled request body `tenantId` overrides purged |
| S49 | Session 16 | Authenticate + RBAC (`agent:write`, `audit:read`) on `escalationRoutes.ts` with tenant isolation to `request.user!.tenantId` |
| S50 | Session 16 | Client-controlled tenant fallbacks purged from `adaptationRoutes.ts` and `channelRoutes.ts` |
| S53 | Session 16 | Observability metrics return `avgGroundingScore: null` (never fabricated 1.0) when 0 traces exist |
| S6 (payments & settlement) | Session 18 | Real payment link and hold repository (migration 047), appointment book slot prepayment holds, tool contracts with read-back verification & saga compensations, cryptographic webhook settlement (Razorpay, Stripe, Kriya Pay) with timingSafeEqual and Ed25519 proof receipts (WP-4.4) |
| S55 | Session 24 | Cost-per-outcome per-workflow fallbacks removed (`outcomesCount: stats.verified`, `costPerOutcomeUsd: null` when verified=0, `verifiedActionRate: 0` when verified=0); model `avgLatencyMs` returns `null` when calls=0; unknown cascade levels filtered; verified in `tests/unit/verificationAndProofRoutes.test.ts` |
| S24 | Session 25 | Claim-level entity extraction for numbers, dates, currency, proper nouns + discourse stopword filtering in QualityReviewer/DriftDetector so valid paraphrasing is not penalized; verified in `tests/unit/qualityReviewer.test.ts` |
| S27 | Session 25 | Multi-trial pass^k consistency (k >= 1, consistencyThreshold) in `probeSuite.ts` and `evalsAsCiService.ts`, separating transient provider/budget errors from reasoning failures; verified in `tests/unit/probeSuite.test.ts` and `tests/unit/evalsAsCi.test.ts` |

## 4. Blueprint capability ladder: where Omnitask actually stands

From blueprint §05, re-scored against the code (not the docs):

| Capability | Blueprint says | Code says | Gap → WP |
|---|---|---|---|
| Perceive (channels) | Strong | Inbound webhook parsing real; **outbound fake** | WP-5.2 |
| Understand / reason | Strong (router) | Real Model Gateway + cost cascade L0-L3 + charters | WP-1.x, WP-4.x |
| Plan multi-step | Adequate | Bounded agent loop + durable executor + checkpoints | WP-2.x |
| Execute actions | Adequate | Real appointment book (WP-4.3); connector framework in progress | WP-3.6, WP-5.x |
| Verify results | Partial | Synchronous tool `verify()` read-back + signed Proof receipts (WP-3.3, 3.4) + async `verification_jobs` (WP-4.6) | WP-3.4, WP-4.6 |
| Recover from errors | Partial | Saga compensator + Attention center & deterministic routing (WP-4.6) | WP-3.5, WP-4.6 |
| Escalate to humans | Strong | Real (attention center, tiers) | keep |
| Learn from outcomes | Missing | Missing | WP-6.x |
| Operate under permissions | RBAC + risk gates | Human RBAC only; no agent authority | WP-3.1 |
| Auditability | Strong | Real hash chain; not per-action receipts | WP-3.3 |

## 5. Earlier docs that overclaim

- `docs/implementation/EXECUTION_STATE.md`: 17 UI phases "COMPLETED". The UI exists, but it
  displays data from simulated agents.
- `docs/ui/XYLARC_UI_REDESIGN_CERTIFICATION.md`, `docs/certification/*`: "certification" language.
  Nothing has been externally certified.
- `docs/verification/FINAL_PRODUCTION_READINESS_REPORT.md` (2026-08-15) is **honest**: it
  concludes "NOT PRODUCTION READY" and lists S1, S5, S6. Still accurate.
