# ADR-029: DPDP Operations — Purpose-Bound Consent Ledger, SAR Lifecycle, Automated Retention Purges & DPBI Governance

## Status
**ACCEPTED** (2026-10-02, WP-8.2 / Milestone M8 — Production Operations)

## Context
As Kriya Omnitask deploys autonomous AI agents across Indian enterprise workflows (retail, healthcare, banking, and professional services), the platform must comply with the statutory mandates of the **Digital Personal Data Protection Act, 2023 (DPDP Act 2023)**:
1. **Consent & Notice Architecture (§6, §7)**: Consent must be free, specific, informed, unconditional, and unambiguous. Data Principals must be provided clear notices in English and Eighth Schedule languages, and withdrawing consent must be as effortless as giving it.
2. **Data Principal Rights & SAR (§11–§14)**: Data Principals possess non-negotiable statutory rights to access personal data (§11), correct inaccurate records (§12), enforce erasure (Right to be Forgotten) (§12), receive grievance redressal within a statutory 72-hour SLA (§13), and register nominees (§14).
3. **Data Retention & Purpose Fulfillment (§8(7))**: Personal data must be erased as soon as the specified purpose is fulfilled or retention is no longer necessary. Automated enforcement with verifiable audit trails is mandatory.
4. **Data Breach Reporting (§8(6))**: All personal data breaches must be intimated to the Data Protection Board of India (DPBI) and affected Data Principals in a standardized format.

Prior to WP-8.2, consent was tracked as a simple enum in `customer_consents` without versioned notice hashing, Ed25519 cryptographic receipts, statutory SAR workflows, automated retention purge jobs, or DPBI notification generators.

---

## Decision

### 1. Purpose-Bound Immutable Consent Ledger (`dpdp_consent_ledger`)
We implement `src/dpdp/service/dpdpService.ts` and `src/dpdp/repositories/dpdpRepository.ts` to manage affirmative consent records:
- **Versioned Notice Hashing**: Every consent grant hashes the notice content ($\text{SHA-256}(\text{noticeContent})$) along with language specification and notice version (`v1.0`).
- **Cryptographic Receipts**: Issues Ed25519-signed receipts (`actionType: 'dpdp.consent.grant'`) hash-chained to the tenant's proof chain.
- **Effortless Withdrawal**: `withdrawConsent()` marks consent as `withdrawn`, automatically halts downstream processing, supersedes prior active grants, issues withdrawal proof receipts (`actionType: 'dpdp.consent.withdraw'`), and syncs to Customer 360 repositories.

### 2. Full Data Principal Rights (SAR) Lifecycle Engine
We implement an end-to-end Subject Access Request engine in `src/dpdp/service/dpdpService.ts`:
- **Statutory SLAs**: Automated countdowns enforcing 72-hour resolution for Grievances (§13) and 7-day windows for Access, Correction, Erasure, and Nominees.
- **Right to Access (§11)**: Orchestrates `Customer360Service.exportCustomerData()` into portable, machine-readable JSON packages with audit logs and access receipts.
- **Two-Phase Right to Erasure (§12)**:
  1. Purges customer PII from profiles, identities, and timeline records via `Customer360Service.forgetCustomer()`.
  2. Computes an irreversible SHA-256 tombstone digest:
     $$\text{Tombstone} = \text{SHA-256}(\text{tenantId} \parallel \text{customerId} \parallel \text{timestamp} \parallel \text{reason})$$
  3. Issues an Ed25519 proof receipt (`actionType: 'dpdp.data_principal.erasure'`) retaining non-repudiable proof of compliance without preserving raw PII.
- **Right to Correction (§12)**: Updates customer attributes with verified before/after audit records.
- **Right to Nominate (§14)**: Records legally designated proxies in the event of death or incapacity.

### 3. Automated Retention & Compliance Purge Engine (§8(7))
In `dpdp_retention_jobs` and `DpdpService.runRetentionPurge()`:
- **Classification-Driven Schedules**:
  - `customer_pii` / `customers`: 730 days inactive limit $\rightarrow$ anonymization or hard delete.
  - `ephemeral_chat_logs` / `timeline_events`: 90 days limit $\rightarrow$ hard delete.
- **Cutoff Calculation**: Automatically computes cutoff dates from policy retention days.
- **Audited Execution**: Scans matching records, executes the designated purge action, records counts, and issues cryptographic purge receipts (`actionType: 'dpdp.retention.purge'`).

### 4. DPBI Breach Notification Runbook & Package Generator (§8(6))
In `src/dpdp/service/dpdpService.ts` and `docs/security/DPDP_BREACH_NOTIFICATION_RUNBOOK.md`:
- **DPBI Reference Generator**: Formats unique regulatory tracking identifiers (`DPBI-YYYY-XXXXXXXX`).
- **Automated Intimation Packages**: Synthesizes statutory details (fiduciary credentials, incident classification, root cause, containment measures, DPO contact, and principal notification templates) for High and Critical incidents.
- **Data Principal Dispatch**: Generates clean, multilingual-ready Markdown notices for email/WhatsApp broadcast.

### 5. Multi-Tenant REST API (`/api/v1/dpdp/*`)
In `src/api/routes/dpdpRoutes.ts`:
- Exposes 14 secure Fastify endpoints protected by `authenticate`, RBAC permissions (`tenant:read`, `tenant:write`), and strict `TenantContextManager` isolation.

---

## Consequences

### Positive
- **100% Statutory Alignment**: Fully adheres to Sections 6, 7, 8, 11, 12, 13, and 14 of the India DPDP Act 2023.
- **Cryptographic Non-Repudiation**: Every consent grant, withdrawal, erasure, and retention purge is backed by an Ed25519-signed proof receipt verifiable offline.
- **Operational Automation**: Purge jobs and SAR processing eliminate manual compliance overhead for enterprise operators.
- **Zero Frontend Disruption**: All backend services are decoupled and adhere strictly to backend isolation rules (0 files modified in `web/`).

### Negative / Trade-Offs
- Irreversible erasure means erased customer profiles cannot be recovered if requested mistakenly; requires confirmation verification at the application layer.
- Retaining proof receipts requires minimal storage for hash chains and signatures (though raw PII is strictly excluded).
