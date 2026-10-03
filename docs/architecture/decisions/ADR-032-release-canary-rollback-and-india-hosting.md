# ADR-032: Release Gating, Canary Traffic Routing, One-Step Rollback Automation, and India-Region Hosting Governance

## Status
**ACCEPTED**

## Date
2026-10-03

## Context
As Kriya AI transitions from pre-production to multi-tenant production operations under Milestone M8 (WP-8.5), mission-critical agentic operations in regulated Indian enterprises (healthcare, financial services, logistics, and legal) require rigorous guarantees around:
1. **Deterministic canary traffic routing**: Progressive rollout of releases must ensure deterministic tenant session affinity, avoiding erratic version oscillation during flight.
2. **One-step automated and manual rollback**: SREs or automated telemetry monitors must be able to retract 100% of canary traffic to 0% with sub-second execution, lock deployment states, record non-repudiable cryptographic proof receipts (Ed25519), and dispatch P1 incidents to the Human Attention Center (`slo_burn`).
3. **API versioning and contract locking**: Backward-incompatible breaking changes must be locked through minimum supported client version enforcement (HTTP 426 Upgrade Required) and standard RFC 8594 `Deprecation` and `Sunset` headers.
4. **India sovereign hosting & DPDP 2023 compliance**: Customer personal data and model execution must strictly respect India Digital Personal Data Protection Act 2023 (§8, §16) requirements, locking data storage and LLM inference to approved sovereign regions (`ap-south-1` Mumbai primary, `ap-south-2` Hyderabad DR), and blocking cross-border transfer without explicit consent.

## Decision
We implemented a production-grade Release, Canary, Rollback, and Sovereign Hosting architecture under WP-8.5:

1. **Deterministic Canary Routing Engine (`CanaryRoutingEngine`):**
   - Tenant bucket assignment computed via cryptographic hash: `SHA-256(tenantId) % 100`, providing deterministic numbers between 0 and 99.
   - Guaranteed session affinity: repeated requests from the same tenant always land on the identical bucket without jitter.
   - Phased progression model: 5% → 10% → 25% → 50% → 100% based on active telemetry windows.
   - Guarded tripwires: error rates exceeding 1.0% or P99 latency exceeding 1,500ms immediately halt progression and mandate automated emergency rollback.

2. **One-Step Instant Rollback Automation (`OneStepRollbackEngine`):**
   - Instantaneous canary traffic retraction to 0% and deployment status lock to `rolled_back`.
   - Idempotent execution: duplicate rollback requests are safely handled without redundant side effects.
   - Cryptographic Proof Receipt issuance: generates non-repudiable Ed25519-signed proof receipts via `ProofService` (`deployment.rollback`).
   - Human Attention Center integration: dispatches P1 SRE incidents via `AttentionService.escalateOnce` categorized under `slo_burn`.
   - Comprehensive audit logging via `deployment_rollback_events` table.

3. **API Versioning & Contract-Locked Gate (`ApiVersionManager`):**
   - Strict semantic version comparison engine (`compareSemver`).
   - Client version gatekeeper: evaluates incoming client headers against `minSupportedClientVersion`, rejecting obsolete clients with HTTP 426 Upgrade Required.
   - RFC 8594 compliance: automatically generates and attaches `Deprecation` and `Sunset` HTTP headers for deprecated interfaces, and returns HTTP 410 Gone for sunset APIs.

4. **India Data Residency & Sovereign Hosting Governance (`DataResidencyEngine`):**
   - Strict localization enforcement for `IN_DPDP_2023` jurisdictions: primary region `ap-south-1` (Mumbai) and secondary DR region `ap-south-2` (Hyderabad).
   - Dynamic validation rules rejecting unapproved cross-border data movements and unapproved LLM inference regions (e.g. EU or US model regions for localized Indian healthcare/financial datasets).
   - Canonical cloud infrastructure blueprint exported via `/api/v1/deployment/hosting/config` documenting KMS customer-managed key locations, edge CDN ingress PoPs (Mumbai, Delhi, Chennai, Bengaluru), and replication topologies.

5. **Relational Database Migration 057:**
   - `src/storage/migrations/057_release_canary_rollback_and_hosting_schema.sql` defining:
     - `api_version_registrations`
     - `canary_routing_configurations`
     - `canary_telemetry_snapshots`
     - `deployment_rollback_events`
     - `data_residency_configs`

6. **Fastify REST API Surface:**
   - 11 production endpoints under `/api/v1/deployment/*` protected by JWT authentication and RBAC (`system:admin`, `audit:read`, `tenant:write`, `tenant:read`).

## Consequences
- **Positive:** Zero unverified deployments; canaries cannot cause uncontrolled outages as emergency rollback is triggered in sub-second timeframes with verified cryptographic receipts.
- **Positive:** Full statutory compliance with India DPDP Act 2023 for sovereign data residency and AI model processing.
- **Positive:** Client applications receive clear contract signals (HTTP 426, RFC 8594 headers) preventing silent protocol incompatibilities.
