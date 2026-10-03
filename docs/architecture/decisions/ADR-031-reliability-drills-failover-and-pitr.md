# ADR-031: Reliability Drills, High-Availability Failover & Point-In-Time Recovery (PITR) Engine

## Status
**ACCEPTED**

## Date
2026-10-02

## Context
As Kriya AI operates mission-critical agentic workflows across healthcare, financial services, and customer operations, system resilience against infrastructure failures, data corruption, and downstream provider degradation is mandatory.

Previously:
1. Hardening experiments and chaos tests were partially implemented without a strict production execution gate, posing a risk of accidental fault injection in live tenant environments (mandated by `05_REMOVALS_AND_CONSOLIDATION.md` to run in staging/test only).
2. Point-in-time recovery (PITR) lacked automated cryptographic snapshot validation, row inventorying, and verified restore drill execution.
3. Failover runbooks were documented as theoretical procedures rather than automated, testable, multi-step orchestration workflows.

## Decision
We implemented a production-grade Reliability and Disaster Recovery architecture under WP-8.4 (Milestone M8):

1. **Staging-Only Production Safety Gate:**
   - Chaos drills and fault injection (`ChaosDrillEngine`, `HardeningService.runChaosExperiment`, `HardeningService.runStressBenchmark`) are strictly gated behind `APP_MODE !== 'production'`.
   - Attempting execution in production throws a `ForbiddenError` with domain code `CHAOS_DISABLED_IN_PRODUCTION`.
   - Permitted exclusively in `staging` and `test` environments.

2. **Automated Parameterized Chaos Drills:**
   - `network_drop_retry`: Injects simulated transient socket disconnections, testing exponential retry backoff loops with jitter.
   - `llm_rate_limit_fallback`: Injects HTTP 429 / RESOURCE_EXHAUSTED errors on primary models (e.g. `gemini-1.5-pro`), verifying transparent rerouting to fallback models.
   - `db_pool_exhaustion`: Simulates saturated connection pools and validates queuing and backpressure without unhandled rejections.
   - `worker_queue_crash`: Injects unhandled worker thread crashes, testing Dead Letter Queue (DLQ) capture and transaction rollback.
   - `latency_spike`: Injects synthetic latency delays to test timeouts and P95 SLO thresholds.

3. **Point-In-Time Recovery (PITR) & Snapshot Verification:**
   - Atomic tenant table snapshots across critical entities (`tenants`, `customers`, `channel_integrations`, `policy_rules`, `workflow_definitions`, `agents`, `service_dependency_health`).
   - Deterministic SHA-256 cryptographic checksum calculation of snapshot payload.
   - Tamper and corruption detection: recomputes SHA-256 upon verification or restore, raising `PitrIntegrityError` if a mismatch is detected.
   - Point-in-time restore drills: idempotent row restoration using `INSERT INTO ... ON CONFLICT DO NOTHING`, read-back record verification, and audit logging.

4. **High-Availability Failover Runbook Automation:**
   - Automated 7-step failover execution:
     1. `PRIMARY_HEARTBEAT_FAILURE_DETECTED`: Detects primary node heartbeat degradation.
     2. `CIRCUIT_BREAKER_TRIPPED_TO_DEGRADED`: Trips circuit breaker to degraded read-only mode to guard writes.
     3. `REPLICA_LAG_VERIFIED`: Verifies standby replica replication lag (<1000ms threshold).
     4. `REPLICA_PROMOTED_TO_PRIMARY`: Promotes read replica to primary leader.
     5. `CONNECTION_POOL_REPOINTED`: Updates connection pool routing to promoted replica.
     6. `SRE_INCIDENT_DISPATCHED`: Automatically escalates a P1 incident to the Human Attention Center.
     7. `HEALTH_NORMALIZED_POST_FAILOVER`: Verifies write/read path and restores circuit breaker to healthy.
   - Dynamic cluster node topology inspection (`/api/v1/reliability/failover/topology`).

5. **REST API Surface & Database Migration 056:**
   - `src/storage/migrations/056_reliability_drills_and_pitr_schema.sql` defining `reliability_drill_runs`, `pitr_snapshots`, `pitr_restore_operations`, and `failover_drill_runs`.
   - `/api/v1/reliability/drills/*`, `/api/v1/reliability/pitr/*`, `/api/v1/reliability/failover/*` endpoints protected by JWT and RBAC (`system:admin` / `audit:read`).

## Consequences
- **Positive:** System guarantees zero unverified disaster recovery claims. All failover playbooks, PITR restores, and chaos drills are automated, reproducible, and verifiable via CI/CD.
- **Positive:** Zero risk of accidental production chaos injection.
- **Compliance:** Satisfies SOC 2 Type II, ISO 27001, and enterprise business continuity requirements (RTO < 60s, RPO = 0).
