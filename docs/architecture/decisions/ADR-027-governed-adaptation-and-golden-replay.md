# ADR-027: Governed Adaptation, Golden Replay Evaluation & Deterministic Canary Routing

## Status
**ACCEPTED** (2026-10-02, WP-6.4 / Session 27)

## Context
In enterprise AI agent workforce platforms, agents must improve their capabilities over time based on operational feedback, failures, and environmental drift. However, autonomous live self-modification presents catastrophic safety risks: prompt injections, capability regressions, hallucinated policy relaxations, or unexpected tool misuse.

Previously:
1. **S21 Audit Finding ("Adaptation simulation scores proposals without running a golden suite")**: The simulation engine evaluated remediation proposals using heuristic mock formulas rather than executing candidate remediations against real agent golden test suites.
2. **Missing Failure Harvester**: Failure signatures were manually ingested or mock-created, with no automated bridge querying verified execution mismatches (`verification_jobs`) or throttled error budgets (`agent_error_budgets`).
3. **No Cryptographic Proof Issuance**: Proposal approval, rejection, and canary promotions/rollbacks lacked Ed25519 proof receipts, failing non-repudiation audit requirements.
4. **No Deterministic Canary Traffic Routing**: Production routing lacked a hash-bucket session router to split traffic deterministically between baseline and candidate canary versions.
5. **No Telemetry Auto-Rollback Loop**: There was no automated mechanism to monitor canary error rate / escalation drift, automatically roll back regressed canary deployments, and escalate P1 alerts to the Attention Center.

## Decision

### 1. Outer Improvement Loop Architecture (§6, §14, §15, §23 of CLAUDE.md; Blueprint §14, §28)
We implement the complete 8-step outer loop with strict safety bounds:
$$\text{HARVEST} \to \text{CLUSTER} \to \text{PROPOSE} \to \text{SIMULATE} \to \text{APPROVE} \to \text{VERSION} \to \text{CANARY} \to \text{PROMOTE / ROLLBACK}$$

Zero live-traffic self-modification is permitted. All updates must be candidate proposals passing sandboxed golden replay, human governance gating, and progressive canary routing.

### 2. Production Replay Evaluator Resolving S21
In `src/adaptation/services/adaptationSimulationEngine.ts`:
- We implement `createProductionReplayEvaluator(ciService)` connecting proposals directly to `ALL_GOLDEN_SUITES` and `EvalsAsCiService`.
- The evaluator loads the candidate agent's actual golden test suite (e.g. 32 test cases for Intake, 30 for Scheduling, 7 for Payments, etc.).
- The proposed candidate changes are sandboxed and evaluated across all golden test cases alongside a simulated reproduction test case.
- **Zero Golden Regressions Policy**: If even a single baseline golden test fails, `goldenSuiteRegressions > 0`, `simulationStatus = 'regressed'`, and human approval is strictly blocked.

### 3. Automated Outcome Failure Harvester
In `src/adaptation/services/failureHarvestingService.ts`:
- Bridges real outcome failures into the adaptation corpus:
  1. **Verification Jobs**: Queries `verification_jobs` where `status IN ('mismatch', 'expired')` within the rolling window (default 7 days). Maps `tool_slug` and `error_message` into `tool_failure` signatures.
  2. **Agent Error Budgets**: Queries `agent_error_budgets` where `is_throttled = 1` or `consecutive_failures >= 2`. Maps throttled states into `model_failure` signatures.
- Clustered deterministically by `FailureClusteringService` (`failureClass::agentSlug::rootCause`), flagging clusters as `candidateReady` when total occurrences reach threshold.

### 4. Strict Candidate Proposal Types & Anti-Drift Bounds
In `src/adaptation/services/remediationProposalService.ts`:
- Allowed typed proposal structures:
  - `new_skill`: Encapsulates model judgment into deterministic, zero-token TypeScript code.
  - `tool_fix`: Modifies tool schema, parameter parsing, or execution timeouts.
  - `policy_tightening`: Adds safety constraints, budget caps, or escalation triggers.
  - `retry_timing`: Adjusts exponential backoff, jitter, or idempotency timeouts.
- **Prohibited Proposals**: Any attempt to generate `rewrite_agent` or open-ended system prompt overhauls is rejected with a validation error, preventing uncontrolled behavioral drift.

### 5. Human Approval Gating & Cryptographic Ed25519 Receipts
In `src/adaptation/services/governedAdaptationService.ts`:
- Proposals cannot be approved without having completed simulation with `simulationStatus = 'passed'` and `goldenSuiteRegressions = 0`.
- **Role-Based Authorization**:
  - `platform` scope proposals require the `owner` role.
  - `tenant` scope proposals require `admin` or `owner` role.
- Upon approval, an immutable version tag (`v_adapt_<type>_<id>`) is stamped, and an Ed25519 `ProofReceipt` is issued (`adaptation.proposal_approved`).
- Explicit human rejections require a justification reason ($\ge 5$ chars) and issue an audit `ProofReceipt` (`adaptation.proposal_rejected`).

### 6. Deterministic Session-Bucket Canary Router
In `src/adaptation/canary/adaptationCanaryRouter.ts`:
- Provides deterministic session-level partitioning:
  $$\text{bucket} = \text{hashSha256}(tenantId + ':' + sessionId + ':' + agentSlug) \pmod{100}$$
- If `bucket < canaryWeightPct`, the session is deterministically routed to the canary candidate version.
- Ensures a user session consistently interacts with either baseline or canary throughout its lifecycle.
- Automatically handles 100% promoted versions and 0% rolled-back versions.

### 7. Telemetry Monitoring, Emergency Rollback & Attention Escalation
- Evaluates live canary performance against baseline across 4 automated tripwires:
  1. **Absolute Error Rate**: Canary error rate $> 5.0\%$.
  2. **Relative Error Drift**: Canary error rate $> 2.0\times$ baseline error rate.
  3. **Escalation Spike**: Canary human escalation rate $> 10.0\%$.
  4. **Latency Degradation**: Canary $P_{95}$ latency $> 2.5\times$ baseline latency.
- Upon breach:
  - Canary status immediately transitions to `rolled_back` with `canaryWeightPct = 0`.
  - An emergency `P1_HIGH` Attention item is filed in the Attention Center (`Automated Canary Rollback: <Title>`) routed to `compliance_officer` / `owner`.
  - A cryptographically signed Ed25519 `ProofReceipt` is issued (`adaptation.canary_rolled_back`).
- When healthy, canary weight advances through progressive tiers: $10\% \to 50\% \to 100\%$ (`promoted`), with a promotion `ProofReceipt`.

### 8. REST API Endpoints (`/api/v1/adaptation/*`)
- `POST /api/v1/adaptation/signatures`: Ingest raw failure signature.
- `GET /api/v1/adaptation/clusters`: Get candidate-ready failure clusters.
- `POST /api/v1/adaptation/harvest`: Trigger automated harvesting from verification jobs and error budgets.
- `POST /api/v1/adaptation/proposals`: Generate typed remediation proposal from cluster.
- `GET /api/v1/adaptation/proposals`: List proposals by status/type.
- `POST /api/v1/adaptation/proposals/:id/simulate`: Run golden test suite replay simulation.
- `POST /api/v1/adaptation/proposals/:id/approve`: Human approval with role check & Ed25519 receipt.
- `POST /api/v1/adaptation/proposals/:id/reject`: Human rejection with reason & Ed25519 receipt.
- `POST /api/v1/adaptation/canary/evaluate`: Evaluate canary telemetry against baseline for auto-rollback/promotion.
- `GET /api/v1/adaptation/canary/status/:agentSlug`: Deterministic session routing check.

## Consequences
- **Audit S21 Resolved**: Simulation is no longer mock math; it executes against active golden test suites.
- **Strict Anti-Drift Safety**: Self-modification is physically constrained to deterministic outer-loop proposals with mandatory human sign-off.
- **Enterprise Accountability**: All lifecycle state transitions (approval, rejection, canary rollback, promotion) are immutably signed with Ed25519 keypairs.
- **Zero Live Disruptions**: Regressions in canary traffic are rolled back automatically with zero operator intervention, alerting the Attention Center in milliseconds.
