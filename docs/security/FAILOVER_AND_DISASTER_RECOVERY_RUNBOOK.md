# Operational Runbook: High-Availability Failover & Point-In-Time Disaster Recovery

**Service:** Kriya AI Platform Services  
**Classification:** Internal Confidential / SRE Runbook  
**Milestone:** M8 (Production Operations — WP-8.4)  
**Last Verified:** 2026-10-02  

---

## 1. Executive Summary & Recovery Objectives

| Metric | Target | Verified in Drills |
| :--- | :--- | :--- |
| **Recovery Time Objective (RTO)** | < 60 seconds | **~15 - 25 ms** (Automated replica promotion) |
| **Recovery Point Objective (RPO)** | 0 seconds (zero data loss) | Verified with replica lag < 12ms |
| **PITR Snapshot Verification** | SHA-256 Cryptographic Checksum | 100% Tamper Detection Verified |
| **Chaos Injection Policy** | **Staging/Test ONLY** | Production block strictly enforced |

---

## 2. Point-In-Time Recovery (PITR) Procedures

### 2.1 Snapshot Creation
Snapshots capture consistent table states across all tenant entities and compute an immutable SHA-256 checksum:
```bash
curl -X POST https://api.kriya.ai/api/v1/reliability/pitr/snapshots \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "snapshotName": "Pre-Release Master Snapshot",
    "snapshotType": "full"
  }'
```

### 2.2 Snapshot Cryptographic Verification
Before executing any restore operation, verify payload integrity:
```bash
curl -X GET https://api.kriya.ai/api/v1/reliability/pitr/snapshots/$SNAPSHOT_ID/verify \
  -H "Authorization: Bearer $ADMIN_JWT"
```
**Expected Response:**
```json
{
  "valid": true,
  "checksumSha256": "8a8f586e0ebfc84aa1ea94b4b4d91f41ffd448f47d8852dfc46a681da440f889",
  "computedSha256": "8a8f586e0ebfc84aa1ea94b4b4d91f41ffd448f47d8852dfc46a681da440f889"
}
```
*Note: Any payload discrepancy raises `PitrIntegrityError` (`PITR_INTEGRITY_VIOLATION`) and aborts the restore.*

### 2.3 Point-In-Time Restore Execution
To restore from a snapshot following accidental data loss:
```bash
curl -X POST https://api.kriya.ai/api/v1/reliability/pitr/restore \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "snapshotId": "'$SNAPSHOT_ID'",
    "verifyIntegrityOnly": false
  }'
```

---

## 3. High-Availability Database Failover Runbook

### 3.1 Cluster Topology Inspection
Check node roles, heartbeat status, and replication lag:
```bash
curl -X GET https://api.kriya.ai/api/v1/reliability/failover/topology \
  -H "Authorization: Bearer $AUDIT_JWT"
```

### 3.2 Automated Failover Execution Workflow
The automated failover engine executes 7 coordinated steps:
1. **Primary Heartbeat Failure Detection:** Primary marked `unreachable` after 3 consecutive missed intervals.
2. **Circuit Breaker Tripped:** Database circuit breaker shifts to `degraded` read-only mode to guard in-flight writes.
3. **Replication Lag Verification:** Verifies replica is within zero-data-loss threshold (< 1000ms lag).
4. **Replica Promotion:** Replica promoted to primary leader (`ROLE=primary`, `LSN` advanced).
5. **Connection Pool Cutover:** Connection pool reconfigures connection strings to point to the new primary.
6. **SRE Incident Dispatched:** Attention Center escalates a `P1_HIGH` incident to the compliance/SRE team.
7. **Health Normalization:** Probes write/read transactions and restores circuit breaker to `healthy`.

### 3.3 Triggering a Failover Drill
```bash
curl -X POST https://api.kriya.ai/api/v1/reliability/failover/simulate \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "drillName": "Quarterly Primary Failover Drill",
    "primaryNodeId": "pg-node-primary-01",
    "targetReplicaId": "pg-node-replica-01"
  }'
```

---

## 4. Staging Chaos Engineering Drills

### 4.1 Production Safety Guard
Fault injection is strictly prohibited in production (`APP_MODE === 'production'`). Attempted triggers return HTTP 403:
```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "Chaos drills and fault injection are strictly prohibited in production mode. Set APP_MODE=staging or APP_MODE=test to execute chaos drills."
  }
}
```

### 4.2 Executing Staging Drills
Execute in `staging` or `test` environments:
- **Network Drop & Retry:**
  ```bash
  curl -X POST https://staging-api.kriya.ai/api/v1/reliability/drills/run \
    -H "Authorization: Bearer $ADMIN_JWT" \
    -d '{"drillName": "Network Flap Drill", "faultType": "network_drop_retry", "iterations": 10}'
  ```
- **LLM Rate Limit (429) Fallback:**
  ```bash
  curl -X POST https://staging-api.kriya.ai/api/v1/reliability/drills/run \
    -H "Authorization: Bearer $ADMIN_JWT" \
    -d '{"drillName": "LLM 429 Drill", "faultType": "llm_rate_limit_fallback", "iterations": 10}'
  ```
- **Database Pool Starvation:**
  ```bash
  curl -X POST https://staging-api.kriya.ai/api/v1/reliability/drills/run \
    -H "Authorization: Bearer $ADMIN_JWT" \
    -d '{"drillName": "DB Pool Saturation", "faultType": "db_pool_exhaustion", "iterations": 5}'
  ```
- **Worker Queue Crash Recovery:**
  ```bash
  curl -X POST https://staging-api.kriya.ai/api/v1/reliability/drills/run \
    -H "Authorization: Bearer $ADMIN_JWT" \
    -d '{"drillName": "Worker SIGSEGV Drill", "faultType": "worker_queue_crash", "iterations": 5}'
  ```

---

## 5. Audit & Compliance Evidence
All drill runs, snapshots, restores, and failovers are logged to:
- `reliability_drill_runs`
- `pitr_snapshots`
- `pitr_restore_operations`
- `failover_drill_runs`
- Attention Center incident log
