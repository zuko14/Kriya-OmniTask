# ADR-026: Error-Budget Autonomy Throttling, Tripwires & Human Restoration Governance

## Status
**ACCEPTED** (2026-10-02, WP-6.3 / Session 26)

## Context
Deploying enterprise agent workforce systems into consequential production environments (e.g. healthcare bookings, financial refunds, prescription extraction) requires dynamic autonomy boundaries. Previously:
1. **Static Autonomy Caps**: Agents were bounded only by static risk caps declared in their charter (e.g. $T_2$ for Payments). If verification checks detected repeated read-back mismatches, corrupted ledger state, or gateway failures, the agent continued autonomous execution until manually disabled.
2. **Missing Consequential Feedback Loop**: While WP-6.1 instrumented outcome metrics and verified-action rates, there was no automated control loop linking measured outcome quality back into the agent runtime.
3. **S53 Rule (Zero-Fabrication Honest Baselines)**: A system with zero recorded actions must honestly report `unmeasured` status and `null` error rates—never fabricated default perfection (100% or 1.0).
4. **Governance Restoration Gap**: Restoring an agent after degraded performance must follow strict human-in-the-loop governance: autonomy must never self-heal silently on live traffic without accountable operator review and optional golden eval verification.

## Decision

### 1. Mathematical Error Budget & SLA Targets per Risk Tier (CLAUDE.md §15, §37)
We establish formal SLA targets and allowed error budgets derived directly from the risk tier hierarchy:
- **$T_0$ (Inform / Read-only)**: $100\%$ SLA target ($0.0\%$ allowed error budget).
- **$T_1$ (Reversible / Low-consequence)**: $95.0\%$ SLA target ($5.0\%$ allowed error budget).
- **$T_2$ (Consequential / Pre-approved within Mandate)**: $99.0\%$ SLA target ($1.0\%$ allowed error budget).
- **$T_3$ (Irreversible / Critical)**: $99.9\%$ SLA target ($0.1\%$ allowed error budget).

Budget burn rate is calculated over a rolling window ($24$ hours by default):
$$\text{Burned Budget } \% = \frac{\text{Current Error Rate}}{\text{Allowed Error Budget}} \times 100$$
When sample count is $0$, the engine reports `unmeasured: true`, `verifiedActionRate: null`, and `isThrottled: false`, strictly adhering to the S53 honesty mandate.

### 2. Automated Step-Down Throttling & Immediate Tripwires
An agent's autonomy steps down deterministically ($T_3 \to T_2 \to T_1 \to T_0$) under either of two conditions:
1. **Budget Burnout**: When sample count $\ge 3$ and burned error budget $\ge 100\%$ (e.g. an error rate of $5\%$ against a $1\%$ budget is $500\%$ burned).
2. **Consecutive Verification Failure Tripwire**: When an agent suffers $\ge 2$ consecutive read-back verification failures or critical tool errors, the tripwire triggers immediately regardless of total sample size.
3. **Audited Warning**: When burn rate reaches $\ge 75\%$ without breaching $100\%$, an audited `budget_warning` event is logged to alert operators prior to step-down.

### 3. Attention Center Escalation with Deterministic Role Routing
Upon throttling:
- A `P1_HIGH` attention exception is immediately filed in the Attention Center under category `policy_violation`.
- Routing deterministically targets the charter's accountable human owner (`assignedRole = charter.owner`, e.g. `billing_manager` for Payments, `clinic_manager` for Scheduling), with full evidence context (burned budget percentage, sample count, failure count, and tripwire reason).

### 4. Runtime Graph & Loop Spec Gate Enforcement
When an agent's effective tier is throttled (e.g. from $T_2$ to $T_1$):
- In `charterToLoopSpec(charter, registry, effectiveTierCap)`: Any tool whose tier exceeds the effective cap receives `requireApproval: true`.
- In `src/runtime/graph/agentLoop.ts`:
  - Tools with `requireApproval: true` route through their Mandate node directly to `human_gate` (`${tool.slug}__approval`), skipping autonomous tool execution.
  - The workflow execution halts and transitions into `status: 'parked'`, awaiting human review and approval.
  - Even if a model proposes a consequential action under an active financial Mandate, autonomy refusal prevents autonomous execution.

### 5. Human-in-the-Loop Restoration Protocol
Autonomy **never** self-restores on live traffic:
- Restoration requires an authenticated human operator with `agent:write` permission.
- The request requires a non-trivial justification reason ($\ge 5$ characters) explaining the human investigation and resolution.
- **Optional Golden Suite Re-verification (`verifyFirst: true`)**: Integrates with WP-6.2 Evals-as-CI (`EvalsAsCiService.evaluateAgentSuite`). The agent's golden test suite is executed, and autonomy is restored only if verdict is `release_approved` with $0$ critical safety breaches.
- Every restoration logs an immutable audit event in `agent_autonomy_events` recording the actor, timestamp, justification, and from/to tiers.

### 6. Storage Schema (Migration 053)
- `agent_error_budgets`: Maintains per-tenant, per-agent current state, SLA target, error budget, burn rate, sample count, failure count, consecutive failures, throttled/restored timestamps, and actors.
- `agent_autonomy_events`: Append-only immutable audit trail capturing every state change (`throttled`, `budget_warning`, `restored`) with evidence payloads.

### 7. REST API Endpoints (`/api/v1/autonomy/*`)
- `GET /api/v1/autonomy/status`: Lists all error budgets and throttle states for the authenticated tenant.
- `GET /api/v1/autonomy/status/:agentSlug`: Returns error budget and throttle status for a specific agent.
- `POST /api/v1/autonomy/evaluate`: Triggers error budget evaluation for a single agent or the full tenant fleet.
- `POST /api/v1/autonomy/restore`: Authorizes human restoration of throttled autonomy with mandatory justification and optional golden suite re-check.
- `GET /api/v1/autonomy/events`: Paginated audit log of autonomy transitions.

## Consequences
- **Positive**: Prevents cascading autonomous failures in production; closes the loop between outcome instrumentation and runtime execution; strictly enforces human review before restoring elevated autonomy; zero-fabrication S53 compliant.
- **Negative / Operational**: High failure spikes during third-party gateway downtime will step down agents to `human_gate`, requiring human managers to approve actions or execute restoration after upstream connectivity is resolved.
