# 05 — Removals, Consolidation & Freezes

Blueprint principle: *"Build what decides, authorises, proves, or encodes domain knowledge.
Integrate what talks and clicks."* and *"Every extra agent is extra failure surface."*

**Rule for every row below:** before deleting, prove there are no callers
(`grep -r "<symbol>" src web/src tests`), then run typecheck + all tests. Record the deletion in
the session log in `00_STATUS.md`. Freeze means: no new features, bug fixes only, until the stated gate.

## 1. Delete (after migration)

| Item | Why | Replaced by | WP |
|---|---|---|---|
| `src/orchestration/routing/modelRouter.ts` (incl. `DeterministicLLMAdapter`) | Router #1 of 3; default adapter fabricates success | Model Gateway; the deterministic adapter moves to `tests/fixtures` | WP-1.1 |
| `src/model/resilience/router/dynamicModelRouter.ts` | Router #2 of 3 | Model Gateway (fallback logic folded in) | WP-1.1 |
| Fake classes in `src/model/resilience/adapters/modelProviderAdapter.ts` | Return template strings | Real `AnthropicAdapter`, `OpenAICompatibleAdapter` | WP-1.2 |
| `classifyTargetAgentSlug` (keyword router) | `"book"` → booking is not intent understanding | Cascade intent node | WP-2.7 |
| `src/tools/circuit/circuitBreaker.ts` **or** `src/reliability/circuit/bulkheadCircuitBreaker.ts` | Two breakers for one job; keep the bulkhead variant unless callers prove otherwise | One breaker | WP-3.6 |
| `src/workforce/specialists/*` | Hardcoded keyword scoring, no model/tools/verification | Phase-0 agent charters | WP-4.2-4.6 |
| `src/admin/ui/*` + `src/api/routes/adminUiRoutes.ts` | Legacy server-rendered admin duplicating the React console | React consoles | WP-7.6 — **REMOVED 2026-10-02 (S-UI-06)**: no remaining importers (grep), backend tsc 0, `/admin*` → 404 test |
| Fabricated-ID demo tools in `src/tools/registry/toolRegistry.ts` | Invent external IDs | Real connectors; sandbox-only demo tools | WP-0.2, WP-5.x |
| Hash-projection embeddings as a production path | Not semantic | Provider embeddings + pgvector (hash version kept for tests) | WP-5.8 |

## 2. Move out of the production path

| Item | Why | Action |
|---|---|---|
| `src/hardening/chaos/*`, `src/hardening/stress/*` | Fault injection must never run in production | Load only when `APP_MODE` ∈ {staging, test} (WP-8.4) |
| `src/simulation/*` | Valuable (dry-run, CLAUDE.md §17) but sandbox-only | Hard-isolated to sandbox mode; it may never call real connectors (WP-0.3) |

## 3. Freeze (keep code, stop building) until the gate

| Module | Gate to unfreeze | Reason |
|---|---|---|
| `src/adaptation` (governed adaptation) | WP-6.1 outcome data exists | Learning needs measured outcomes first (blueprint §05) |
| `src/bi` predictive parts, forecasting | 3+ months of real tenant outcome data | Predictions without data are fabrication |
| Agent marketplace / extra agent templates beyond the 5 | Phase 0 exit criteria (8 paying tenants) | Don't over-agent |
| `src/digitaltwin` beyond the state/relationship store | Phase 1 (claims/employer packs) | Knowledge graph hooks only for now |
| Voice (WP-5.6) | M4 done + partner chosen + per-language benchmark | Text paths must be verified first |
| Industry packs other than Health | Blueprint pack gate: 3 paying design partners signed | Configuration, not code; build on demand |

## 4. Not building (blueprint says avoid)

- Retail / e-commerce / D2C / hospitality / travel packs: Meta Business Agent's home turf (blueprint §09).
- Generic "AI chatbot on WhatsApp": banned on the WhatsApp Business API from 15 Jan 2026; purpose-bound flows only.
- Our own foundation models, OCR models, voice models, RPA: integrate (blueprint §28).
- Per-seat or per-agent pricing logic in billing (blueprint §18). Billing meters verified actions / cases.

## 5. Documentation removals

Move to `docs/archive/xylarc/` with a "superseded" header (WP-0.5):
`docs/implementation/EXECUTION_STATE.md`, `docs/implementation/progress.md`, `docs/ui/XYLARC_*`,
`docs/certification/*`, `docs/plans/task.md`. Keep `docs/verification/FINAL_PRODUCTION_READINESS_REPORT.md`
(honest audit) and `docs/architecture/decisions/*` (ADRs stay valid unless superseded by a new ADR).
