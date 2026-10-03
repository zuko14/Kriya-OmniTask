# Kriya OmniTask

> **“Verified action. AI that acts, and proves it acted right.”**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-v22%20LTS-green.svg)](https://nodejs.org/)
[![Fastify](https://img.shields.io/badge/Fastify-5.x-black.svg)](https://fastify.dev/)
[![React](https://img.shields.io/badge/React-18.x-blue.svg)](https://react.dev/)
[![Vitest](https://img.shields.io/badge/Vitest-626%20Suites%20Passed-brightgreen.svg)](https://vitest.dev/)
[![License](https://img.shields.io/badge/License-Proprietary-red.svg)](#)

**Kriya OmniTask** is an enterprise-grade **Autonomous Operations Runtime** developed by **Kriya AI**. It transitions organizations from unverified chat loops to a deterministic, multi-agent digital workforce capable of executing real business operations with end-to-end cryptographic proof, multi-tenant isolation, and India DPDP 2023 compliance.

---

## 🏛️ Core Architecture Principles

1. **Deterministic Consequential Action Chain**: Every state-changing tool call strictly executes across a 5-stage pipeline:
   $$\text{Policy} \longrightarrow \text{Mandate} \longrightarrow \text{Tool Execution} \longrightarrow \text{Read-Back Verify} \longrightarrow \text{Cryptographic Proof}$$
2. **Four-Tier Risk Model**:
   - **$T_0$ READ_ONLY / INFORMATIONAL**: Autonomous retrieval, zero state modification.
   - **$T_1$ REVERSIBLE**: Autonomous execution with automated saga compensation.
   - **$T_2$ MEDIUM RISK / FINANCIAL**: Autonomous execution bounded by Mandate financial caps; excess parks at human gate.
   - **$T_3$ HIGH RISK / IRREVERSIBLE**: Strictly halts at human gate; requires human approval before execution.
3. **Cryptographic Non-Repudiation**: Every consequential action issues an Ed25519 digital signature and SHA-256 hash receipt (`ProofReceipt`) verifiable offline.
4. **Zero-Fabrication Metrics (S53 Guard)**: Mathematical KPIs (verified-action rate, resolution rate, recovery rate) return `unmeasured: true` and `null` when sample count is zero. Synthetic success metrics are banned.
5. **India Sovereign Hosting & DPDP 2023**: Hard boundary governance locking data residency to `ap-south-1` (Mumbai) and `ap-south-2` (Hyderabad), purpose-bound consent ledger, 72h SAR grievance engine, and irreversible SHA-256 tombstone cryptographic erasure.

---

## 🤖 The Autonomous Workforce Fleet

| Agent | Purpose | Autonomy Cap | Key Capabilities |
| :--- | :--- | :---: | :--- |
| **Intake / Concierge** | Omnichannel customer conversation | $T_1$ | L0–L3 intent cascade, WhatsApp webhook, Customer 360 trace |
| **Scheduling** | Calendar & booking system of record | $T_2$ | Slot hold reservations, double-booking prevention, 2-way Google Calendar sync |
| **Payments & Mandate** | Invoicing, holds & settlement | $T_2$ | Razorpay/Stripe HMAC verification, pre-payment holds, auto-refunds under cap |
| **Document (Lens)** | Zero-retention document parsing | $T_1$ | Deterministic L0 regex + OCR, zero-retention SHA-256 storage |
| **Attention & Verification** | Human-in-the-loop & read-backs | $T_3$ | Priority routing matrix, P0 emergency bypass, async read-back verification |

---

## 🛠️ Technology Stack

- **Backend Runtime**: Node.js 22 LTS (ESM Native) / TypeScript 5.x
- **API Framework**: Fastify 5.x with JSON Schema validation
- **Persistence**: PostgreSQL 16 + pgvector (Production) / SQLite In-Memory (Sandbox/Testing)
- **Model Gateway**: Consolidated gateway with OpenRouter primary, automated fallback across $\ge 2$ providers, pre-call budget checks, and post-call cost attribution
- **Distributed Queues**: Transactional Postgres queue (`SELECT ... FOR UPDATE SKIP LOCKED`) with worker lease locking and DLQ resuscitation
- **Frontend Console**: React 18 / Vite SPA with custom Kriya Design System tokens (dark + light theme, WCAG AA compliant)
- **Observability**: Zero-dependency Prometheus `/metrics`, W3C distributed tracing (`traceparent`), and multi-window SLO burn alerting ($14.4\times, 6.0\times, 3.0\times$)

---

## 🚀 Quick Start

### 1. Prerequisites
- Node.js 22 LTS or higher
- npm 10 or higher
- PostgreSQL 16 with `pgvector` (for production mode)

### 2. Installation
```bash
# Clone the repository
git clone https://github.com/zuko14/Kriya-OmniTask.git
cd Kriya-OmniTask

# Install monorepo dependencies (Backend + Web workspace)
npm install
```

### 3. Environment Configuration
Copy `.env.example` and populate your environment keys:
```bash
cp .env.example .env
```

### 4. Verification & Testing
```bash
# Static TypeScript typecheck across backend and web (0 errors)
npm run typecheck
npm --prefix web run typecheck

# Full Vitest test suites (626 suites / 1,136 tests)
npm test
npm --prefix web run test

# Run deterministic Evals-as-CI golden regression gate
npm run evals:ci
```

### 5. Production Build
```bash
# Compile backend TypeScript and copy SQL migrations to dist/
npm run build

# Build web frontend Vite bundle
npm --prefix web run build
```

### 6. Container Deployment (Docker Compose)
```bash
docker compose up -d --build
```

---

## 🔐 Launch Gate Verification (WP-8.6)

Kriya Omnitask includes an automated, self-evaluating **Launch Gate Review Engine** validating all 10 production criteria before release:
1. `G1_NO_SIMULATED_ADAPTERS`: Hard runtime refusal of mock adapters when `APP_MODE=production`.
2. `G2_POSTGRES_PITR_VERIFIED`: PostgreSQL required with SHA-256 point-in-time recovery restore verified.
3. `G3_CONSEQUENTIAL_ACTION_CHAIN`: Strict Policy $\to$ Mandate $\to$ Tool $\to$ Verify $\to$ Proof enforcement.
4. `G4_MODEL_PROVIDER_FALLBACK`: Dynamic fallback across $\ge 2$ model providers verified.
5. `G5_WHATSAPP_PAYMENT_TESTMODE`: HMAC-SHA256 signature verification & payment gateway testmode verified.
6. `G6_GOLDEN_EVAL_HONESTY`: 100% pass across all 5 workforce golden eval suites with zero safety breaches.
7. `G7_TENANT_ISOLATION_VERIFIED`: Relational tenant boundary enforced; outside-context calls throw `TenantIsolationError`.
8. `G8_KILL_SWITCHES_OPERATIONAL`: Operational kill switches active across Global, Tenant, Agent, and Tool scopes.
9. `G9_ROLLBACK_REHEARSED`: Instant rollback to 0% canary traffic rehearsed with Ed25519 proof receipts.
10. `G10_NO_SUPERLATIVES_COPY`: Repository copy audit verified zero unmeasured superlatives.

---

## 📄 License

Proprietary. Copyright © 2026 Kriya AI. All rights reserved.
