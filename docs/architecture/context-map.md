# Xylarc AI — Context Map & Repository Reconnaissance

**Document Version:** 1.0.0  
**Date:** 2026-08-15  
**Author:** Principal AI Systems Architect & Enterprise SaaS Engineering Team  
**Status:** Completed Baseline Reconnaissance  

---

## 1. Repository Overview

The repository is currently at **Greenfield Baseline** with the authoritative constitutional document `CLAUDE.md` (v1.3) defining the full multi-phase product and engineering specification.

* **Root Spec:** `CLAUDE.md` (65 KB, 718 lines) defines the entire scope, non-negotiable principles, plane separations, multi-tenant isolation, trust architecture, agent hierarchy, tool gateway, policy-as-code, customer lifecycle, and verification requirements.
* **Runtime Environment:**
  * Node.js: `v24.14.0` (LTS)
  * npm: `11.9.0`
  * Python: `3.12.10`
  * Git: `2.50.1.windows.1`
  * OS: Windows 11 / PowerShell

---

## 2. Technology Stack & Architectural Decision Baseline

| Component | Target Technology / Specification | Rationale & Governance Alignment |
|---|---|---|
| **Language & Runtime** | TypeScript 5.x / Node.js 24 (ESM native) | High concurrency, strict static typing, rich ecosystem for agent tooling and async pipelines. |
| **API Framework** | Fastify / Express modular HTTP + WebSocket / SSE | Low latency, schema-validated routing, robust middleware lifecycle. |
| **Schema Validation** | Zod 3.x | Single source of truth for runtime type safety, tool parameter validation, agent schema contracts. |
| **Database & Storage** | PostgreSQL / SQLite (with SQLite/Memory for hermetic testing) | ACID compliance, strict tenant foreign keys, schema migrations, transactional guarantees. |
| **Security & Auth** | Argon2/bcrypt password hashing, Ed25519/HMAC JWT tokens, scoped API keys, RBAC/ABAC engine | Zero-trust authentication, cryptographic nonces, tenant boundary enforcement. |
| **Agent Core** | Modular Hierarchical Orchestrator + Tool Gateway + Policy Firewall | Decoupled from any single LLM vendor; enforces deterministic schema contracts and risk checks. |
| **Frontend/Console** | Modern React / Next.js / Vite SPA with custom Token Design System | Accessible (WCAG 2.1 AA), progressive disclosure (Simple vs Expert modes), zero fake metrics. |
| **Testing Suite** | Vitest / Jest + Supertest + Property/Adversarial testing | Fast hermetic unit, integration, security boundary, and tenant isolation test suites. |

---

## 3. Context Classification Matrix

### Existing
* **Constitutional Specification (`CLAUDE.md`):** Complete, rigorous product and engineering specification covering all 43 sections.

### Missing (To be engineered systematically across phases)
1. **Core Platform Foundation (Phase 1):** Configuration manager, structured logging with correlation IDs, error hierarchy, cryptography, tenant context middleware, DB migration engine, base repositories.
2. **Multi-Tenant Control Plane (Phase 2):** Organizations, Workspaces, Business Units, Roles & Permissions (RBAC/ABAC), Tenant Quotas, Platform Operator Console APIs.
3. **Customer 360 & Entity Resolution (Phase 3):** Customer profile schema, deterministic identity resolution engine, interaction timeline, consent tracking, lifecycle state machine.
4. **Communication Platform & Gateway (Phase 4):** Channel adapters (Web, WhatsApp, Email, Voice pipeline), conversation gateway, unified message router, frequency governor.
5. **Agent Platform & Hierarchical Orchestrator (Phase 5 & 6):** Agent registry, versioning, lifecycle states, typed task/result schemas, Strategy/Operations manager agents, specialist sub-agents.
6. **Tool Gateway & Mediated Execution (Phase 7):** Scoped credential injection, tenant policy checks, rate limiting, deterministic result validation, audit logging.
7. **Policy Engine & Agent Safety Firewall (Phase 8):** Policy-as-code rules, risk-tier classification (LOW/MEDIUM/HIGH/CRITICAL), approval gates, autonomous boundary controls.
8. **Workflow Engine (Phase 9):** Node-based workflow executor (Triggers, Conditions, Agents, Tools, Approvals, Compensation, Retries, Timeouts).
9. **Customer Lifecycle Workforce (Phase 10):** Lead, Qualification, Sales, Booking, Support, Follow-Up, Retention, Review agents with evaluation test suites.
10. **Observability, Trust & Human Attention Center (Phases 13–16):** Execution trace graphs, explainability records, real-time activity feed, prioritized human attention queue, quality reviewer.

### Incomplete / Dangerous / Conflicting / Deprecated
* **None identified in codebase:** Starting from clean architecture ensures zero legacy technical debt, no hardcoded secrets, and no antipatterns.

---

## 4. Reusable Patterns & Standards to Enforce

1. **Strict Tenant Context Propagation:** AsyncLocalStorage / Request Context carrying `tenantId`, `organizationId`, `workspaceId`, `userId`, `roles`, `correlationId`.
2. **Deterministic Schemas for Agent Communication:** No unstructured prompt-to-prompt messaging between internal agents. All payloads adhere to typed Zod contracts with evidence, facts, confidence, and risk flags.
3. **No Unmediated Tool Execution:** Agents never hold raw API credentials; all calls route through the Policy Firewall and Scoped Tool Gateway.
4. **Deterministic Validation Over LLM Validation:** Use deterministic code for business rules, financial figures, appointments, and permissions.

---

## 5. Migration & Phased Rollout Roadmap

```text
[Phase 0: Reconnaissance & Architecture Specs]  <-- CURRENT
        ↓
[Phase 1: Platform Foundation & Core Security]
        ↓
[Phase 2: Multi-Tenant Control Plane & RBAC]
        ↓
[Phase 3: Customer 360 & Identity Engine]
        ↓
[Phase 4: Omnichannel Communication Gateway]
        ↓
[Phase 5: Agent Platform & Tool Gateway]
        ↓
[Phase 6: Hierarchical Multi-Agent Orchestration & Policy Firewall]
        ↓
[Phase 7–10: Workflow Engine & Customer Lifecycle Workforce]
        ↓
[Phase 11–16: Knowledge Fabric, Observability, Verification & Attention Center]
```
