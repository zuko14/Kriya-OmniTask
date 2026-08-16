# Xylarc AI Frontend Rebuild — Phase 2+ Implementation Plan

**Audience: a different coding agent picking this up cold**, with no access to the conversation that produced Phase 1. Everything you need is either in this document or in the files it points to. Do not skip the "Read before you build" step in each phase — this repo has already punished one skipped verification (see the incident note below) and will punish another.

---

## 0. What already exists — read this first

Phase 1 shipped a real, working foundation. **Do not rebuild any of this. Extend it.**

- `web/` — Vite + React + TypeScript SPA, sibling to `src/` (the Fastify backend). `cd web && npm install && npm run dev` (default `:5173`). Backend: `npm run build && npm start` from repo root (`:3000`).
- `web/src/lib/apiClient.ts` — the only place that calls `fetch`. Wraps auth headers, parses the `{ error: { code, message, statusCode, correlationId, details } }` envelope, throws typed `ApiError`. **Reuse this for every new API call. Never call `fetch` directly from a page.**
- `web/src/lib/authContext.tsx` — `useAuth()` gives `{ auth, status, login, logout }`. `auth.user.roles` is the JWT's role array.
- `web/src/lib/useAsync.ts` — the hand-rolled `useAsync(fetcher, deps)` hook every page uses for loading/success/error state. Still fine at this scale; see §0.3 for when to revisit.
- `web/src/components/{AsyncState,KpiCard}.tsx` — shared building blocks. `AsyncState` already renders the loading/error/empty/403 states correctly (403 → "Access denied…", never a redirect). Reuse; extend with new shared components (a `DataTable`, a `Drawer`, a chart wrapper) only when a second page needs the same pattern — see the ponytail rule below.
- `web/src/shell/{AppShell,TopBar,Sidebar,RouteGuard}.tsx` — the app shell. `Sidebar.tsx` has two hardcoded nav arrays (`CLIENT_NAV`, `PLATFORM_NAV`) where every item except `Overview` is a disabled "Soon" placeholder. **Each phase below turns exactly one of those placeholders into a real `to:` link** — do this by editing the nav array, not by inventing new nav structure.
- `web/src/pages/app/ExecutiveOverview.tsx` and `web/src/pages/platform/PlatformOverview.tsx` — the two real pages built so far. Read these as the reference pattern for every new page: typed response interfaces next to the fetch function, `useAsync` per data source, independent `AsyncState` per card, real empty-state copy, no mock data anywhere.
- `docs/ui/XYLARC_DESIGN_DIRECTION.md` — the token system (palette, type roles, spacing/radius/elevation). **Do not add new colors or fonts without updating this doc and having a reason tied to CLAUDE.md §31.** New components use the existing tokens via `var(--color-*)` etc.
- `docs/ui/FRONTEND_BACKEND_CONTRACT_MAP.md` — running log of every endpoint the frontend actually calls, with real field names. **Every phase appends its own section here before being considered done.**
- Root `vitest.config.ts` (`test.include: ['tests/**/*.test.ts']`) isolates the backend's Vitest run from `web/`'s. Don't remove it or backend tests will start collecting frontend `.test.tsx` files and break.

### 0.1 The incident that shapes the verification rule below

Phase 1 built the "Needs Attention" card against a guessed query value, `status=open`. It compiled, typechecked, and the unit test passed (because the unit test also mocked the guess). It 500'd the instant it hit a real running server — the actual enum is `pending|claimed|resolved|dismissed|timed_out` (`src/attention/types/attentionTypes.ts`). The bug was caught only by registering a real tenant and curling the live endpoint.

**Conclusion carried into every phase below: typecheck and unit tests do not catch request-shape mistakes, because both sides of the mock are written by the same guess. Every phase's Definition of Done includes hitting the real running backend, not just green tests.**

### 0.2 Known backend gap — do not silently paper over

Every RBAC role is tenant-scoped (`src/security/rbac/rbac.ts`). A tenant's own `owner` role (created via ordinary self-service `POST /api/v1/auth/register`) already holds `system:admin` and can call every `/platform/*`-backing endpoint. There is no backend-enforced separate "platform staff" identity. The frontend's `/platform/*` route guard (`web/src/shell/RouteGuard.tsx`, `PLATFORM_ROLES = ['owner','super_admin','admin','system']`) is navigation convenience, not a real access boundary. Keep building the Owner plane as if it were real UI/IA separation — it is — but never claim in copy, docs, or comments that it's a security boundary. If a phase below needs a genuinely private cross-tenant action, flag it instead of building it.

### 0.3 Ponytail discipline — carried forward, not optional

- No new npm dependency without checking "can the existing stack do this in ~40 lines." `useAsync` stays hand-rolled until a page needs shared cache, polling, or optimistic mutation across pages — the first phase that needs that should say so explicitly and *then* add TanStack Query, not before.
- No component abstracted until the second real usage exists. `KpiCard`/`AsyncState` were justified because Phase 1 had two pages needing them on day one; a `DataTable` component is justified in whichever phase below is the *second* page that needs a real data table (skim ahead — it's probably Customer 360 or Tenant Management, but build it when you get there, not preemptively in Phase 2).
- No page ships with mock/placeholder/Lorem-ipsum data. If a phase's target page needs a backend endpoint that turns out not to exist, that is a **stop-and-flag** condition (see §0.4), not a build-it-anyway condition.

### 0.4 Feasibility check per phase (CLAUDE.md §41)

Before writing a page's fetch calls, grep the relevant route file(s) named in that phase for the actual endpoints. If what the phase needs isn't there:
- **Endpoint exists but shape differs from what's assumed here** → adjust and note the correction in the contract map doc (exactly like the `status=open` fix).
- **Endpoint genuinely doesn't exist** → do not invent one client-side and do not fabricate data. Classify per CLAUDE.md §41 (Production-ready / Prototype-ready / Research-stage / Not currently reliable enough) and either scope the page down to what's real, or stop and report back rather than shipping a fake page.

### 0.5 Definition of Done, every phase (apply verbatim)

1. Backend untouched (or, if a route genuinely needs to change, that's called out and minimized — see CLAUDE.md §34 backend-safety rules).
2. `npm run typecheck && npm test` at repo root — still green, unchanged count from before the phase.
3. `cd web && npm run typecheck && npm test && npm run build` — green.
4. Live verification: start the backend (`npm run build && npm start`, pick a free port via `PORT=`), register/seed real data through real endpoints (never insert directly into the DB), hit the new page's endpoints with `curl` first, *then* drive the actual page in a browser (chrome-devtools MCP tools, if available, exactly as Phase 1 did — screenshot + console check, not just "it compiled").
5. `docs/ui/FRONTEND_BACKEND_CONTRACT_MAP.md` gets a new section: endpoint, permission, real response shape, which UI element consumes it.
6. The relevant `Sidebar.tsx` nav item flips from disabled "Soon" to a real link.
7. No console errors/warnings in the browser check.

---

## 1. Route inventory (all 34 files under `src/api/routes/`, for phase assignment)

Confirmed present this session — grep each file yourself for exact paths/schemas before building against it, this list is a map, not a contract:

`healthRoutes, adminUiRoutes, hardeningRoutes, deploymentRoutes, sreRoutes, infrastructureRoutes, billingRoutes, adminRoutes, governanceRoutes, costRoutes, modelResilienceRoutes, reliabilityRoutes, securityHardeningRoutes, multilingualRoutes, evaluationRoutes, simulationRoutes, attentionRoutes, verificationRoutes, observabilityRoutes, biRoutes, digitalTwinRoutes, knowledgeRoutes, workforceRoutes, workflowRoutes, policyRoutes, toolRoutes, orchestrationRoutes, agentRoutes, channelRoutes, customerRoutes, userRoutes, authRoutes, orgRoutes, tenantRoutes`

Confirmed this session, already usable without re-discovery:
- `customerRoutes.ts`: `GET/POST /api/v1/customers`, `POST /customers/resolve`, `GET /customers/:id`, `POST /customers/:id/timeline`, `POST /customers/:id/consent`, `POST /customers/:id/merge`, `GET /customers/:id/export`, `DELETE /customers/:id`.
- `agentRoutes.ts`: 8 routes (list, create, get, delete, lifecycle actions, etc. — re-grep for exact paths, only counted here).
- `workflowRoutes.ts`: 9 routes.
- `knowledgeRoutes.ts`: 6 routes.
- `channelRoutes.ts`: WhatsApp webhook (in/out), `POST /channels/send`, `GET /channels/messages/:id`, channel config get/set. **No dedicated conversation-list endpoint** — see Phase 4 note.

---

## Phase 2 — Human Attention Center (Client plane)

**Unlocks:** Sidebar "Human Attention" (`/app/attention`).
**Backend:** `attentionRoutes.ts` (already partly used in Phase 1 — reread it fully now). Confirmed routes from Phase 1: `POST/GET /attention/items`, `GET /attention/items/:id`, `POST /attention/items/:id/claim`, `POST /attention/items/:id/resolve`, `POST /attention/takeovers`, `POST /attention/takeovers/:customerId/handback`, `GET /attention/takeovers/active/:customerId`, `GET /attention/metrics`.
**Build:**
- A real queue page: list all `AttentionItemRecord`s (not just `status=pending` like the Overview card — add a status filter control backed by the real enum `pending|claimed|resolved|dismissed|timed_out`), grouped/sortable by `priority` (`LOW|MEDIUM|HIGH|CRITICAL` per `biTypes.ts`'s `AttentionItem` — confirm against `attentionTypes.ts`'s actual enum, they may differ).
- Row actions wired to real mutations: **Claim** (`POST .../claim`), **Resolve** (`POST .../resolve`, check `ResolveAttentionItemRequestSchema` for required fields), **Take over** (`POST /attention/takeovers`). Every action button that can fail (403, validation) shows the real error, not a silent no-op.
- A `GET /attention/metrics` summary strip at the top.
**Non-goals:** live/streaming updates (poll-on-focus or manual refresh is enough here — no WebSocket infra exists yet, don't add one for this alone), the full workflow-integration story (§16 of the original spec) — that's Phase 6.
**New shared component candidate:** a `DataTable` — this is the second page needing a sortable/filterable table (first was the tenant table in Platform Overview, which was simple enough to inline). Build it now if useful; keep it dumb (props: columns, rows, no built-in fetching).

---

## Phase 3 — Customer 360

**Unlocks:** Sidebar "Customers" (`/app/customers`, `/app/customers/:id`).
**Backend:** `customerRoutes.ts` (routes confirmed above — reread for exact request/response shapes, especially what `GET /customers/:id` actually embeds: does the timeline come back inline, or is `POST /customers/:id/timeline` actually the retrieval route despite the verb? Verify before assuming — an odd verb on a "timeline" path is exactly the kind of guess that broke Phase 1).
**Build:**
- List page: table of customers (reuse the Phase 2 `DataTable` if built), search/filter using whatever query params `GET /customers` actually accepts.
- Detail page: identity, lifecycle stage, and a chronological timeline view — but only render what the API actually returns per customer (sentiment/intent/orders/etc. per the original spec's §14 are aspirational; only wire what's real, mark the rest absent rather than empty-faking it).
- Respect `GET /customers/:id/export` (GDPR export) and `DELETE /customers/:id` as real, dangerous actions — put them behind an explicit confirm step, they are irreversible per CLAUDE.md §15 (HIGH/CRITICAL risk actions need friction, not a bare button).
**Non-goals:** identity-resolution "why were these merged" explainability UI (needs `POST /customers/resolve` semantics fully understood first — if the response doesn't carry a reason, don't fabricate one, defer this).

---

## Phase 4 — Conversation Experience

**Unlocks:** Sidebar "Conversations" (`/app/conversations`).
**Backend:** **Not confirmed to exist as a dedicated resource.** `channelRoutes.ts` has `POST /channels/send` and `GET /channels/messages/:id` (single message by id) but no list/thread endpoint was found this session. Do the §0.4 feasibility check first:
1. Grep `channelRoutes.ts`, `customerRoutes.ts` (timeline may carry conversation turns), and `workforceRoutes.ts`/`orchestrationRoutes.ts` (agent execution logs might embed conversation turns) for anything resembling a thread/conversation list.
2. If found: build the page against it, same pattern as every other phase.
3. If genuinely absent: **do not build a fake conversation viewer.** Report this as a real backend gap (a `GET /channels/conversations` or similar list endpoint doesn't exist) rather than mocking one, and either skip this phase or scope it to "conversation turns visible only from within a Customer 360 detail page" if the timeline embed from Phase 3 actually carries them.

---

## Phase 5 — Agent Command Center + Agent Detail

**Unlocks:** Sidebar "Agents" (`/app/agents`, `/app/agents/:id`), partially "Digital Workforce" if that's meant to be an alias (confirm with whoever owns product intent — don't guess a second nav destination for the same data).
**Backend:** `agentRoutes.ts` (8 routes — grep for exact paths: list, get, create, lifecycle transitions, delete), `orchestrationRoutes.ts` and `verificationRoutes.ts` for execution-trace / verification data if the detail page is meant to show a task trace (original spec §13's "TASK RECEIVED → PLAN → ... → RESULT" timeline). Same feasibility check as Phase 4 — only build the trace UI if a real per-execution trace endpoint exists (check `observabilityRoutes.ts`'s trace endpoints too, already used successfully in spirit by Phase 1's fleet-diagnostics pattern).
**Build:**
- Fleet list: agent name, role/type, status, last execution time — whatever `GET` on the list route actually returns.
- Detail page: capabilities, recent executions, success/latency/cost if the backend actually tracks them per-agent (cross-check against `costRoutes.ts`'s `agentId` field, already known from Phase 1's cost record shape — you can filter/aggregate cost records client-side by `agentId` if there's no dedicated per-agent cost endpoint, rather than inventing one).
**Non-goals:** the full execution-timeline visualization from the original spec unless a real trace endpoint is confirmed (see above).

---

## Phase 6 — Workflows

**Unlocks:** Sidebar "Workflows" (`/app/workflows`, `/app/workflows/:id`).
**Backend:** `workflowRoutes.ts` (9 routes — grep for exact paths/schemas).
**Build:**
- List + detail for whatever a "workflow" resource actually is in this backend (definition, not template) — read `src/workflows/types/workflowTypes.ts` before assuming it matches the original spec's node-graph vocabulary (Trigger/Condition/Agent/Tool/Approval/etc.).
- If the backend models workflows as a DAG with steps, render a simple linear/step list first (not a full node-based graph editor — that's real engineering effort disproportionate to Phase 1's pace; a graph *visualization* of an existing read-only structure is reasonable, a graph *editor* is not in scope here unless explicitly requested later).
**Non-goals:** building a workflow editor/builder UI. This phase is read/visualize only, matching "the UI is a visualization/control layer over existing APIs" from the original spec — never reimplement the workflow engine's logic client-side.

---

## Phase 7 — Business Intelligence / Analytics (charts)

**Unlocks:** Sidebar "Analytics" and "Business Intelligence" (`/app/analytics`) — decide whether these are one page or two once you see what `biRoutes.ts` and `observabilityRoutes.ts` actually expose; don't build two near-identical pages for one data source.
**Backend:** `biRoutes.ts` (briefings — already partly used), `costRoutes.ts` (`/cost/outcomes`, `/cost/outcomes/unit-economics`, `/cost/summary` — none used yet, all real per Phase 1's research), `observabilityRoutes.ts`.
**Build:** This is the first phase that needs real charts. **Load the `dataviz` skill before writing any chart code** (available in this environment — trend lines for time series, funnels for conversion, heatmaps for time-of-day density; never a bar chart by default per CLAUDE.md §31). Candidates backed by confirmed real endpoints: spend-over-time (from `/cost/records` or `/cost/summary`), unit economics (`/cost/outcomes/unit-economics`), briefing history (`/bi/briefings`, already fetched in Overview — this page shows the full list + detail, not just latest).
**Non-goals:** predictive charts (churn, forecasts) unless a real prediction endpoint with confidence/model-version metadata exists (CLAUDE.md §22: "never present a prediction as a fact" — if there's no confidence/version field in the response, don't build a forecast chart, it can't be labeled honestly).

---

## Phase 8 — Knowledge Center

**Unlocks:** Sidebar "Knowledge" (`/app/knowledge`).
**Backend:** `knowledgeRoutes.ts` (6 routes).
**Build:** Document/source list with status, ingestion state, whatever freshness/version metadata the backend actually returns (CLAUDE.md §18/§31 call for freshness display — only if the field exists; don't synthesize a "2 minutes ago" if the API doesn't provide a timestamp).
**Non-goals:** an embeddings/vector inspector (explicitly out of scope per the original spec too — "do not expose internal embeddings unnecessarily").

---

## Phase 9 — Billing/Cost (full page) + Settings

**Unlocks:** Sidebar "Billing" and "Settings" (client plane).
**Backend:** `billingRoutes.ts` (full CRUD/subscription/invoice surface — not yet touched by any phase, read it fresh), `costRoutes.ts` budget endpoints (`GET/PUT /cost/budget`, `POST /cost/budget/reset-circuit` — already known from Phase 1 research).
**Build:** Billing: plan, subscription status, invoices, budget policy view/edit (the `PUT /cost/budget` and reset-circuit actions are real state changes — confirm/friction pattern again, per CLAUDE.md §15). Settings: whatever tenant-level config is actually editable via `tenantRoutes.ts`/`orgRoutes.ts` — likely small (name, branding placeholder) at this stage; don't build settings sections for config that has no backing route.

---

## Phase 10 — Platform: Tenant Management

**Unlocks:** Sidebar "Tenants" (`/platform/tenants`, `/platform/tenants/:id`).
**Backend:** `adminRoutes.ts` (already used for the tenant list in Phase 1's Platform Overview — now the full page): `POST /admin/tenants/provision`, `PUT /admin/tenants/:id/status`.
**Build:** Full tenant list (reuse `DataTable`) with filtering; detail view; **provisioning and status-change (suspend/reactivate) are real, consequential, cross-tenant actions** — confirm-before-execute UI, and remember §0.2: these are exactly the actions where the RBAC-gap caveat matters most. Consider surfacing a visible "you are relying on `system:admin`, which any tenant owner can currently hold" note in an admin-only diagnostics area rather than hiding the gap.

---

## Phase 11 — Platform: Agent Fleet + Model Provider Health

**Unlocks:** Sidebar "Agent Fleet", "Model Health".
**Backend:** `adminRoutes.ts`'s fleet endpoints (already used for the summary card — now the full node list from `FleetDiagnosticsSummary.nodes: NodeFleetRecord[]`, already typed in `src/admin/types/adminTypes.ts`), `modelResilienceRoutes.ts` (fully unexplored — grep fresh) for provider/model health, latency, fallback status.
**Build:** Node-level fleet table; model provider status cards/table matching whatever `modelResilienceRoutes.ts` actually tracks (availability, latency, error rate, fallback state — per CLAUDE.md §23, never expose provider secrets/credentials in any response field you render).

---

## Phase 12 — Platform: Security Center + Audit

**Unlocks:** Sidebar "Security", "Audit".
**Backend:** `securityHardeningRoutes.ts`, `governanceRoutes.ts` (RBAC/audit), `adminRoutes.ts`'s `GET /admin/audit-logs` (confirmed real from Phase 1 research, unused so far).
**Build:** Audit log table (paginated via the real `limit` param already confirmed on that route), security events/policy-violation feed from whatever `securityHardeningRoutes.ts`/`governanceRoutes.ts` expose. This is explicitly an "operational, not decorative" page per the original spec — every row must trace to a real event, no synthetic "security score" gauge unless a real scoring endpoint exists.

---

## Phase 13 — Platform: Billing/Cost (platform-wide)

**Unlocks:** Sidebar "Billing" (platform plane).
**Backend:** Re-examine whether `billingRoutes.ts`/`costRoutes.ts` expose anything cross-tenant, or whether this page is necessarily built by aggregating per-tenant data via `adminRoutes.ts`'s tenant list + N calls (expensive — flag if so, this might need a real backend aggregate endpoint added, which would be the first genuine "we need a new backend route" moment in this whole plan; if so, follow CLAUDE.md §34's minimal-change backend rule and get it reviewed, don't just add it silently).

---

## Phase 14 — Command Palette + Global Search

**Unlocks:** Cmd/Ctrl+K palette, cross-entity search bar in `TopBar`.
**Backend:** Whatever list endpoints already exist per entity (customers, agents, tenants, workflows — all built by Phase 13). **No dedicated search endpoint has been confirmed to exist.** Feasibility check first: if there's no `/search` style endpoint, either build a client-side fan-out (call each entity's list endpoint with a query param if supported, merge results) or scope this down to "jump to a known route" (no fuzzy cross-entity search) rather than faking search results.
**Build:** Keyboard shortcut wiring, a simple modal, results grouped by entity type, each result a real link to a real page built in an earlier phase (don't link to anything not yet built).

---

## Phase 15 — Responsive + Accessibility (WCAG 2.1 AA)

**Scope:** Cross-cutting pass over every page built in Phases 2–14, not a new page.
**Build:**
- Responsive: verify/fix at the breakpoints named in the original spec (320/375/390/768/1024/1280/1440/1920) for every page — the `Sidebar`/`AppShell` layout will need a collapsible/drawer mode below ~1024px; this is the first phase that touches `AppShell.tsx` again after Phase 1.
- Accessibility: add real tooling — `axe-core` (or equivalent) wired into the `web/` test setup, run against every page; fix real violations (contrast, focus order, form labels, table semantics) rather than adding decorative `aria-*` attributes that don't reflect real structure. `Sidebar`'s disabled "Soon" items need `aria-disabled`, not just visual greying — check that now.
**Definition of Done addition:** an automated a11y check (not just manual) passes for every page in the app, and is wired to run as part of `npm test` going forward.

---

## Phase 16 — Performance + E2E Test Suite

**Scope:** Cross-cutting.
**Build:**
- Code splitting per route (`React.lazy` + `Suspense` per top-level page — cheap with the existing router structure, do this before the app grows past ~15 pages, not after).
- Virtualization for any `DataTable` usage that's grown past a few hundred rows in practice (check real data volumes from the phases above before adding a virtualization library — don't add one speculatively per §0.3).
- A real Playwright E2E suite covering the golden paths named in the original master prompt §39 (login→client dashboard, login→platform dashboard, client→customer, client→agent, etc.) — now that enough real pages exist to make E2E worth the setup cost (Phase 1 explicitly deferred this for the same reason).

---

## Phase 17 — Retire the legacy `/admin` page + Final Certification

**Precondition:** every nav item in both `Sidebar.tsx` arrays is a real page (i.e., Phases 2–14 complete).
**Build:**
- Confirm feature parity: everything the old `src/admin/ui/dashboardHtml.ts` mock page claimed to show is now real and live in `web/`.
- Remove `adminUiRoutes.ts`'s registration (or redirect `/admin` → the new app) — this is the one phase allowed to touch backend route registration, and only to *remove* a route, not change behavior of any other one.
- Correct the overclaiming docs flagged back in Phase 1 (`docs/plans/task.md`, `docs/certification/POST_ROADMAP_VERIFICATION.md`) so they reflect the new frontend's real state instead of the old mock's inflated "100% certified" claim.
- Write `docs/ui/XYLARC_UI_REDESIGN_CERTIFICATION.md` per the original master prompt §50 template (old UI problems, new design system, per-plane changes, component changes, responsive/a11y/performance changes, backend contracts preserved, test results, E2E results, known limitations) — using real numbers from the phases actually completed, not the aspirational full scope of the original prompt.

---

## Sequencing notes

- Phases 2–9 (client plane) and 10–13 (platform plane) are independent of each other and can be reordered or interleaved based on which plane matters more first — they only share the design tokens and shell components from Phase 1.
- Phase 14 depends on enough entity pages existing to search across (practically: after Phase 9 or later).
- Phase 15 and 16 should run after most pages exist, not per-page, or they'll be redone repeatedly.
- Phase 17 is last by construction.
- Every phase is independently sized to roughly Phase 1's effort (one real backend domain, one or two pages, full verification loop) — don't batch multiple phases into one implementation pass without redoing the Definition of Done for each.
