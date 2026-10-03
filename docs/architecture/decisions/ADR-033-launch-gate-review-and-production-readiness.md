# ADR-033: Launch Gate Review and Production Readiness Verification Protocol

## Status
Accepted

## Date
2026-10-03

## Context
Kriya Omnitask operates under the core engineering thesis: *"Verified action. AI that acts, and proves it acted right."* As the platform prepares for real commercial tenant onboarding, every critical subsystem must undergo rigorous, objective, and automated verification.

Conventional release sign-offs often rely on manual checklists, self-reported metrics, and subjective claims ("it worked on staging"). Such approaches fail to protect tenants against silent regression, misconfiguration in production mode, unvetted failover paths, or unmeasured accuracy claims.

Work Package WP-8.6 establishes a deterministic, automated, and cryptographically verifiable Launch Gate Review Engine that validates all 10 non-negotiable launch criteria before the first real customer workflow executes.

## Decision

1. **Automated Launch Gate Engine (`LaunchGateReviewEngine`)**:
   Implement an automated reviewer evaluating all 10 launch criteria with executable tests and live telemetry:
   - **G1 (No Simulated Adapters)**: Rigorously verifies that all mock/simulated adapters (`DeterministicHashEmbeddingAdapter`, `HermeticMockBrowserDriver`, and `sandboxOnly` tool wrappers) throw `PolicyViolationError` and refuse execution when `APP_MODE=production`.
   - **G2 (PostgreSQL & PITR Verified)**: Enforces PostgreSQL as mandatory production relational driver and validates cryptographic SHA-256 Point-In-Time Recovery restore drills.
   - **G3 (Consequential Action Chain)**: Validates that every consequential tool path enforces the 5-stage pipeline: Policy $\to$ Mandate $\to$ Tool $\to$ Verify $\to$ Proof.
   - **G4 (Multi-Provider Fallback)**: Proves that $\ge 2$ approved model providers (OpenRouter, Gemini, OpenAI, Anthropic) are active with automatic fallback routing.
   - **G5 (WhatsApp & Payment Test Mode)**: Validates HMAC-SHA256 signature verification for WhatsApp Cloud API and payment gateway link lifecycle end-to-end.
   - **G6 (Golden Eval Honesty)**: Executes golden benchmark evaluation suites across all 5 workforce agents (`intake`, `scheduling`, `payments`, `document`, `attention`). Enforces S53 zero-fabrication: unmeasured tiers explicitly report `measured: false, rate: null`, and measured tiers report measured rates per risk tier ($T_0, T_1, T_2, T_3$).
   - **G7 (Tenant Isolation Verified)**: Verifies relational tenant boundary enforcement; executing outside active `TenantContext` throws `TenantIsolationError`.
   - **G8 (Four-Level Kill Switches)**: Validates operational halt capability across Global, Tenant, Agent, and Tool scopes.
   - **G9 (One-Step Instant Rollback)**: Proves zero-delay canary traffic retraction to 0%, automated P1 Human Attention incident creation, and signed rollback proof receipts.
   - **G10 (Zero Unsupported Superlatives)**: Verifies that UI copy, marketing copy, and documentation avoid uncertified superlatives (no unqualified "100%", no uncertified "compliant", no "infinitely scalable").

2. **Cryptographic Proof Receipt Issuance (`launch.gate_review`)**:
   Every launch review evaluation hashes the canonical check results with SHA-256, generates an Ed25519 digital signature, and issues a non-repudiable Proof Receipt (`rcpt_*`) linked to the append-only cryptographic ledger.

3. **Durable Review Audit Persistence (Migration 058)**:
   Create `launch_gate_reviews` relational table to record all historic reviews, signed payload hashes, evaluated metrics, and reviewer identity.

4. **REST API Interface (`/api/v1/deployment/launch-gate/*`)**:
   Provide operational visibility via authenticated endpoints:
   - `POST /api/v1/deployment/launch-gate/evaluate`: On-demand gate evaluation (operator only).
   - `GET /api/v1/deployment/launch-gate/status`: Read-only current launch readiness status.
   - `GET /api/v1/deployment/launch-gate/reviews`: List historic reviews.
   - `GET /api/v1/deployment/launch-gate/reviews/:reviewId`: Inspect specific signed review.

## Consequences

### Positive
- **Deterministic Production Gate**: Eradicates human error and guesswork in launch readiness.
- **Fail-Fast Defense**: Prevents any inadvertent boot with test adapters in production mode.
- **Honest Metrics**: Ensures published action rates reflect true measured benchmarks with risk tier breakdown.
- **Auditable & Tamper-Proof**: Cryptographic receipts provide permanent proof of compliance.

### Negative / Trade-offs
- Production evaluation requires all 10 gates to pass; any failing gate halts deployment.
- Initial evaluation incurs execution overhead for provider health checks and isolation tests.
