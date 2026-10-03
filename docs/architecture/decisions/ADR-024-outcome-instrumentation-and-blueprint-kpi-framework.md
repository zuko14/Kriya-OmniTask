# ADR-024 — Outcome Instrumentation & Blueprint KPI Framework

**Status:** Accepted · 2026-10-02 · Session 23 (WP-6.1, decision D24)

## Context
Traditional AI platforms report ungrounded proxy metrics (total tokens consumed, conversation count, raw API calls) or default "perfect" scores (e.g. 1.0 confidence or 100% success) when no evidence exists.
Per the Kriya AI 2040 Master Strategy Blueprint (§14, §05) and `CLAUDE.md §35`, the north star of Kriya Omnitask is **Verified Autonomous Business Outcomes — not conversation count**.
To measure genuine operational value, substantiate commercial ROI, enforce safety error budgets (WP-6.3), and power the upcoming **Cost per Outcome** console screen (WP-7.5), the platform requires an authoritative, evidence-backed outcome instrumentation engine with zero-fabrication guarantees.

## Decision
1. **Blueprint Core KPI Framework (`src/outcomes/types/outcomeKpiTypes.ts`)**:
   - Implemented 6 core operational metrics with complete metadata per `CLAUDE.md §39` (source, calculation, window, target range, drill-downs):
     1. **`verified_action_rate`**: Proportion of executed consequential actions (`T2`/`T3`) validated by target read-backs or signed Ed25519 proof receipts.
     2. **`resolution_rate`**: Proportion of workflow runs and customer interactions resolved without human takeover or unhandled errors.
     3. **`tool_call_reliability`**: Proportion of tool invocation attempts succeeding without timeouts or failures.
     4. **`recovery_rate`**: Proportion of initially degraded, retried, or compensated tasks that ultimately recover to completion.
     5. **`escalation_rate`**: Proportion of runs requiring human intervention via the Attention Center (lower is better).
     6. **`cost_per_verified_outcome`**: Total spend (tokens, voice, compute, tools) divided by verified outcomes achieved.
2. **Zero-Fabrication Honest Baseline Guarantee (S53 Rule)**:
   - When a tenant has zero samples/events in the evaluated window, `actualValue` returns `null` and status returns `'unmeasured'`.
   - Never fabricates default 1.0 or 100% scores when unmeasured.
3. **Cost Cascade (L0–L3) Analysis & Deflection Rate**:
   - Migration `051_outcome_kpi_instrumentation_schema.sql` creates `cascade_execution_events` to log execution levels:
     `L0_rule` ($0 regex/heuristics), `L1_cache` ($0 tenant cache), `L2_fast_model` (cheap/fast models), `L3_reasoning_model` (frontier reasoning), `human_review`.
   - Computes `l0L1DeflectionRate` (% resolved without LLM inference costs) and estimated USD savings compared to a 100% L3 baseline.
4. **Client Value Report & Net ROI Multiplier**:
   - Aggregates tasks completed, verified outcomes, revenue influenced, and human hours avoided (using standard task benchmarks: 15 min intake, 20 min booking, 30 min leave/refund).
   - Computes net ROI multiplier: `(revenue + labor_value) / total_cost`.
5. **Multi-Tenant REST API & Dedicated WP-7.5 Support (`src/api/routes/outcomeRoutes.ts`)**:
   - `GET /api/v1/outcomes/kpis`: Complete Blueprint KPI Overview with filter parameters.
   - `GET /api/v1/outcomes/cost-per-outcome`: Dedicated contract for WP-7.5 "Cost per Outcome" console screen (breakdown by workflow, agent, model, and cascade mix).
   - `GET /api/v1/outcomes/client-value-report`: Client Value Report with ROI and hours avoided.
   - `POST /api/v1/outcomes/cascade-event`: Telemetry ingestion for cascade events.

## Consequences
- Every published performance metric is traceable to ground-truth evidence in `proof_receipts`, `graph_runs`, `tool_executions`, `attention_items`, and `cost_attribution_records`.
- Fully satisfies prerequisites for WP-6.3 (error-budget autonomy throttling) and the WP-7.5 "Cost per Outcome" console screen.
- Guarantees strict multi-tenant isolation with zero cross-tenant metric leakage.
