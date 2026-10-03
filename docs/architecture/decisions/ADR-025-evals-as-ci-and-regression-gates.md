# ADR-025: Evals-as-CI, Model-Swap Regression Gating & Multi-Trial Pass^k Consistency

## Status
**ACCEPTED** (2026-10-02, WP-6.2 / Session 25)

## Context
Deploying autonomous business agents to enterprise production environments requires continuous, deterministic quality guarantees. Previously:
1. **Model Swaps & Charter Changes**: When a tenant or operator switched models (e.g. OpenRouter DeepSeek $\to$ Gemini $\to$ Claude) or updated an agent charter, there was no automated gate blocking deployment if subtle regressions occurred in triage, tool invocation, or emergency handling.
2. **S24 (Lexical Faithfulness Penalty)**: The faithfulness grader (`QualityReviewer` / `DriftDetector`) previously used pure bag-of-words token overlap for words $>3$ characters. This unfairly penalized valid, polite paraphrasing (e.g. conversational greetings and natural syntactic reordering) even when all factual assertions were 100% grounded.
3. **S27 (Stochastic Certification Noise & Conflated Errors)**: Single-run probe evaluations were susceptible to stochastic variance. Furthermore, transient provider errors (HTTP 429 rate limits, 500/502/503/504 gateways, connection resets) were conflated with cognitive reasoning failures, causing models to be marked incapable when the issue was network-level infrastructure.

## Decision

### 1. Deterministic Golden Evaluation Suites per Agent (`src/evaluation/ci/suites/`)
We implement curated deterministic golden test sets covering all Phase 0 agents:
- **Intake / Concierge Agent (`INTAKE_GOLDEN_SUITE`)**: 32 test cases spanning clinical triage, Indic languages (Hindi, Telugu, Tamil), code-mixed Hinglish and Tenglish, adversarial prompt injections, and P0 medical emergencies.
- **Scheduling Agent (`SCHEDULING_GOLDEN_SUITE`)**: 30 test cases scored deterministically on the appointment book's state (doctor matching, earliest slot, time window, double-booking conflict rejection, working hours, cancellations, reschedule, and cross-customer security isolation).
- **Payments & Mandates Agent (`PAYMENTS_GOLDEN_SUITE`)**: 7 test cases evaluating consultation fee link generation, slot holds, mandate auto-approvals (T2 under limit), over-mandate human gate parking (T3 over limit), duplicate webhook idempotency, and forged HMAC signature rejection.
- **Document Agent (`DOCUMENT_GOLDEN_SUITE`)**: 5 test cases evaluating prescription extraction, billing invoice parsing, low-confidence fail-closed attention routing, and strict zero-retention SHA-256 hash storage (raw bytes and text dropped in memory).
- **Attention Agent (`ATTENTION_GOLDEN_SUITE`)**: 5 test cases evaluating P0 emergency 0-delay bypass to on-call duty doctors, branch hours routing, escalate-once idempotency, and cross-tenant queue isolation.

### 2. Regression Gating Rules (§14, §18 of CLAUDE.md)
When evaluating a proposed model swap (`evaluateModelSwap`) or agent charter update (`evaluateCharterUpdate`):
- **Rule 1 (Zero Critical Safety Breaches)**: Any failure on a test case marked `isCriticalSafety: true` (medical emergencies, adversarial jailbreaks, cross-customer PII/booking tampering, un-mandated financial actions) immediately triggers `verdict: 'release_blocked_regression'` and blocks deployment.
- **Rule 2 (Non-Regression Threshold)**: The candidate pass rate must satisfy the target pass rate ($\ge 90\%$ production, $\ge 80\%$ staging) and cannot regress below the baseline model's pass rate by $> 1\%$.
- **Rule 3 (Autonomy & Tool Fidelity)**: Invocation of forbidden tools or omission of mandatory tools results in test case failure and gating rejection.
- **Rule 4 (Parity Approval)**: Candidate is marked `release_approved` only if parity or improvement is demonstrated with zero safety breaches.

### 3. S24 Claim-Level Grounding & Paraphrase Tolerance
In `DriftDetector.evaluateGrounding` and `QualityReviewer.evaluate`:
- Numerical values, currencies (e.g. `500 rupees`, `$199`), dates, times, and proper nouns are extracted as explicit factual claims.
- Conversational framing and politeness discourse markers (`glad`, `welcome`, `assist`, `please`, `certainly`, `online`, `booking`, `portal`) are filtered out of factual entity checking.
- Suffix stemming (`sundays` $\leftrightarrow$ `sunday`, `hours` $\leftrightarrow$ `hour`) ensures syntactic parity.
- Outputs with ungrounded prices or invented entities are severely penalized, while accurate conversational paraphrases pass with high faithfulness ($\ge 0.85$–$1.0$).

### 4. S27 Multi-Trial Pass^k Consistency & Error Separation
In `probeSuite.ts` and `EvalsAsCiService.evaluateCase`:
- Repeated trials ($k \ge 1$, default $k=3$ for strict CI) evaluate stochastic consistency.
- Errors are classified into `provider` (HTTP 429, 500, timeout, network failure), `budget` (quota exhaustion), and `reasoning` (wrong answer, invalid JSON, safety breach).
- Transient provider/budget errors are reported separately from model cognitive deficiencies.

### 5. Storage Schema & Auditability (Migration 052)
Table `evaluation_ci_runs` records every CI pipeline execution, model swap gate check, and charter update evaluation with complete baseline/candidate metrics, gate notes, and tenant isolation.

### 6. Pipeline Interfaces
- **CLI Runner**: `npm run evals:ci` (`npx tsx src/evaluation/ci/cli/runCiEvals.ts`) exits with code `0` on approved release, code `1` on regression. Supports `--agent <slug>`, `--strict`, `--trials <k>`, `--swap-from <id> --swap-to <id>`.
- **REST Endpoints**:
  - `POST /api/v1/evaluation/ci/run`
  - `POST /api/v1/evaluation/ci/gate-model-swap`
  - `POST /api/v1/evaluation/ci/gate-charter`
  - `GET /api/v1/evaluation/ci/runs`

## Consequences
- **Positive**: Eliminates risk of silent regression during model upgrades or prompt/charter iterations; unblocks confident model swaps (e.g. moving from OpenRouter to direct Gemini or self-hosted models); resolves S24 and S27; satisfies Milestone M6 WP-6.2.
- **Negative / Operational**: Running large live evaluation suites against external APIs consumes tokens and time; hermetic mode provides instant zero-cost local CI runs while live mode (`describe.skipIf(!process.env.KRIYA_LIVE_TEST_OPENROUTER_KEY)`) is reserved for staging deployment checks.
