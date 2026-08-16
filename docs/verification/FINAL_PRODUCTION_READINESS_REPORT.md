# Xylarc AI — Final Production Readiness Report

**Audit date:** 2026-08-15
**Auditor role:** independent verification pass against the running system and source code — not a review of documentation claims
**Companion doc:** `docs/verification/PRODUCTION_READINESS_MATRIX.md` (capability-by-capability status table)
**Scope note:** `docs/verification/FRONTEND_BACKEND_WIRING_AUDIT.md` and `docs/verification/AGENT_WIRING_AUDIT.md` were not produced as separate files — the wiring evidence they'd contain (route→middleware→tenant-context→repository chain for the frontend/backend boundary, and orchestrator→agent→tool→model-provider chain for the agent system) is folded into §6 and §7 below rather than duplicated across files.

---

## 1. Executive Summary

Xylarc AI's **control-plane scaffolding is real and largely well-built**: authentication is genuine cryptography, tenant data isolation is enforced correctly at the query layer, the database schema is comprehensive (27 migrations across every domain in CLAUDE.md), and the frontend builds, typechecks, and passes its test suite end to end. This is not a hollow demo shell.

However, the platform is **not production ready**. Verification found one confirmed live security vulnerability (since fixed and re-verified during this audit — see §5) and two of the product's core value propositions — autonomous AI agents and payment processing — are entirely simulated with no real external calls. Specifically:

- **P0 — Cross-tenant privilege escalation — FIXED 2026-08-15.** Originally: any tenant's own `owner`/`super_admin`/`admin` user could call Xylarc's platform-operator-only `/api/v1/admin/*` endpoints and read every other tenant's organization data. Fixed during this audit (§5, §9) and re-verified live: the same exploit now returns `403`.
- **P0 — No real AI inference:** every model provider adapter (Google/OpenAI/Anthropic/etc.) returns a hardcoded template string. No agent in this system has ever reasoned about anything.
- **P0 — No real payments:** the Stripe adapter fabricates payment intent IDs and client secrets locally; no Stripe API is called.
- **P0 — Silent storage downgrade:** configuring `DB_DRIVER=postgres` silently falls back to ephemeral in-memory SQLite with no error or warning — a production deployment believing it has durable storage would lose all data on every restart.
- **P1 — No CI/CD, no Docker, no `.env` documentation, no real git history** for this project (repo root resolves to the entire Windows user profile with zero commits).

**Final decision: NOT PRODUCTION READY.** (§10)

This does not mean the work done so far is low quality — the parts that are real (auth, tenant isolation, schema, frontend) are genuinely solid. It means the system cannot yet be trusted to run a real business's customer lifecycle unattended, per CLAUDE.md §43's standard.

---

## 2. What Was Actually Verified vs. What Was Claimed

`docs/implementation/EXECUTION_STATE.md` claims all 17 frontend phases are `COMPLETED` with "100% Green across all 413 tests." That specific claim is **accurate as far as it goes** — this audit independently re-ran the suites and confirmed 359 backend + 54 frontend tests passing, typecheck clean on both sides, and a successful production `vite build`. But per this audit's mandate, passing tests and clean builds are not proof of production readiness — they prove the code doesn't throw on the paths it exercises, not that the paths do anything real. The gap between "tests pass" and "production ready" is exactly where the P0 findings below live: the agent and billing test suites pass because they test against the same mock adapters that are the problem, not because they exercise a real LLM or a real Stripe sandbox.

---

## 3. Architecture as Actually Found

Confirmed by reading `src/index.ts` and the domain source trees (not from documentation):

- Fastify 5 backend, ~160 exported modules across ~30 domains matching CLAUDE.md's domain boundaries (§28).
- `node:sqlite` (`DatabaseSync`) is the only functioning DB driver. A `DatabaseClient` interface exists to also support Postgres, but no Postgres implementation class exists anywhere in the repo.
- JWT auth is hand-rolled HMAC-SHA256 (`node:crypto`), not a third-party JWT library — verified correct (signature check via `timingSafeEqual`, expiry check).
- Tenant context propagates via `AsyncLocalStorage` (`src/core/context/tenantContext.ts`), set once per request in each route handler via `TenantContextManager.withTenant(user.tenantId, ...)`, then read by repositories server-side — never trusted from client input.
- React 19 + Vite frontend (`web/`), code-split by route, 17 pages across client-admin and platform-owner surfaces.

---

## 4. Database & Migrations

- 27 sequential `.sql` files under `src/storage/migrations/` (`001_initial_schema.sql` → `027_production_hardening_schema.sql`), one per CLAUDE.md domain, applied cleanly on live boot — confirmed via `GET /health` returning `"database":{"status":"connected"}` after a fresh in-memory boot.
- **P0 finding:** `src/storage/db.ts:124-136`, `DatabaseManager.getClient()`:
  ```ts
  if (driver === 'sqlite') {
    this.client = new SQLiteDatabaseClient(url);
  } else {
    // Fallback or future Postgres adapter
    this.client = new SQLiteDatabaseClient(':memory:');
  }
  ```
  Setting `DB_DRIVER=postgres` does not error — it silently substitutes ephemeral in-memory SQLite. Combined with `DATABASE_URL` also defaulting to `:memory:` (`config.ts`), an operator can run this system for weeks believing they have a durable Postgres-backed production deployment while every byte of data disappears on the next process restart.

---

## 5. Authentication & Authorization

**Authentication — PASS.** Live-tested against a fresh server: `POST /auth/register` (requires `organizationName`, `tenantSlug`, `tenantName`, `email`, `password`, `fullName`) and `POST /auth/login` (requires `email`, `password`, `tenantSlug`) both work correctly against real SQLite-backed persistence. Tokens are structurally valid JWTs (313 chars, correct dot-segment count), signature-verified with `timingSafeEqual`, and rejected correctly when malformed.

**Authorization — FIXED (P0, originally confirmed live, closed and re-verified during this audit).** Root cause traced to `src/security/rbac/rbac.ts:53-90` and `:149-...`:

```ts
export const ROLE_PERMISSIONS: Record<StandardRole, Permission[]> = {
  owner:       [ ..., 'system:admin', ... ],   // BEFORE FIX
  super_admin: [ ..., 'system:admin', ... ],   // BEFORE FIX
  admin:       [ ..., 'system:admin', ... ],   // BEFORE FIX
  ...
  system:      [ ..., 'system:admin', ... ],   // correct — unchanged
```

`system:admin` is the single permission gating **every** route in `src/api/routes/adminRoutes.ts` (9 routes, all `preHandler: [authenticate, requirePermission('system:admin')]`) — these are Xylarc's platform-operator console endpoints per CLAUDE.md §7, meant only for Xylarc's own operators, explicitly warned in §7: *"Platform operators must never casually bypass tenant boundaries."* But `system:admin` was also granted to `owner`, `super_admin`, and `admin` — the roles every tenant's own registering user gets by default (`authRoutes.ts` assigns `owner` at registration).

**Live reproduction (original bug):**
1. Registered Tenant A (`owner` role) and Tenant B, obtained real JWTs for both.
2. Tenant A created a customer record.
3. Confirmed correct isolation first: Tenant B's token → `GET /customers` → `{"customers":[],"total":0}`; direct `GET /customers/{TenantA's real UUID}` → `404 NOT_FOUND`. Tenant data isolation itself is genuinely correct.
4. Then called `GET /api/v1/admin/tenants` using **Tenant A's own token** (never elevated, never a platform-operator account) → **`200 OK`** with the full tenant registry, including Tenant B's `id/name/slug/status/plan_tier/channel_plan/created_at/updated_at`.

This was a confirmed, reproducible cross-tenant data exposure plus a platform-operator privilege escalation from an ordinary tenant signup — CLAUDE.md §38 rule 7 ("Never bypass tenant isolation") and rule 8 ("Never bypass authorization") were both violated in production code, not hypothetically.

**Fix applied 2026-08-15** (see §9 for full detail): removed `system:admin` from `owner`, `super_admin`, and `admin` in `ROLE_PERMISSIONS`. It now lives only on `system` — confirmed to be the platform's actual operator-role convention via `tenantRoutes.ts`'s cross-tenant bypass check (`!user.roles.includes('system')`) and the fact that no signup/registration path ever assigns `'system'` to a user.

**Live re-verification (post-fix):**
1. Rebuilt (`npm run build`), started a fresh server, registered a new Tenant A2, obtained a real `owner`-role JWT.
2. `GET /api/v1/admin/tenants` with that token → **`403 FORBIDDEN`**, `"Missing required permission 'system:admin'. Active roles: [owner]"`.
3. Confirmed the fix didn't over-restrict: the same token's `POST /customers` (a legitimate tenant-scoped write) still returned `201 Created`.
4. Full backend suite re-run: 154/154 files, 359/359 tests pass. 5 integration tests (`platformAdmin`, `deploymentRelease`, `infrastructure`, `productionHardening`, `sreObservability`) initially broke because they had synthesized their own "platform operator" test JWTs using the same wrong role names (`owner`/`admin`/`super_admin`) instead of `system` — the same conflation bug, present in test fixtures too. Corrected each to use `roles: ['system']`, matching how a real Xylarc platform operator would actually authenticate.

---

## 6. Frontend ↔ Backend Wiring

Traced the full chain for a representative write path (`customerRoutes.ts`) and confirmed it is real, not just present:

```
UI action → apiClient (web/src/lib/apiClient.ts) → HTTP request with Bearer token
  → authenticate() middleware (verifies JWT, loads tenant, checks tenant.status === 'active')
  → requirePermission(perm) middleware (RBACService.assertPermission)
  → TenantContextManager.withTenant(user.tenantId, ...) wraps the handler
  → Zod schema validation (e.g. CreateCustomerSchema)
  → repository query scoped by server-derived tenant_id (never client-supplied)
  → SQLite write
  → structured JSON response
  → frontend state update
```

Every route file sampled (`customerRoutes.ts`, `adminRoutes.ts`) follows this pattern consistently — this is a genuine, uniform security pattern, not ad hoc per-route logic. The 17 frontend pages typecheck, build, and their component tests pass against a mocked API layer (`GoldenPaths.test.tsx` covers one cross-page navigation smoke path). **Not independently verified:** driving an actual browser against the actual running backend for all 17 pages — this audit verified the backend side of the contract directly via HTTP and verified the frontend side via its own test suite, but did not click through the live UI end-to-end in a browser.

---

## 7. Agent System Wiring — the Core P0 Finding

Traced the full intended chain per CLAUDE.md §12–§13:

```
Orchestrator agent config → Manager agent → Specialist agent → Tool/Model call → Result
```

**What's real:** `POST /api/v1/agents/bootstrap` genuinely creates 5 structurally correct default agents per tenant (`business_orchestrator`, `sales_lead_qualifier`, etc.), each persisted with a real `config_json` containing system prompt, tools, dataAccessScope, modelPolicy, escalationRules, limits, and owner — matching CLAUDE.md §39's agent Definition-of-Done shape. The agent hierarchy, persistence, and configuration model are genuinely implemented.

**What's fake:** `src/model/resilience/adapters/modelProviderAdapter.ts` — every adapter (`GoogleProviderAdapter.execute()`, and the OpenAI/Anthropic/DeepSeek/Local equivalents) does not perform any HTTP call to an LLM API. It synchronously returns a hardcoded template string of the shape `` `[Google ${model} Response]: Processed prompt of N tokens...` ``, with a `mockFailure` option used only to simulate provider outages for fallback-routing tests. No API key configuration for any LLM provider exists anywhere in `src/core/config/config.ts`.

**Consequence:** every agent "decision," "recommendation," and "verified outcome" this system has ever produced is a string template, not a reasoned output. This directly contradicts CLAUDE.md §14's Trust Architecture ("Retrieve → Validate → Decide → Execute → Verify" against real systems of record) and §36's north star ("AI should reason"). This is the single most important gap in the entire audit — it is the platform's core value proposition, and it does not exist yet in working form.

**Fix classification:** requires real provider credentials and API integration work — out of scope for an unattended fix in this audit; documented, not silently patched.

---

## 8. Other Subsystems Checked

| Area | Finding |
|---|---|
| Webhook signature verification (WhatsApp/Meta) | Real: `src/channels/security/webhookVerifier.ts` does genuine HMAC-SHA256 over `X-Hub-Signature-256` with `timingSafeEqual`. `WHATSAPP_APP_SECRET` still defaults to a hardcoded test string with no production-mode enforcement that it be overridden. |
| Billing / Stripe | Fake: `src/billing/stripe/stripePaymentAdapter.ts createPaymentIntent()` fabricates `pi_...` IDs and client secrets locally — zero Stripe SDK/HTTP calls anywhere in the file. |
| CI/CD, Docker, env docs | None exist — no `.github/workflows`, `Dockerfile`, `docker-compose*`, `.env`/`.env.example` anywhere in the repo. |
| Version control | `git status`/`git log` from the project resolve to a repo rooted at the entire Windows user profile (`C:\Users\chait`), currently `main` with **no commits**. No real deploy/rollback history exists for this project. |
| Hardcoded secret defaults | `JWT_SECRET`, `ENCRYPTION_KEY`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET` all have literal hardcoded fallback values in `config.ts`'s Zod schema, with no `NODE_ENV==='production'` guard rejecting them. |
| Multilingual/voice/knowledge/BI (CLAUDE.md §11, §19–§22) | NOT_VERIFIED — modules exist, export cleanly, and follow the same tenant-scoped pattern by code inspection, but were not individually exercised via live calls in this pass. Given the confirmed "real scaffolding + fake external call" pattern above, this audit does not extend a PASS by inference. |

---

## 9. Fixes Applied vs. Documented-Only

Per this audit's Automatic Fix Policy:

**Fixed (clear, localized, low-regression-risk):**
- **RBAC cross-tenant privilege escalation.** `src/security/rbac/rbac.ts`: removed `'system:admin'` from the `owner`, `super_admin`, and `admin` role-permission arrays (3 one-line diffs). This permission now exists only on the `system` role, matching its actual use elsewhere in the codebase as the platform-operator/cross-tenant-bypass marker. No new role, permission, or abstraction was introduced — this is strictly a data correction to an existing, otherwise-correct permission model, so it did not require the broader architectural redesign originally anticipated in the earlier draft of this report.
- **Test fixtures for platform-operator routes** (`tests/integration/platformAdmin.test.ts`, `deploymentRelease.test.ts`, `infrastructure.test.ts`, `productionHardening.test.ts`, `sreObservability.test.ts`): each had synthesized its own "operator" JWT using tenant-role names (`owner`/`admin`/`super_admin`) instead of the platform's actual operator role (`system`) — the identical conflation as the production bug, just on the test side. Corrected all 5 to `roles: ['system']`. This is the root-cause fix, not a workaround: these tests exercise genuinely platform-operator-only capabilities (deployment/release engineering, infrastructure, platform tenant administration, chaos/red-team hardening, SRE observability — all correctly gated behind `system:admin` per CLAUDE.md §7), so asserting them via the correct operator role is the accurate test, not a loosened one.
- Verified with: `npm run typecheck` (clean), `npm test` (154/154 files, 359/359 tests, including the 5 corrected ones), a full rebuild, and a live re-run of the original exploit against a fresh server (now `403`), plus a control check confirming normal tenant-scoped writes (`POST /customers`) still succeed (`201`) for the same `owner`-role token.

**Left documented only (architectural / requires external resources, per this audit's fix policy):**
- Real LLM and Stripe integration require actual API keys/accounts — cannot be fabricated by this audit.
- Postgres adapter implementation is a real engineering task, not a one-line fix.
- Git history and CI/CD setup are structural/process decisions for the user to confirm before this audit takes any destructive or repo-initializing action.

---

## 10. Final Production Readiness Decision

> **NOT PRODUCTION READY**

Justification, directly against CLAUDE.md §42's priority order (Safety → Security → Privacy → Correctness → ...):

- **Security/Privacy — was the first and hardest failure, now fixed and re-verified live (§5, §9).** This is no longer a blocker.
- **Correctness still fails at the product's core:** the AI agent system performs no real inference; the billing system performs no real payment processing. Both are the literal subject matter of CLAUDE.md §4's core vision and would mislead any real business relying on them.
- **Reliability/Data integrity still fails silently:** Postgres configuration silently downgrades to ephemeral storage with no operator-visible warning — this violates §28's explicit rule, "never silently mark a failed action as successful," in spirit if not in exact wording (a durability failure that produces no error is the same category of problem).

None of these are close calls requiring judgment — each has direct, reproducible evidence (§5–§8). Per §46 of the audit brief, this is not a guess.

**Remaining work to reach "PRODUCTION READY WITH CONDITIONS":**
1. ~~Fix the RBAC role/permission model~~ — **done** (§5, §9).
2. Either wire real LLM provider calls behind real API keys, or explicitly relabel/gate the agent system as non-functional until it is (P0, still open — requires real credentials, outside this audit's authority).
3. Either wire real Stripe calls behind real API keys, or explicitly gate billing as non-functional until it is (P0, still open — same reason).
4. Make `DB_DRIVER=postgres` either work or fail loudly at startup instead of silently substituting SQLite (P0, still open).
5. Add `.env.example`, a minimal CI workflow (typecheck + test on PR), and initialize real version control for this project (P1, still open).

Answering the audit's closing question directly: **a real business cannot yet safely trust Xylarc AI to operate its customer lifecycle and autonomous workforce continuously in a production environment** — not because the foundation is bad, but because the two subsystems the business would actually be paying for (autonomous AI agents, payment processing) do not yet perform their real function, and a live authorization bug would expose that business's data to every other tenant on the platform.
