# Xylarc AI — Risk Register & Threat Matrix

**Document Version:** 1.0.0  
**Date:** 2026-08-15  
**Author:** Principal AI Systems Architect & Security Engineering Team  

---

## 1. Risk Register & Mitigation Strategy

| ID | Category | Risk Description | Severity | Likelihood | Impact | Architectural Mitigation / Guardrail |
|---|---|---|---|---|---|---|
| **RSK-001** | Multi-Tenancy | Tenant cross-contamination or data leak across organizations | Critical | Low | Fatal | Strict AsyncLocalStorage tenant context propagation + mandatory server-side `tenantId` filtering on all DB queries + hermetic tenant isolation test suites. |
| **RSK-002** | AI Safety | Agent hallucination in customer-facing pricing, booking, or financial commitments | High | Med | High | Evidence-first trust architecture (§14). Authoritative systems of record are sole source of truth; deterministic validation runs before any state change. |
| **RSK-003** | AI Safety | Direct / Indirect Prompt Injection via incoming user messages or ingested documents | High | Med | High | Content isolation, instruction hierarchy, sandboxed data extraction, policy firewall validation, and strict output schema enforcement. |
| **RSK-004** | Security | Tool credential theft or unmediated agent tool abuse | Critical | Low | Fatal | Mediated Tool Gateway (§26, §27). Agents never receive raw API keys; gateway injects scoped, short-lived tokens after policy verification. |
| **RSK-005** | Governance | Runaway autonomous actions or infinite agent delegation loops | High | Med | High | Max step limits, execution timeouts, recursion counters, autonomy tiers (Levels 0–5), and emergency global/tenant/agent kill switches. |
| **RSK-006** | Communication | Customer harassment / over-messaging across parallel agent teams | Medium | Med | Med | Centralized Communication Frequency Governor (§21) tracking quiet hours, per-channel message velocity, and cross-team interaction mutexes. |
| **RSK-007** | Voice | Telephony / STT transcription hallucination or failure leading to corrupted bookings | High | Med | Med | STT confidence gating (< threshold triggers human transfer) + dual-provider failover + audio recording evidence ledger. |
| **RSK-008** | Reliability | External API provider outages (LLM, WhatsApp, CRM, Payment Gateway) | High | Med | Med | Circuit breakers, exponential backoff, dead-letter queues, idempotent retry tokens, and automatic multi-provider model routing fallbacks. |
| **RSK-009** | Compliance | Non-compliance with privacy regulations (GDPR, India DPDP, HIPAA where applicable) | High | Low | High | Data minimization, purpose limitation, explicit consent tracking, customer data deletion/export workflows, and immutable audit logs. |

---

## 2. Threat Modeling & Defense in Depth

```
[Incoming Request / Webhook / Event]
        │
        ▼
[1. Network & Rate Limiting Gate] ──> Reject DDoS / Floods
        │
        ▼
[2. Authentication & Tenant Scope Gate] ──> Reject Unauthenticated / Cross-Tenant
        │
        ▼
[3. Input Sanitization & Threat Scanner] ──> Flag Prompt Injection / Malicious Payloads
        │
        ▼
[4. Agent Safety Firewall (Policy Engine)] ──> Check Risk Level & Autonomy Tier
        │
        ▼
[5. Scoped Tool Gateway Execution] ──> Inject Short-Lived Scoped Credentials
        │
        ▼
[6. Deterministic Verification Layer] ──> Validate Results Against Authoritative DB
        │
        ▼
[7. Mandatory Human-in-the-Loop Gate] ──> If Risk = HIGH/CRITICAL or Low Confidence
        │
        ▼
[8. Cryptographic Audit & Event Ledger] ──> Immutable Record of Action & Evidence
```
