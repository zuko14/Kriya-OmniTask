# Kriya AI — India DPDP Act 2023 Compliance Manual

## 1. Statutory Scope & Architectural Governance

The **Digital Personal Data Protection Act, 2023 (DPDP Act 2023)** governs the processing of digital personal data within India and digital personal data processed outside India in connection with offering goods or services to Data Principals within India.

Kriya AI operates as a **Data Fiduciary** (and for enterprise client deployments, as a **Data Processor** acting strictly on verifiable fiduciaries' mandates). This manual codifies technical and organizational measures (TOMs) implemented in Kriya AI across four operational pillars:
1. **Consent Ledger (§6, §7):** Purpose-bound, informed, unambiguous consent with versioned notices and Ed25519 cryptographic receipts.
2. **Data Principal Rights & SAR Lifecycle (§11–§14):** Rights to access, correction, erasure (Right to be Forgotten with tombstone hashes), grievance redressal (72-hour statutory SLA), and nominee registration.
3. **Automated Data Retention & Purge Engine (§8(7)):** Enforcing purpose fulfillment limits, automatic cutoff calculations, and audited anonymization/hard-delete executions.
4. **Data Breach Governance (§8(6)):** Incident response, Data Protection Board of India (DPBI) intimation packages, and affected principal notifications.

---

## 2. Consent Ledger Architecture (§6, §7)

### 2.1 Consent Specifications
Under Section 6(1) of the DPDP Act 2023, consent must be:
- **Free, specific, informed, unconditional, and unambiguous**.
- Signified through a clear affirmative action.
- Accompanied by or preceded by a notice containing:
  - The personal data to be processed and the specific purpose.
  - The manner in which the Data Principal may exercise rights (§11–§14).
  - The manner in which a complaint may be made to the Data Protection Board of India.
  - Available in English and any language specified in the Eighth Schedule to the Constitution of India (e.g. Hindi, Telugu, Tamil, Marathi, Bengali, Kannada).

### 2.2 Immutable Consent Ledger Schema (`dpdp_consent_ledger`)
Every consent action is stored immutably in SQLite/PostgreSQL with multi-tenant scoping:
```sql
CREATE TABLE dpdp_consent_ledger (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  purpose TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('granted', 'withdrawn', 'expired', 'superseded')),
  notice_version TEXT NOT NULL DEFAULT 'v1.0',
  notice_hash TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en',
  valid_until TEXT,
  proof_receipt_id TEXT,
  withdrawn_at TEXT,
  withdrawn_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
```

### 2.3 Cryptographic Proof Receipt Issuance
When consent is granted or withdrawn, `ProofService.issue()` generates an Ed25519-signed receipt hash-chained to the tenant's proof chain:
- **Grant Receipt:** `actionType: 'dpdp.consent.grant'`, records SHA-256 notice hash, customer ID, purpose, and language.
- **Withdrawal Receipt:** `actionType: 'dpdp.consent.withdraw'`, records withdrawal affirmation and timestamp.
- **Processing Halt:** Withdrawal automatically supersedes prior active consent and triggers immediate cessation of automated outreach across all autonomous agents (`IntakeAgent`, `OutreachAgent`).

---

## 3. Data Principal Rights (Subject Access Requests — SAR)

### 3.1 Statutory Rights Taxonomy
| Section | Right | Statutory Requirement | Kriya AI Implementation | SLA |
| :--- | :--- | :--- | :--- | :--- |
| **§11** | Right to Access | Summary of personal data processed, identities of all fiduciaries/processors shared with. | `Customer360Service.exportCustomerData()` + portable JSON export package. | 7 Days (168h) |
| **§12** | Right to Correction | Correction of inaccurate or misleading data, updating of incomplete data. | `CustomerRepository.updateCustomer()` attribute update with audit trail. | 7 Days (168h) |
| **§12** | Right to Erasure | Deletion of personal data no longer necessary for the specified purpose. | `Customer360Service.forgetCustomer()` + irreversible SHA-256 tombstone hash + Ed25519 proof receipt. | 7 Days (168h) |
| **§13** | Right to Grievance Redressal | Accessible grievance redressal mechanism provided by Data Fiduciary. | Dedicated ticket lifecycle in `dpdp_rights_requests` with resolution notes. | **72 Hours** |
| **§14** | Right to Nominate | Nomination of any individual to exercise rights in the event of death or incapacity. | Registration of nominee contact and authorization credentials. | 7 Days (168h) |

### 3.2 Right to Erasure & Cryptographic Tombstones
Under Section 12(3), upon receiving an erasure request, personal data must be permanently erased unless retention is required under statutory law.
Kriya AI implements a **two-phase cryptographic erasure**:
1. **PII Anonymization / Purge:** Profile PII (`full_name`, `primary_email`, `primary_phone`, `external_crm_id`, `attributes_json`) is anonymized, and associated identities and timeline events are unlinked.
2. **Irreversible Tombstone Hashing:** A SHA-256 cryptographic digest is computed:
   $$\text{Tombstone Hash} = \text{SHA-256}(\text{tenantId} \parallel \text{customerId} \parallel \text{erasedAt} \parallel \text{reason})$$
3. **Signed Proof Receipt:** An Ed25519 proof receipt (`actionType: 'dpdp.data_principal.erasure'`) is signed and stored in `dpdp_rights_requests.proof_receipt_id`, providing non-repudiable legal evidence that the data was erased without retaining any raw PII.

---

## 4. Automated Data Retention & Purge Engine (§8(7))

### 4.1 Purpose Fulfillment Retention Principle
Section 8(7) mandates that personal data must be erased as soon as:
- The purpose for which it was collected has been satisfied; or
- It is no longer necessary for statutory or business purposes.

### 4.2 Retention Schedules by Data Classification
| Data Classification | Target Resource | Retention Limit | Default Purge Action | Justification |
| :--- | :--- | :--- | :--- | :--- |
| **Customer PII** | `customers`, `customer_identities` | 730 days (2 years inactive) | `anonymize` | Retains anonymized transaction stats for accounting while destroying PII. |
| **Ephemeral Chat Logs** | `customer_timelines` | 90 days | `hard_delete` | Raw conversation transcripts purged after operational SLA window. |
| **Agent Execution Traces** | `agent_executions`, `tool_logs` | 180 days | `hard_delete` | Observability data pruned after model evaluation window. |
| **Billing Invoices & Proofs** | `invoices`, `proof_receipts` | 2,920 days (8 years) | `anonymize` | Mandatory under Indian tax and corporate laws (Income Tax Act / GST Act). |

### 4.3 Retention Purge Execution (`dpdp_retention_jobs`)
Automated retention jobs execute via `DpdpService.runRetentionPurge()`:
- Cutoff derivation: $\text{Cutoff} = \text{CurrentTime} - (\text{retention\_days} \times 86400000\text{ms})$.
- Queries and evaluates expired records.
- Executes either irreversible anonymization or complete deletion.
- Records `records_scanned` and `records_purged`.
- Issues a signed proof receipt (`actionType: 'dpdp.retention.purge'`).

---

## 5. Personal Data Breach Management (§8(6))

In the event of a personal data breach, Section 8(6) mandates intimating:
1. **The Data Protection Board of India (DPBI)** in such form and manner as prescribed.
2. **Each affected Data Principal**.

Kriya AI integrates this statutory obligation into `DpdpService.reportBreachIncident()`:
- Automatic generation of DPBI incident reference identifier (`DPBI-YYYY-XXXXXXXX`).
- Automated statutory notification packet creation for High and Critical severity breaches.
- Standardized markdown notification templates ready for immediate customer dispatch.
- Full details documented in `docs/security/DPDP_BREACH_NOTIFICATION_RUNBOOK.md`.

---

## 6. Roles & Statutory Responsibilities
- **Data Protection Officer (DPO):** Designated under Section 10(2)(a) for Significant Data Fiduciaries; represents the fiduciary before DPBI and handles escalations.
- **Privacy Operations Team:** Processes SAR access exports, corrections, and adjudicates grievances within the statutory 72-hour SLA.
- **Security Operations Team:** Executes the Breach Notification Runbook and conducts periodic VAPT and DPDP compliance audits.
