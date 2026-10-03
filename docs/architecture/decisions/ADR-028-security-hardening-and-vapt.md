# ADR-028: Multi-Tenant Security Hardening, SSRF Guard, Sliding-Window Abuse Limiting & Automated VAPT Engine

## Status
**ACCEPTED** (2026-10-02, WP-8.1 / Milestone M8 — Production Operations)

## Context
As Kriya Omnitask moves to enterprise production readiness (Milestone M8), multi-tenant autonomous agents face sophisticated attack surfaces:
1. **SSRF Vulnerabilities across Fetchers and Browsers**: External retrieval tools, egress proxies, and headless browser sessions (`ReachBrowserTool`, `IsolatedFetcherWorker`) could be tricked into querying cloud metadata services (`169.254.169.254`, `metadata.google.internal`), local services (`localhost:5432`), private RFC 1918 subnets, or decimal/hex encoded evasions (`2130706433`).
2. **Flat Rate Limiting & Lack of Abuse Governance**: Previously, Fastify used a single global flat rate limit (1000 req/min) lacking tenant-level isolation, tier differentiation (auth vs tools vs standard API), RFC compliance headers (`X-RateLimit-*`), or automated escalation to the Attention Center upon sustained abuse.
3. **Weak Secret Entropy & Unmanaged Grace Periods**: Rotating secrets previously permitted short/low-entropy values, lacked auto-revocation of expired grace-period secrets, and did not issue Ed25519 proof receipts for secret life-cycle changes.
4. **Lack of Automated Penetration Testing**: Verification relied on unit tests rather than an integrated Vulnerability Assessment & Penetration Testing (VAPT) suite probing network boundaries, authorization gates, SQL/command injection, and audit tamper resilience.

---

## Decision

### 1. Centralized Hardened SSRF Guard Engine
We implement `src/security/ssrf/ssrfGuard.ts` as the single authoritative network security barrier across the platform:
- **Comprehensive Subnet Blocking**: Blocks IPv4 loopback (`127.0.0.0/8`), link-local/cloud metadata (`169.254.0.0/16`), private networks (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), CGNAT (`100.64.0.0/10`), broadcast (`0.0.0.0/8`), benchmarking (`198.18.0.0/15`), documentation (`192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`), and multicast (`224.0.0.0/4`).
- **IPv6 Coverage**: Blocks IPv6 loopback (`::1`), unspecified (`::`), unique-local (`fc00::/7`), link-local (`fe80::/10`), and IPv4-mapped IPv6 (`::ffff:0:0/96`).
- **Evasion Normalization**: Parses and blocks integer decimal IP (`2130706433`), hexadecimal IP (`0x7f000001`), octal representations, and cloud metadata hostnames (`metadata.google.internal`, `instance-data`).
- **DNS Rebinding Defense**: Provides asynchronous `assertSafeUrl()` performing pre-flight DNS lookups with dual resolution checks before opening sockets.
- **Unified Integration**: Fully integrated into `IsolatedFetcher`, `EgressGateway`, and `ReachSecurityPolicy`.

### 2. Multi-Tenant Sliding-Window Rate Limiter & Abuse Governor
In `src/security/ratelimit/tenantRateLimiter.ts`:
- **Tiered Quotas**:
  - `auth`: 10 requests / min
  - `agent_execution`: 60 requests / min
  - `tools`: 120 requests / min
  - `standard_api`: 300 requests / min
  - `webhooks`: 600 requests / min
- **Sliding-Window Timestamps**: In-memory timestamp buckets accurately tracking rolling 60-second windows with zero reset-boundary spikes.
- **RFC Headers**: Emits `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, and `Retry-After`.
- **Abuse Governor**: Tracks strike counts for violations within 5 minutes. Sustained abuse ($\ge 3$ strikes or $\ge 2\times$ quota) automatically dispatches high-priority alerts to the Human Attention Center (`reasonCategory: 'security_anomaly'`, `priority: 'P1_HIGH'`).
- **Tenant Management**: Exposes status inspection and administrative quota reset via REST API.

### 3. Cryptographic Key Hygiene & Proof Issuance
In `src/security/hardening/rotation/secretRotationEngine.ts` and `src/security/hardening/service/securityHardeningService.ts`:
- **Mandatory 256-Bit Entropy**: Calculates Shannon entropy bits; rejects any secret with $< 256$ bits of estimated entropy or $< 32$ characters.
- **Automated Grace Period Revocation**: `revokeExpiredSecrets()` transitions expired credentials from `grace_period` to `revoked`.
- **Ed25519 Cryptographic Proof Receipts**: Every secret rotation issues an Ed25519 signed receipt via `ProofService`, recording the receipt ID and hash in the chained audit ledger.

### 4. Secret Leakage & Dependency Audit Scanners
- `src/security/audit/secretLeakageScanner.ts`: Detects and masks OpenAI (`sk-`), Razorpay (`rzp_`), GitHub (`ghp_`), AWS (`AKIA`), Slack (`xox`), Stripe (`sk_`), raw private keys, and JWTs in logs and payloads.
- `src/security/audit/dependencyAuditScanner.ts`: Audits codebase for dangerous native calls (`eval`, dynamic `Function`, `child_process.exec`, `vm.runInContext`) and flags unpinned package dependencies.

### 5. Automated 12-Probe VAPT Penetration Engine
In `src/security/vapt/vaptEngine.ts`:
- Executes 12 automated penetration probes across SSRF, auth bypass, RBAC escalation, cross-tenant IDOR, rate-limit flooding, SQL injection, command injection, secret leakage, and audit ledger tamper resilience.
- Exposes `POST /api/v1/security/vapt/run` and `GET /api/v1/security/vapt/report` with security scoring (0–100) and structured remediation guides.

---

## Consequences

### Positive
- Zero-trust perimeter: external agents, fetchers, and browser sessions cannot probe internal networks or cloud metadata.
- True multi-tenant rate isolation with automatic Human Attention Center escalation for malicious flooding.
- Cryptographically verifiable key rotation with Ed25519 non-repudiation proofs.
- Continuous automated VAPT validation runnable via CI and REST API.

### Negative / Trade-offs
- Slight in-memory footprint for maintaining sliding-window timestamp buckets (mitigated by automated window pruning on every check).
- Requires DNS lookups on external fetches, introducing minimal network latency (mitigated by caching and fast DNS resolution).
