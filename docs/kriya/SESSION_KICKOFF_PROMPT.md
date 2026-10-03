# Kriya Omnitask — Universal Session Kickoff Prompt

Paste everything between the lines below as the FIRST message of every new coding-agent
conversation (Claude Code, Antigravity, Cursor, Codex…). It is the same prompt for every session
until the program is complete — the current state always comes from `docs/kriya/00_STATUS.md`.

---

You are continuing the production program for **Kriya Omnitask** — the autonomous-operations runtime of
**Kriya AI** ("Verified action. AI that acts, and proves it acted right."). Repository root:
`C:\Users\chait\OneDrive\Desktop\SYSTEMS_ALL\kriyaAI_omnitask` (TypeScript backend in `src/`, React console in `web/`).

## 1. Before writing ANY code — understand the current state (mandatory, in this order)
1. `docs/kriya/00_STATUS.md` — the live tracker: "Next up", decisions, every work package (WP) status, session log.
2. The newest file in `docs/kriya/sessions/` — exactly what the last session changed, its evidence, open findings, and "Next session should start with".
3. `docs/kriya/README.md` — the session protocol and the non-negotiable rules.
4. `docs/kriya/03_IMPLEMENTATION_PLAN.md` — the full spec (tasks, files, acceptance criteria, tests) of the WP(s) you will work on.
5. `docs/kriya/01_CURRENT_STATE_AUDIT.md` — what is real vs. simulated, and the S-numbered findings (open and fixed).
6. `docs/kriya/02_TARGET_ARCHITECTURE.md` — Verified Action, graph runtime, loops, cost cascade, Mandate, Proof.
7. `CLAUDE.md` (constitution) and, for any UI work, `KRIYA_AI_DESIGN_SYSTEM.md` + `docs/kriya/04_UI_UX_KRIYA_DESIGN.md`.
8. Inspect the actual code you will touch (read it; grep its callers). Never assume — the docs can lag the code.

Then run the baseline and report it before changing anything:
- `npx tsc --noEmit` (backend) and `npx tsc --noEmit -p web`
- Exact counts: `npx vitest run --reporter=json --outputFile=<scratch>/vt.json`, then read
  `numPassedTests` / `numFailedTests` / `numPendingTests` (the default reporter's colours break grep).
- Web: `cd web && npx vitest run`.
If the baseline is not green, fixing that is the first task.

Then state in 5–10 lines: the current milestone, the WP(s) you will do this session, and your plan.

## 2. What already exists (verify, don't rebuild)
- Runtime gate `src/core/config/runtimeMode.ts` (APP_MODE; production refuses unsafe config). Simulated adapters work ONLY in sandbox/test.
- Model calls: ONLY through `src/model/gateway/modelGateway.ts` (certified models only; owner's brain first; one schema repair). Provider: OpenRouter (`src/model/gateway/openRouterAdapter.ts`).
- Certification: real probe suite `src/model/certification/probeSuite.ts`.
- Graph runtime `src/runtime/graph/`: `types.ts`, `validator.ts` (rejects unsafe graphs), `executor.ts` (checkpoints, resume, idempotent side effects, human-gate parking, bounds, compensation), `handlers.ts` (real node handlers), `dagCompiler.ts` (legacy workflows → graphs), `agentLoop.ts` (bounded plan-act-verify loop).
- Trust `src/trust/`: `riskTiers.ts` (T0–T3), `mandate/mandateService.ts` (delegated authority), `proof/proofService.ts` (Ed25519 signed, hash-chained receipts). API: `src/api/routes/trustRoutes.ts`.
- Hashing: always `src/core/utils/canonicalJson.ts` (never `JSON.stringify(obj, keys)`).
Reuse these. Do not create a second router, executor, ledger or hashing helper.

## 3. Founder decisions (do not re-ask)
- Brand / legal name: **Kriya AI**. Product: **Kriya Omnitask**.
- Model provider: **OpenRouter**. A key is in the local git-ignored `.env` (`OPENROUTER_API_KEY`, `KRIYA_LIVE_TEST_OPENROUTER_KEY`). Never print, log, commit or copy it. Cheap test model: `deepseek/deepseek-v4-flash` (`KRIYA_LIVE_TEST_MODEL`).
- WhatsApp sending, payments (Razorpay/Stripe) and India hosting are **deferred** until the founder says go. Current focus: the AI agents that do the business's human work (blueprint §14–15).
- Any other open decision: record it in `00_STATUS.md` with a sensible default and proceed; ask only if truly blocking.

## 4. Engineering rules (non-negotiable)
1. **Verified or not done.** No code path may report success it did not observe. No invented IDs, no default confidence, no "sent" without a provider ID. Unverifiable → `submitted`, never `verified`.
2. **Models propose, code decides.** Policy, Mandate, risk tier and edge choices are deterministic code, never prompts. T2/T3 need Mandate; T3 always needs a human.
3. **Proof before "done".** Consequential actions get a signed receipt before anyone is told it is done.
4. **Tenant isolation everywhere** (every query scoped by `tenant_id`); never bypass auth/RBAC; never hardcode or log secrets.
5. **No silent fallbacks, no swallowed errors.** Fail loudly and honestly; failures become explicit `failed` / `escalated` outcomes.
6. **Bounded everything:** loops (maxVisits/maxSteps), retries, timeouts, budgets.
7. **Fix root causes**, in the shared function every caller uses. Smallest correct diff; match surrounding code; no speculative abstractions; no new dependency without a stated reason.
8. **Honest claims only.** Never claim "100% accurate", certified or compliant. Publish measured numbers. State known limits plainly.
9. When a test asserted fake behaviour, change the test to assert the honest behaviour and say so.
10. Before deleting anything, prove it has no callers (grep + typecheck + tests).

## 5. How to work
- One WP at a time, in "Next up" order; do not start a WP whose dependencies are not DONE.
- Every change ships with tests: unit/integration for each behaviour, regression tests for each bug, and adversarial cases (tampering, cross-tenant access, over-limit, injection, crash/resume) where relevant.
- Where a real model is involved, add a **live test** guarded by `describe.skipIf(!process.env.KRIYA_LIVE_TEST_OPENROUTER_KEY)` using the cheap model, and report its measured result (outcome, cost, latency). Tests must never spend money in test mode except these guarded live tests.
- Run `npx tsc --noEmit` after each meaningful edit; run the full suite before declaring anything DONE.
- If you find a new fake, bug or gap: fix it if it is in scope, otherwise log it in `01_CURRENT_STATE_AUDIT.md` as the next S-number with file:line.
- If a hook (e.g. a "Fact-Forcing Gate") blocks a write, state the requested facts briefly and retry; do not disable hooks.

## 6. Before the session ends (mandatory — even if work is unfinished)
1. Final evidence: backend tsc + web tsc clean; exact backend and web test counts; live test results.
2. Write `docs/kriya/sessions/SESSION_NN_<YYYY-MM-DD>.md` from the template in `docs/kriya/sessions/README.md`:
   goal, baseline, file-by-file changes (with WP/S ids), verification evidence, status changes, findings not fixed,
   known limits, and **"Next session should start with"** (exact WP + first concrete step).
3. Update `docs/kriya/00_STATUS.md`: "Next up", WP table rows (DONE only with evidence; otherwise IN PROGRESS with what remains), and a short session-log entry at the top.
4. Update `docs/kriya/01_CURRENT_STATE_AUDIT.md` (new findings + fix log) and the index in `docs/kriya/sessions/README.md`.
5. If architecture changed, add an ADR in `docs/architecture/decisions/`.
6. Update the agent's own memory notes (if the tool has memory) with: where the tracker is, what is done, what is next.
7. End with a plain summary for the founder: what was built, the measured evidence, what is still open, and the next step. No overclaiming.

## 7. Definition of "production ready" for this program
The launch gate in `03_IMPLEMENTATION_PLAN.md` (M8 · WP-8.6) — every box checked with evidence:
no simulated adapter reachable in production; Postgres with a tested restore; every consequential path
policy → mandate → tool → verify → proof (validator-enforced); live provider tests for ≥ 2 providers;
golden eval suites passing for all five agents with measured verified-action rates per tier; tenant-isolation
suite on Postgres; kill switches tested; CI green; rollback rehearsed; no unsupported claims in UI or copy.
Until every box is checked, the honest status is "not yet production ready" — say so.

Now start with section 1.

---
