# Kriya Omnitask — Vulnerability Assessment & Penetration Testing (VAPT) Checklist

**Milestone:** M8 — Production Operations (WP-8.1: Security Hardening)  
**Standard:** OWASP Top 10, OWASP API Security Top 10, OWASP Top 10 for LLMs  
**Status:** Production Ready  
**Engine:** `src/security/vapt/vaptEngine.ts`  
**API Endpoints:** `POST /api/v1/security/vapt/run`, `GET /api/v1/security/vapt/report`

---

## 1. Automated Penetration Probe Matrix

| Probe ID | Probe Name | Target Component | Threat / Attack Vector | Pass Criteria | Severity |
|---|---|---|---|---|---|
| **VAPT-PROBE-01** | SSRF Loopback & Decimal IP | `SSRFGuard`, `IsolatedFetcher`, `ReachSecurityPolicy` | Decimal IP (`2130706433`), Hex IP (`0x7f000001`), `127.0.0.1`, `localhost`, `[::1]` | All requests rejected with 403 / `SsrfSecurityError`. | **CRITICAL** |
| **VAPT-PROBE-02** | SSRF Cloud Metadata | `SSRFGuard`, `EgressGateway` | `169.254.169.254`, `metadata.google.internal`, AWS/GCP instance credential scraping | Rejected synchronously and asynchronously prior to DNS/socket. | **CRITICAL** |
| **VAPT-PROBE-03** | SSRF Private Subnet & CGNAT | `SSRFGuard`, `ReachSecurityPolicy` | RFC 1918 (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), CGNAT (`100.64.0.0/10`) | All egress to internal IP ranges blocked. | **HIGH** |
| **VAPT-PROBE-04** | Missing Authentication Barrier | API Gateway / Fastify middleware | Requests without `Authorization: Bearer <token>` | Immediate 401 Unauthorized with standard error response. | **CRITICAL** |
| **VAPT-PROBE-05** | Forged JWT & `alg: none` | `JwtService` | Forged token signature or unsigned token with `alg: none` | Signature verification rejects token; zero bypass. | **CRITICAL** |
| **VAPT-PROBE-06** | RBAC Privilege Escalation | `RBACService`, `rbacMiddleware` | `read_only` user attempting administrative `tenant:write` or `system:admin` calls | Explicit 403 Forbidden with permission audit record. | **HIGH** |
| **VAPT-PROBE-07** | Cross-Tenant IDOR | `TenantContextManager`, Repositories | User from Tenant A attempting access or mutation on Tenant B resources | Scoped query filtering prevents cross-tenant state leakage. | **CRITICAL** |
| **VAPT-PROBE-08** | Rate Limit Flooding & Bursting | `TenantRateLimiter` | High-frequency request bursts exceeding category quota | 429 Too Many Requests returned with `X-RateLimit-*` and `Retry-After`. | **HIGH** |
| **VAPT-PROBE-09** | SQL Injection Defense | Database Client & Repositories | Single quotes, comments (`--`), `UNION SELECT`, `DROP TABLE` | Zero query concatenation; 100% parameterized binding. | **CRITICAL** |
| **VAPT-PROBE-10** | OS Command Injection | Tool Execution Engine | Shell metacharacters (`;`, `\|`, `$(...)`, `` `...` ``) | Shell calls forbidden; arguments validated as discrete string arrays. | **CRITICAL** |
| **VAPT-PROBE-11** | Secret Leakage & Redaction | `SecretLeakageScanner` | Exposed API keys (`sk-`, `rzp_`, `ghp_`, `AKIA...`), private keys, raw JWTs | Automated pattern matching identifies tokens and redacts outputs. | **HIGH** |
| **VAPT-PROBE-12** | Audit Ledger Tamper Resilience | `CryptoAuditLedger` | Alteration of audit log rows, broken sequential hashes | `verifyChain` identifies broken sequence and detects tamper. | **CRITICAL** |

---

## 2. Pre-Deployment Operational Checklist

### A. Network & Perimeter Security
- [x] **Centralized SSRF Guard Deployed:** `src/security/ssrf/ssrfGuard.ts` integrated into `IsolatedFetcher`, `EgressGateway`, and `ReachSecurityPolicy`.
- [x] **DNS Rebinding Defense:** Double-check resolution before HTTP socket connection.
- [x] **CORS Configuration:** Explicit allowed origins, methods, and header whitelists in `server.ts`.

### B. Authentication & Authorization
- [x] **JWT Cryptographic Hardening:** Minimum 256-bit secret key enforced; algorithm fixed to `HS256`.
- [x] **Strict RBAC Enforcement:** Role matrix explicitly defined in `src/security/rbac/rbac.ts`.
- [x] **Tenant Context Isolation:** `TenantContextManager` uses `AsyncLocalStorage` to guarantee context propagation across async boundaries.

### C. Rate Limiting & Abuse Prevention
- [x] **Sliding-Window Rate Limiter:** `TenantRateLimiter` active with per-category quotas (`auth`, `agent_execution`, `tools`, `standard_api`, `webhooks`).
- [x] **RFC Headers:** `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `Retry-After`.
- [x] **Automated Attention Escalation:** Sustained abuse ($\ge 3$ strikes or $2\times$ quota) automatically dispatches high-priority alert to Human Attention Center.

### D. Cryptographic Key Management & Secret Rotation
- [x] **Entropy Enforcement:** All rotated secrets must satisfy $\ge 256$ bits of estimated Shannon entropy (`SecretRotationEngine.validateEntropy`).
- [x] **Automated Grace Period Revocation:** Secrets past expiration date are transitioned from `grace_period` to `revoked`.
- [x] **Ed25519 Proof Receipts:** Every key rotation issues a cryptographically signed proof receipt via `ProofService`.

### E. Code Quality & Dependency Audits
- [x] **Secret Leakage Scans:** `SecretLeakageScanner` flags exposed credentials in code, environments, and response payloads.
- [x] **Dangerous Native Call Audits:** `DependencyAuditScanner` audits repository for `eval()`, dynamic `Function()`, `vm.runInContext()`, and unpinned dependencies.

---

## 3. Automated VAPT Verification Procedure

To run the automated VAPT suite programmatically:

```bash
# Trigger automated VAPT run via curl (requires admin Bearer token)
curl -X POST http://localhost:3000/api/v1/security/vapt/run \
  -H "Authorization: Bearer <ADMIN_JWT>" \
  -H "Content-Type: application/json"
```

Expected JSON Response:
```json
{
  "auditId": "vapt_f4b7a1e0c2",
  "timestamp": "2026-10-02T19:15:00.000Z",
  "totalProbes": 12,
  "passedProbes": 12,
  "failedProbes": 0,
  "securityScore": 100,
  "overallStatus": "SECURE",
  "probes": [
    {
      "probeId": "VAPT-PROBE-01",
      "name": "SSRF Loopback & Decimal IP Evasion Defense",
      "status": "PASSED",
      "severity": "CRITICAL",
      "durationMs": 3
    }
  ]
}
```
