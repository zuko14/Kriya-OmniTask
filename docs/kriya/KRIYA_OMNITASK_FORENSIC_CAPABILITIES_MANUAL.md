# KRIYA OMNITASK — FORENSIC CAPABILITY & OPERATIONAL SPECIFICATION MANUAL
**Document Version:** 1.0.0 (Production Master)  
**Classification:** Enterprise Operational & Architecture Specification  
**Governing Standard:** Kriya AI 2040 Master Strategy Blueprint & CLAUDE.md Constitution  

---

## EXECUTIVE SUMMARY & PHILOSOPHICAL FOUNDATION

### What is Kriya Omnitask?
**Kriya Omnitask** is a **Verified Action Infrastructure** and **Autonomous Operations Workforce Runtime**. 

Unlike conversational AI, LLM chatbots, or copilot extensions that generate passive text suggestions, Kriya Omnitask is an **autonomous execution engine** designed to replace repetitive, high-stakes human operational labor with self-verifying, cryptographically proven software agents.

### The Fundamental Axiom: The Verified Action
In legacy AI systems, agents hallucinate actions. If an LLM states *"Your appointment is confirmed"* or *"I have issued your refund"*, traditional systems trust the model's text string without querying the database or external gateway.

Kriya operates on a single strict primitive: **The Verified Action**.
> **"AI that acts, and proves it acted right."**

No consequential business action is ever reported as complete until:
1. It is validated against an active **Delegated Mandate**.
2. It passes deterministic **Policy Engine** safety rules.
3. It executes via an **Idempotent Tool Gateway**.
4. The target system of record is **independently read back** to observe physical state change.
5. An immutable **Ed25519 Cryptographic Proof Receipt** is generated and hash-chained.
6. The customer is notified **only after** the cryptographic proof receipt exists.

---

## 1. THE 7-STAGE VERIFIED ACTION PIPELINE

Every autonomous task in Kriya Omnitask progresses through a deterministic 7-stage state machine:

```
[Customer Inbound / System Trigger]
             │
             ▼
  ┌─────────────────────────────────────┐
  │ 1. INTENT RECOGNITION (L0–L2)       │ ──► Small model or regex extracts intent & entities
  └──────────────────┬──────────────────┘
                     │
                     ▼
  ┌─────────────────────────────────────┐
  │ 2. MANDATE AUTHORIZATION            │ ──► Asserts delegated limits (spending cap, scope, TTL)
  └──────────────────┬──────────────────┘
                     │
                     ▼
  ┌─────────────────────────────────────┐
  │ 3. DETERMINISTIC POLICY ENGINE      │ ──► Hard risk tiering (T0–T3), anti-hallucination rules
  └──────────────────┬──────────────────┘
                     │
                     ▼
  ┌─────────────────────────────────────┐
  │ 4. IDEMPOTENT TOOL EXECUTION        │ ──► Unique idempotency key dispatched to target API/DB
  └──────────────────┬──────────────────┘
                     │
                     ▼
  ┌─────────────────────────────────────┐
  │ 5. SYSTEM-OF-RECORD READ-BACK       │ ──► Queries calendar/bank/CRM: "Did state change?"
  └──────────────────┬──────────────────┘
                     │
                     ▼
  ┌─────────────────────────────────────┐
  │ 6. ED25519 PROOF RECEIPT ISSUANCE   │ ──► Cryptographic signature + SHA-256 state hash
  └──────────────────┬──────────────────┘
                     │
                     ▼
  ┌─────────────────────────────────────┐
  │ 7. NOTIFICATION DISPATCH            │ ──► WhatsApp/Email/SMS dispatch with proof linkage
  └─────────────────────────────────────┘
```

### Closed Outcome States Enum
The platform enforces a closed set of 7 terminal and intermediate states across all APIs, database records, and UI displays:

| State | Definition | UI Status |
| :--- | :--- | :--- |
| `proposed` | Action proposed by reasoning model; not executed | *"Preparing..."* |
| `blocked` | Refused by Policy Engine, Mandate limit, or SSRF firewall | *"Needs Review (Policy Block)"* |
| `awaiting_approval` | Parked at Human Gate (T3 Critical or over budget) | *"Awaiting Human Approval"* |
| `submitted` | Dispatched to target API; read-back not yet confirmed | *"Submitted, Awaiting Confirmation"* |
| `verified` | Read-back observed desired state; signed receipt recorded | **"Verified Done"** |
| `verification_failed`| Read-back contradicts execution; auto-escalated | **"Verification Mismatch"** |
| `compensated` | Transaction reversed via Saga rollback handler | **"Reversed / Rolled Back"** |

---

## 2. RISK TIERS & AUTONOMY GOVERNANCE

Kriya eliminates autonomous runaway risk by categorizing all actions into 4 mathematical risk tiers:

```
        ▲
       / \         T3: CRITICAL (Irreversible) — HARD HUMAN GATE
      /---\        T2: CONSEQUENTIAL (Financial/Stateful) — AUTONOMOUS UNDER MANDATE
     /-----\       T1: REVERSIBLE (Low-Impact) — AUTONOMOUS WITH SAGA ROLLBACK
    /-------\      T0: READ-ONLY (Informational) — 100% AUTONOMOUS AT MACHINE SPEED
   ───────────
```

### Tier Specifications:
- **T0 (Read-Only):**
  - *Examples:* Checking doctor availability, reading FAQ, querying booking status, viewing catalog.
  - *Autonomy:* Fully autonomous at machine speed.
  - *Verification:* Output validation against database query.
- **T1 (Reversible Actions):**
  - *Examples:* Tentative 15-minute slot hold, draft invoice generation, customer tag update.
  - *Autonomy:* Fully autonomous.
  - *Safety:* Guaranteed compensating transaction (`compensate()` method) if subsequent steps fail.
- **T2 (Consequential / Bounded Actions):**
  - *Examples:* Confirmed appointment booking, issuing refund <= $25 within Mandate, sending formal WhatsApp dispatch.
  - *Autonomy:* Autonomous strictly within tenant's delegated Mandate limits.
  - *Safety:* Mandatory read-back verification (`verify()`).
- **T3 (Irreversible / Critical Actions):**
  - *Examples:* Issuing refunds > $25, cancellation of entire doctor rosters, modifying tenant permissions, external webhooks with financial payload.
  - *Autonomy:* **Zero autonomous execution.** Hard-stops at `human_gate`.
  - *Safety:* Spawns an Attention Item in the Human Attention Center with role-based routing (e.g., `billing_manager`).

---

## 3. THE AUTONOMOUS WORKFORCE FLEET

Kriya Omnitask deploys a coordinated fleet of 5 specialized operational agents:

### 1. Intake & Concierge Agent
- **Core Function:** Omnichannel customer triage and intent routing.
- **Channels:** WhatsApp Business Cloud API, Web Chat, Twilio Voice, SMS, Email.
- **Capabilities:**
  - Deterministic L0 intent classification (Lead, Booking, Support, Emergency, Billing).
  - Multilingual comprehension in English, Hindi, Telugu, Tamil, and regional dialects.
  - Customer 360 identification and explainable identity resolution (merging phone/email).
  - Zero-retention memory compliance (PII scrubbed before long-term vector storage).

### 2. Scheduling Agent
- **Core Function:** Complete calendar and appointment book governance.
- **System of Record:** High-concurrency relational appointment book (PostgreSQL row-level locking `FOR UPDATE` to mathematically prevent double-booking).
- **Capabilities:**
  - Real-time availability calculation merging internal records and external Google Calendar feeds.
  - Tentative slot holds (`[HOLD]` states) with auto-expiry timers.
  - Rescheduling and cancellation workflows with automatic slot re-opening.
  - Resource multi-calendar management (doctors, service bays, conference rooms, counselors).

### 3. Payments & Mandate Agent
- **Core Function:** Financial transaction processing, payment links, and delegated refunds.
- **Integrations:** Razorpay (India Primary), Stripe (International), Kriya Pay.
- **Capabilities:**
  - Automated payment link generation tied to appointment slot holds.
  - Cryptographic webhook HMAC signature verification with `timingSafeEqual`.
  - Automatic payment-to-booking settlement (moves slot hold to `confirmed` upon payment receipt).
  - Delegated mandate-bound refunds with human gate escalation for over-limit requests.

### 4. Document (Lens) Agent
- **Core Function:** Multimodal document parsing, medical report extraction, and verification.
- **Compliance:** Zero-retention architecture (persists only SHA-256 hash and structured JSON; raw bytes dropped from RAM immediately).
- **Capabilities:**
  - L0 deterministic template parsing for high-volume standard forms ($0 inference cost).
  - Multimodal model cascade (L1/L2) for messy prescriptions, lab reports, and invoices.
  - Strict confidence thresholding: extractions with confidence < 0.75 fail closed to human review.

### 5. Attention & Verification Agent
- **Core Function:** Background verification polling, SLA burn rate monitoring, and human escalation.
- **Capabilities:**
  - Asynchronous read-back worker polling external APIs to confirm delayed settlements.
  - Multi-window SLO burn rate tracking (1h, 6h, 24h windows).
  - P0 Emergency bypass routing (direct page to on-call duty manager with zero delay).
  - Human Attention Center bi-directional resolution sync (human approval resumes frozen DAG runs).

---

## 4. CROSS-SECTOR CAPABILITY MATRIX

The Kriya engine is domain-agnostic. Industry packs configure terminology, compliance rules, and toolsets on top of the shared Verified Action core:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                    KRIYA OMNITASK CORE RUNTIME ENGINE                        │
│  (Graph Runtime · Mandates · Tool Gateway · Proof Receipts · Cost Cascade)   │
└──────────────────────────────────────────────────────────────────────────────┘
       │                │                │                │               │
       ▼                ▼                ▼                ▼               ▼
  HEALTHCARE       FINTECH/BFSI    RETAIL/E-COMM    HOSPITALITY      AUTOMOTIVE
  (Kriya Health)   (Kriya Finance)  (Kriya Commerce) (Kriya Stay)     (Kriya Auto)
```

### Detailed Sector Breakdown:

### 1. Healthcare & Clinical Operations (Kriya Health)
* **Outpatient Appointment Booking:** Patient inquiries via WhatsApp automatically checked against doctor schedules, slot holds reserved, prepayments collected, and confirmed with calendar invites.
* **Doctor Emergency Leave Workflow (Blueprint §14):** When a doctor is sick, cancels 40+ appointments in 2 seconds, finds replacement slots across other physicians, notifies patients in their native language, and processes refunds under mandate limits.
* **Lab Report & Prescription Delivery:** Zero-retention parsing of lab results; structured vitals extracted and delivered securely to patient records.
* **Post-Consultation & Chronic Care Follow-ups:** Automated medication adherence reminders and symptom check-ins. Emergency keywords ("chest pain", "shortness of breath") trigger P0 immediate hospital operator escalation.

### 2. Banking, Financial Services & Insurance (BFSI)
* **KYC & Document Collection:** Secure document upload links via WhatsApp/SMS, OCR parsing of government IDs, and verification against official records.
* **Lead Qualification & Loan Eligibility:** Calculates debt-to-income and credit parameters deterministically before routing qualified prospects to loan officers.
* **Payment Reminders & Debt Recovery Assistance:** Empathetic, multilingual EMI payment reminders with one-click payment link generation.
* **Claim Status & Policy Servicing:** Real-time policy document lookups, claim tracking, and address/beneficiary updates with dual-factor verification.

### 3. Retail & E-Commerce Operations
* **Conversational Commerce:** Customer shares image of desired product; Lens agent matches against catalog inventory and creates instant checkout link.
* **Abandoned Cart Recovery:** Personalized WhatsApp follow-ups offering assistance or conditional discount codes within profit margin mandates.
* **Automated Order Tracking & Returns:** Customer queries order status; returns engine validates return window, schedules reverse pickup, and holds refund until warehouse receipt.

### 4. Hospitality & Travel
* **Direct Booking Concierge:** Room availability queries, seasonal rate calculations, special request logging (late check-in, dietary restrictions).
* **Guest Concierge & In-Stay Services:** Room service orders, housekeeping requests, and local recommendations routed to property management systems (PMS).
* **Feedback & Review Maximizer:** Post-checkout review capture; positive ratings routed to Google Reviews, negative feedback escalated to GM before public posting.

### 5. Real Estate & Property Management
* **Site Visit Scheduling:** Automatic matching of buyer availability with property agent rosters; SMS location pins sent with automated reminders.
* **Tenant Maintenance Requests:** Tenant uploads photo of plumbing leak; Document agent classifies urgency, checks lease agreement, and dispatches plumbing vendor.
* **Lease Renewal & Rent Collection:** Automated renewal notice delivery 60 days before expiry; lease agreement generation and digital signature tracking.

### 6. Automotive Dealerships & Service Centers
* **Test Drive Booking:** Lead capture from social campaigns; driver license verification via Lens agent, test drive slot confirmed with showroom sales rep.
* **Periodic Service Scheduling:** Automated maintenance reminders based on vehicle odometer intervals; service bay scheduling and quote approval.
* **Warranty & Parts Inquiries:** Real-time inventory check for spare parts across regional warehouse hubs.

### 7. Professional Services (Legal, Consulting, Accounting)
* **Client Intake & Conflict Check:** Structured discovery questionnaire, preliminary conflict-of-interest database search, retainer agreement dispatch.
* **Tax Document Gathering:** Automated checklists for clients during tax filing season; receipt categorization and expense ledger population.
* **Retainer Billing & Invoice Tracking:** Time-tracking integration, milestone billing link generation, and overdue receivables escalation.

### 8. Education & EdTech
* **Admissions Inquiry Concierge:** Course details, fee breakdown, and eligibility checks delivered across WhatsApp and web portals.
* **Counselor Appointment Booking:** Schedules prospect interviews with academic counselors based on subject interest.
* **Fee Payment Reminders:** Installment due notifications with direct gateway payment links and instant receipt delivery.

---

## 5. CORE OPERATIONAL SUBSYSTEMS

### 1. Kriya Mandate (Delegated Authority Engine)
Autonomous agents cannot be allowed unrestricted authority. Kriya Mandates define:
- **Financial Caps:** Maximum single transaction (e.g., $50) and daily rolling limits ($500).
- **Scope Restriction:** Explicit allowed tool slugs and forbidden categories.
- **Validity Window:** Time-to-live timestamps and instantaneous emergency revocation.
- **Human Escalation Matrix:** Deterministic mapping of which human role is required when limits are exceeded.

### 2. Kriya Reach (Governed Browser Automation)
When external third-party systems lack modern APIs, Kriya Reach executes headless browser sessions:
- **Hermetic Isolation:** Isolated incognito browser contexts per execution.
- **Strict Anti-SSRF Guard:** Hard-blocks RFC 1918 private IPv4 subnets, localhost, and cloud metadata endpoints (`169.254.169.254`).
- **Domain Allowlists:** Enforces exact tenant-approved domain boundaries.
- **Visual Evidence Auditing:** Captures full-page PNG screenshots, generates SHA-256 hashes, and links them to the cryptographic proof receipt.

### 3. Kriya Proof (Cryptographic Audit Ledger)
- **Algorithm:** Ed25519 digital signatures (PKCS#8).
- **Structure:** Hash-chained receipts where each receipt includes `sha256(previous_hash + current_body)`.
- **Offline Verifiability:** Any auditor can verify the authenticity of a completed transaction using `verifyReceiptOffline(receipt, publicKeyPem)` without access to Kriya's internal database.

### 4. Cost Cascade Engine (L0 to L3)
To ensure profitability and eliminate token burn:
- **L0 ($0.000):** Deterministic regex, static rules, template classifiers (60–65% of volume).
- **L1 ($0.001):** Fast small models (DeepSeek-v4-Flash, Claude 3.5 Haiku) for structured extraction (20–25% of volume).
- **L2 ($0.005):** Medium reasoning models for complex domain routing (10% of volume).
- **L3 ($0.030):** Frontier LLMs for multi-turn negotiation and high-ambiguity dispute resolution (<5% of volume).
- **Result:** **78% reduction in inference operational expenditure.**

### 5. Interoperability & MCP Server (Model Context Protocol)
- Full compliance with the Anthropic **Model Context Protocol (MCP 2024-11-05)**.
- Dual transport: Fastify HTTP (`POST /api/v1/mcp`) and standard IO (`stdio`) for CLI agents.
- External LLMs (Claude Desktop, Cursor, external enterprise copilots) can securely call Kriya tools through governed, mandate-checked endpoints.

### 6. India DPDP Act 2023 & Sovereign Boundary Compliance
- **Data Residency:** All data, embeddings, and server execution strictly bound to AWS Mumbai (`ap-south-1`) and Hyderabad (`ap-south-2`).
- **Cross-Border Blocking:** Hard firewall blocks unauthorized transfer of sensitive personal data outside sovereign borders.
- **Subject Access Requests (SAR):** Statutory 72-hour automated SAR export and irreversible SHA-256 tombstone cryptographic erasure.

---

## 6. PLATFORM MULTI-TENANCY: OPERATOR VS CLIENT WORKSPACES

Kriya features a strict two-tier administrative hierarchy:

```
┌────────────────────────────────────────────────────────────────────────┐
│                   PLATFORM OWNER PORTAL (/owner)                       │
│    Tenant: tnt_platform | Role: super_admin | Identity: Root Owner    │
│    Capabilities: Fleet Health, Provision Tenants, Suspend, Billing   │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │ Provisions & Governs
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   CLIENT WORKSPACE CONSOLES (/admin)                   │
│    Tenants: clinic-a, retail-corp, auto-hub | Roles: admin, operator  │
│    Capabilities: Agent Config, Workflows, Attention Queue, Customers   │
└────────────────────────────────────────────────────────────────────────┘
```

1. **Owner Console (`/owner`):**
   - Accessible only by principals belonging to `tnt_platform`.
   - Complete visibility into tenant roster, compute utilization, error rates, and tenant lifecycle (provision, suspend, restore).
   - Fully isolated: client tenant admins cannot elevate into platform operator roles.
2. **Client Admin Console (`/admin`):**
   - Dedicated branded interface for each enterprise client.
   - Client manages their specific agents, appointments, customer directory, and Human Attention queue.
   - Complete multi-tenant relational isolation enforced at the database query level (`tenant_id` scoping).

---

## 7. SYSTEM RESILIENCE, SRE & DISASTER RECOVERY

- **Point-In-Time Recovery (PITR):** Transactional state snapshots with SHA-256 inventory checksums.
- **Prometheus Metrics:** Native zero-dependency `/metrics` exposition tracking HTTP duration, workflow latency, active leases, and SLO burn rate.
- **Automated Canary Rollbacks:** Rolling deployments monitor tripwires (error rate > 1.0%, P99 latency > 1500ms); automated one-step rollback retracts traffic to 0% and pages on-call staff.
- **Saga Rollback Execution:** If a 5-step workflow crashes at step 4, steps 3, 2, and 1 execute their respective `compensate()` functions, restoring external systems to their pristine initial state.

---

## SUMMARY METRIC COMPARISON

| Dimension | Legacy AI Chatbot | Kriya Omnitask Autonomous Runtime |
| :--- | :--- | :--- |
| **Operational Stance** | Suggests text to human | Executes real business transactions |
| **Trust Model** | Trust model output blindly | Read-back verification from database/API |
| **Audit Trail** | Ephemeral chat logs | Tamper-proof Ed25519 cryptographic receipts |
| **Error Handling** | Apologizes with text | Automatic Saga compensation rollback |
| **Safety Guard** | System prompts (easily jailbroken) | Hard deterministic risk tiers (T0–T3) & Human Gates |
| **Cost Profile** | $0.08–$0.20 per interaction | $0.008 per verified outcome (L0–L3 Cascade) |
| **Regulatory Fit** | Non-compliant black box | India DPDP 2023 sovereign compliance ready |
