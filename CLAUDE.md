# CLAUDE.md — Xylarc AI: Autonomous Business Workforce Platform

**Document type:** Root-level operating specification for Claude / Claude Code
**Status:** Living document — governs architecture, engineering, and product decisions
**Revision:** v1.3 — channel-plan-aware dashboards (§8), typography/token system & chart-selection discipline (§31), contract-locked frontend/backend deploys (§32); v1.2 added channel-based service plans (§30) and a complete voice pipeline with per-language voice validation (§19); v1.1 added §37 (Reliability Commitment & Forward-Looking Upgrades)
**Applies to:** the entire Xylarc AI repository and every subsystem within it

> Read this file before modifying the product. Inspect the existing codebase before proposing architecture changes. This document defines what Xylarc AI *is*, how it must be built, and how an AI coding agent should behave while working on it.

---

## Table of Contents

1. [What This Document Is](#1-what-this-document-is)
2. [Identity & Positioning](#2-identity--positioning)
3. [Company Context](#3-company-context)
4. [Core Vision](#4-core-vision)
5. [The Fundamental Principle](#5-the-fundamental-principle)
6. [Multi-Tenant Architecture](#6-multi-tenant-architecture)
7. [Platform Administration](#7-platform-administration-xylarc-operator-console)
8. [Customer Administration Dashboard](#8-customer-administration-dashboard)
9. [Customer 360 / Digital Twin](#9-customer-360--digital-twin)
10. [Customer Lifecycle Engine](#10-customer-lifecycle-engine)
11. [Cross-Sector Capability Framework](#11-cross-sector-capability-framework)
12. [Agent Hierarchy & Specification](#12-agent-hierarchy--specification)
13. [Task & Information Pipelines](#13-task--information-pipelines)
14. [Trust Architecture: Evidence-First, No-Hallucination](#14-trust-architecture-evidence-first-no-hallucination)
15. [Autonomy Levels & Risk-Based Action Control](#15-autonomy-levels--risk-based-action-control)
16. [Human-in-the-Loop](#16-human-in-the-loop)
17. [Agent Lifecycle: Evaluation, Versioning, Simulation](#17-agent-lifecycle-evaluation-versioning-simulation)
18. [Business Memory & Knowledge Fabric](#18-business-memory--knowledge-fabric)
19. [Omnichannel Communication & Voice](#19-omnichannel-communication--voice)
20. [Multilingual / Regional Language System](#20-multilingual--regional-language-system)
21. [Communication Intelligence & Follow-Up Governance](#21-communication-intelligence--follow-up-governance)
22. [Business & Predictive Intelligence](#22-business--predictive-intelligence)
23. [Goals, Rules, Workflows, Builder, Marketplace](#23-goals-rules-workflows-builder-marketplace)
24. [Cost Intelligence & Model Routing](#24-cost-intelligence--model-routing)
25. [Observability & Explainability](#25-observability--explainability)
26. [Security & Governance](#26-security--governance)
27. [Tool, Integration & Automation Governance](#27-tool-integration--automation-governance)
28. [Data Architecture, Events & Reliability](#28-data-architecture-events--reliability)
29. [Reliability Engineering](#29-reliability-engineering)
30. [Commercial, Extensibility & Deployment](#30-commercial-extensibility--deployment)
31. [Admin Experience & Visual Design](#31-admin-experience--visual-design)
32. [Engineering & Testing Standards](#32-engineering--testing-standards)
33. [Roadmap](#33-roadmap)
34. [Competitive Positioning](#34-competitive-positioning)
35. [Outcome Measurement](#35-outcome-measurement)
36. [North Star & Product Philosophy](#36-north-star--product-philosophy)
37. [Reliability Commitment & Forward-Looking Upgrades](#37-reliability-commitment--forward-looking-upgrades)
38. [Claude Code — Operating Instructions](#38-claude-code--operating-instructions)
39. [Definition-of-Done Checklists](#39-definition-of-done-checklists)
40. [Incident Protocol: When AI Output Is Wrong](#40-incident-protocol-when-ai-output-is-wrong)
41. [Feasibility Classification](#41-feasibility-classification)
42. [Conflict Resolution Priority Order](#42-conflict-resolution-priority-order)
43. [Final Directive](#43-final-directive)

---

## 1. What This Document Is

This file is the constitution for Xylarc AI. It is read by every engineer and every AI coding agent (including Claude Code) before touching the repository. It defines the product's architecture, its non-negotiable safety and governance rules, and the operating discipline expected of anyone — human or AI — who extends it.

This document describes the **destination architecture**. The repository will not implement all of it on day one. Section 33 (Roadmap) defines what gets built when. Do not read "the platform must support X" as "implement X today" — read it as "never build something that makes X structurally impossible later."

---

## 2. Identity & Positioning

Working product category: **Xylarc Autonomous Business Workforce**.

Acceptable positioning language: AI Business Operating System · Autonomous Business Workforce · AI Workforce Control Plane · Autonomous Customer & Business Operations Platform · Business Autonomy Platform.

The final commercial name is not locked by this document. **Branding is not architecture** — product name, logo, color system, and marketing copy live in a configuration/branding layer only. No commercial name, tagline, or vertical identity is ever hardcoded into core schemas, agent identities, prompts, or business logic. Renaming the product must never require an architecture change.

---

## 3. Company Context

Xylarc already operates around AI-native product engineering, SaaS platforms, multi-tenant systems, workflow automation, AI agents, LLM orchestration, NLU, document AI, voice AI, WhatsApp automation, browser automation, RPA, enterprise integrations, CRM/ERP/business-system connectivity, healthcare technology, production-grade security, tenant isolation, authentication/authorization, audit logging, and privacy-aware automation.

Xylarc AI is the **horizontal layer** that unifies these existing capabilities into one reusable autonomous workforce platform, capable of powering future Xylarc products and vertical solutions (healthcare, finance, retail, logistics, education, hospitality, real estate, automotive, professional services, and others).

**The system must not be designed as healthcare-specific.** Healthcare is one industry vertical with additional regulatory controls layered on top of the same core platform — not a separate build.

---

## 4. Core Vision

> "Xylarc AI gives every business an intelligent digital workforce that operates continuously, understands the business, coordinates specialized agents, executes real work, measures its own performance, and keeps humans in control of risk-sensitive decisions."

The product should let a business say: *"Here is my business. Here are my systems, policies, goals and data. Build me a digital workforce that handles my customer lifecycle and selected business operations."*

The customer then configures, through a business-oriented interface: business profile, departments, objectives, customer lifecycle, channels, operating hours, knowledge sources, business rules, integrations, agent roles, permissions, approval policies, escalation policies, spending limits, communication limits, geographic restrictions, languages, tone/brand, compliance policies, workflow definitions, automation schedules, KPIs, and reporting requirements. Agents then operate strictly within those boundaries.

The customer should never need to understand LLMs, prompt engineering, agent frameworks, vector databases, tool calling, orchestration internals, MCP internals, model routing, embeddings, or memory architecture. The platform exposes powerful controls through a simple interface; advanced users and enterprise administrators retain access to deep controls under "Advanced Configuration."

---

## 5. The Fundamental Principle

**Do not build:** *chatbot + integrations + dashboard.*

**Build:** *business operating model + agent workforce + control plane + execution plane + intelligence layer + governance layer.*

| Plane | Controls / Handles |
|---|---|
| **Control Plane** | Tenants, organizations, workspaces, users, roles, agents, agent teams, policies, permissions, integrations, workflows, deployments, environments, models, costs, limits, compliance, evaluation, audit, observability, configuration, billing, feature flags |
| **Execution Plane** | Conversations, events, agent reasoning, tool invocation, workflows, tasks, calls, messages, browser automation, APIs, documents, data extraction, background jobs, schedules, customer actions, internal business actions |
| **Intelligence Plane** | Customer intelligence, business intelligence, agent intelligence, trend/anomaly/opportunity/churn detection, sentiment, intent, summarization, recommendations, forecasting, knowledge retrieval, cross-agent synthesis |
| **Governance Plane** | Identity, authorization, policy enforcement, approvals, privacy, consent, security, data residency, audit trails, risk classification, agent evaluation, tool/action restrictions, anomaly detection, emergency shutdown, evidence collection |

Every new subsystem must declare which plane(s) it belongs to before implementation begins.

---

## 6. Multi-Tenant Architecture

```
Xylarc Platform
 ├── Platform Organization
 ├── Customer Organization
 │     ├── Workspace → Business Units → Departments → Locations → Teams
 │     ├── Users · Customers
 │     ├── Agents · Agent Teams
 │     ├── Workflows · Integrations · Policies · Data
 └── Platform Operators
```

The platform must support one company with multiple branches, multiple brands, franchises, subsidiaries, regional operations, country-level operations, business units, departments, shared services, and enterprise headquarters structures.

**Tenant isolation is enforced at every relevant layer — database, service, cache, queue, storage, logs — never only at the frontend.** Every row of tenant-owned data carries an explicit `tenant_id` (and `organization_id` / `workspace_id` where applicable) that is checked server-side on every read and write.

---

## 7. Platform Administration (Xylarc Operator Console)

Xylarc needs its own platform administration console, separate from any customer's admin panel. Platform operators can: create/approve organizations, assign customer administrators and workspaces, enable/disable products and agent capabilities, assign plans/quotas/feature flags, configure platform-wide policy, monitor tenant activity and agent/infrastructure health, inspect system metrics, review escalated failures and security events, manage model providers/routing/fallbacks, manage the integrations catalog and agent template library, publish official agent templates, manage marketplace offerings, control dangerous capabilities, suspend or emergency-stop agents/tenants, monitor usage and cost (tokens, comms, voice, automation, storage, API), manage billing/subscriptions/support, maintain platform-wide announcements, and view audit logs/deployment status.

**Platform operators must never casually bypass tenant boundaries.** Every administrative elevation is itself authenticated, authorized, time-limited where appropriate, logged, auditable, and attributable.

---

## 8. Customer Administration Dashboard

Every customer organization gets an Executive Overview: revenue-related activity, customer acquisition, active customers, new leads, conversion rate, CSAT, review score, retention, churn risk, support volume, unresolved issues, agent workload, agent success rate, automation savings, human escalations, response/resolution time, opportunities detected, risks detected, pending approvals.

**The dashboard adapts to the tenant's channel plan (§30) — it never shows a metric for a channel the tenant hasn't subscribed to.** WhatsApp-only tenants see conversation volume, template delivery/read rate, response time, and per-intent breakdown. Voice-only tenants see call volume, average handle time, transfer/drop rate, and per-language call quality (§19). Combined tenants get both plus a unified cross-channel view — e.g., a customer's journey moving from a WhatsApp inquiry into a voice booking call, shown as one thread, not two disconnected logs.

**Every metric must declare its source, timestamp, calculation definition, confidence (where relevant), drill-down path, and underlying evidence.** Never ship a dashboard number nobody can trace back to its source. No vanity metrics.

---

## 9. Customer 360 / Digital Twin

A unified customer intelligence layer aggregates permitted data from CRM, conversations, WhatsApp, email, website, voice calls, purchases, bookings, service history, support tickets, reviews, feedback, documents, forms, preferences, campaigns, subscriptions, payments, engagement, and derived signals (lifecycle stage, sentiment, intent, churn indicators, opportunities) into one timeline:

```
First interaction → Lead → Qualification → Purchase/Booking → Onboarding
   → Support → Feedback → Retention → Expansion/Renewal → Win-back/Churn
```

The platform must avoid creating duplicate customer identities. Build identity/entity resolution with **explainable** matching logic — an admin must be able to see why two records were merged (or weren't).

---

## 10. Customer Lifecycle Engine

| Stage | Representative capabilities |
|---|---|
| **Acquisition** | Inbound lead capture, source attribution, qualification, intent detection, recommendations, response automation, scoring, enrichment, routing, scheduling |
| **Conversion** | Product Q&A, proposal/quote support, booking, payment links, document collection, verification, follow-up, objection handling, abandoned-conversion recovery |
| **Onboarding** | Welcome comms, account creation, KYC/document workflows where applicable, setup guidance, training, activation, milestone tracking |
| **Engagement** | Personalized comms, usage-based interventions, recommendations, education, reminders, reactivation |
| **Support** | FAQ resolution, troubleshooting, ticketing, status retrieval, case classification, escalation |
| **Retention** | Churn prediction, dissatisfaction detection, inactivity detection, proactive outreach, service recovery, retention offers, renewal reminders |
| **Expansion** | Cross-sell, upsell, relevant recommendations, account/contract expansion |
| **Advocacy** | Review requests, referral workflows, testimonials, loyalty programs, advocacy identification |
| **Win-back** | Churn/reason analysis, re-engagement, win-back campaigns, personalized incentives |

---

## 11. Cross-Sector Capability Framework

The platform must not hardcode one industry's workflows. Build a configurable **Business Capability Framework** with industry packs layered on the same core: Healthcare (booking, patient comms, reminders, report delivery, follow-ups, pharmacy/diagnostics coordination), Retail/E-commerce (discovery, sales, cart recovery, order support, returns, retention, reviews), Banking/Financial Services (service, document collection, onboarding, scheduling, qualification, collections assistance — regulated decisions must respect applicable law and appropriate human controls), Real Estate (qualification, recommendation, site visits, follow-up, document coordination), Hospitality (bookings, guest comms, upsells, support, reviews, loyalty), Education (admissions, enquiries, counselling coordination, reminders, fee comms, student support), Automotive (leads, test-drive booking, service scheduling, maintenance reminders, retention), Logistics (booking, tracking, exception detection, delivery comms, dispatch coordination), Professional Services (qualification, scheduling, document collection, project updates, renewals).

The same underlying agent architecture supports all of these — industry packs add templates, terminology, compliance rules, and workflows, not a new core.

---

## 12. Agent Hierarchy & Specification

Agents form a hierarchy, not a flat pool:

```
                     BUSINESS ORCHESTRATOR
                              │
              ┌───────────────┴───────────────┐
        STRATEGY AGENT                  OPERATIONS AGENT
              │                                │
   ┌──────────┼──────────┐         ┌───────────┼───────────┐
 Sales Mgr  Growth Mgr  CS Mgr    Support     Booking     Review
   │                                Agent      Agent       Agent
 Qualifier · Research · Follow-up

          SPECIALIST / SUB-AGENTS: Voice · Browser · Data Extraction
                        VERIFICATION LAYER: Fact · Policy · Quality
```

**Orchestrator** — understands objectives, classifies work, decomposes tasks, selects agents, assigns work, monitors progress, resolves conflicts, combines results, verifies important outcomes, makes escalation decisions, reports business outcomes. It delegates; it does not become an overloaded monolith.

**Manager agents** (Sales, Customer Success, Support, Marketing, Booking, Retention, Review, Operations, ...) — assign sub-tasks, gather specialist results, identify inconsistencies, prioritize work, produce structured summaries, enforce domain policy.

**Specialist sub-agents** (call, transcription, lead research, website research, CRM retrieval, browser automation, document extraction, sentiment, intent, review response, scheduling, payment workflow, enrichment, compliance checker, fact verification, translation, classification, ...) — perform narrow tasks and **always return structured results**, e.g.:

```json
{
  "task_id": "...",
  "status": "completed",
  "facts": [],
  "evidence": [],
  "confidence": 0.0,
  "recommended_action": "...",
  "risks": [],
  "policy_flags": [],
  "requires_approval": false
}
```

**Never rely on free-form prose between internal agents where a deterministic schema is possible.** Every agent's full formal specification (identity, tools, permissions, risk, autonomy, limits, escalation, cost, evaluation, version, owner) is defined in §39.

---

## 13. Task & Information Pipelines

```
Raw Interaction → Capture → Extraction → Validation → Specialist Analysis
   → Synthesis → Policy → Decision → Execution → Verification → Business Record
```

Voice-call example:

```
Voice Agent → Speech-to-Text → Segmentation → Intent Extraction → Entity Extraction
   → Customer Data Extraction → Fact Verification → Lead Qualification
   → Business Rule Evaluation → CRM Update → Follow-up Action
   → Verification → Owner Summary
```

The orchestrator receives the **validated business result**, not raw noisy model output.

---

## 14. Trust Architecture: Evidence-First, No-Hallucination

The platform never operates on "the model probably knows." The pattern is always:

**Retrieve → Validate → Decide → Execute → Verify.**

Authoritative facts come from systems of record, never from model invention: pricing from pricing systems, inventory from inventory systems, appointment availability from booking systems, customer status from authoritative records, policy rules from policy configuration, financial values from financial systems, regulated decisions never hallucinated. AI interprets and orchestrates authoritative data — it does not invent authoritative facts.

Every consequential decision must be able to answer: what happened, which customer, which agent/model/tools acted, what information was retrieved, which policy/business rule applied, what evidence and confidence existed, whether verification or human approval occurred, what action resulted, and what changed in the business system. Use an immutable or tamper-evident audit/event model for this evidence chain.

**No-hallucination policy:** if authoritative information is unavailable, the agent says so — *"I cannot verify the appointment from the connected system"* — never a confident guess. Unknown stays unknown. Internally (and, where appropriate, in admin/customer-facing explanations) agents must distinguish **fact vs. retrieved information vs. inference vs. prediction vs. recommendation vs. assumption vs. unknown.**

---

## 15. Autonomy Levels & Risk-Based Action Control

| Level | Name | Behavior |
|---|---|---|
| 0 | Observe | Analyze, summarize, recommend — no external action |
| 1 | Suggest | Prepares actions, requires human approval |
| 2 | Low-risk Autonomous | Executes pre-approved low-risk actions |
| 3 | Conditional Autonomous | Executes within explicit thresholds |
| 4 | High Autonomy | Executes multi-step workflows within strict policy boundaries |
| 5 | Strategic Autonomy | Reserved for carefully governed enterprise use cases |

**Never allow unrestricted autonomy by default.** Every agent's autonomy level is a policy-configured value, not a hardcoded default of the highest tier.

Every tool/action carries a risk classification:

| Risk | Examples |
|---|---|
| **LOW** | Retrieve public information, generate internal summary, classify conversation |
| **MEDIUM** | Send customer follow-up, create ticket, update non-critical CRM fields |
| **HIGH** | Issue refunds, change contracts/pricing, make financial commitments, delete records, modify sensitive data |
| **CRITICAL** | Irreversible financial transactions, regulated decisions, sensitive identity/security actions, destructive system actions |

HIGH and CRITICAL actions require stronger policy controls (tighter autonomy caps, mandatory approval, and audit) than LOW/MEDIUM ones.

---

## 16. Human-in-the-Loop

Humans are the exception-handling and governance layer, not a failure of the product. Auto-escalate on: low confidence, conflicting information, policy violations, unusual behavior, high-value transactions, sensitive complaints, security anomalies, legal/safety issues, repeated failures, agent disagreement, uncertain identity, or ambiguous instructions. The dashboard surfaces a prioritized **Human Attention Queue**.

**Agent disagreement is structured information, not something to be forced into agreement:**

```
Sales Agent: "Customer is purchase-ready."
Risk Agent: "Customer information is incomplete."
Policy Agent: "Additional verification is required."
Resolution Agent: "Escalate to human."
```

An independent **Quality Reviewer** (agent or, preferably, deterministic checker where possible) evaluates important completed tasks for factual correctness, policy compliance, tool/action correctness, tone, goal completion, hallucination risk, missing information, data leakage, and security violations. Prefer deterministic validation over another LLM wherever deterministic validation is possible.

---

## 17. Agent Lifecycle: Evaluation, Versioning, Simulation

**Continuous evaluation** uses test datasets, synthetic conversations, anonymized real examples, regression/golden-response tests, tool-execution tests, multilingual evaluation, adversarial and prompt-injection testing, policy/permission testing, latency and cost tests.

**Pre-publish pipeline:**

```
Build → Evaluate → Security Scan → Policy Test → Regression Test
   → Performance Test → Human Approval (where required) → Canary → Production
```

**Versioning states:** draft → testing → staging → canary → production → deprecated → archived. Every deployment is traceable; rollback to a previous known-good version must always be possible.

**Simulation environment:** administrators define scenarios ("Customer asks for refund"), then dry-run the full agent hierarchy — orchestrator → selected agent → sub-tasks → tools → policies → decision → verification → expected result — **without sending real messages or touching production systems.**

---

## 18. Business Memory & Knowledge Fabric

Memory categories: customer, organizational, conversation, workflow, agent, policy, operational, historical. Memory is scoped, permission-aware, tenant-isolated, versioned where required, deletable per policy, auditable, and privacy-aware. **Agents never independently decide what to permanently remember** — memory creation follows policy, across temporary / session / customer / organization / system tiers.

Customers connect documents, PDFs, SOPs, websites, FAQs, CRM/ERP, databases, APIs, cloud storage, spreadsheets, knowledge bases, internal policies, and product catalogues. Ingestion pipeline: `Ingest → Parse → Classify → Validate → Version → Permission → Index → Evaluate`. Every piece of knowledge carries source, owner, timestamp, freshness, access level, confidence, version, expiry, and jurisdiction. Track staleness; let administrators see exactly which documents influenced a given agent output.

---

## 19. Omnichannel Communication & Voice

Channels: website chat, WhatsApp, voice, SMS, email, Instagram, Facebook Messenger, Telegram, mobile app, API, contact center, enterprise messaging. Agent logic is never hardwired to a channel:

```
Channel → Conversation Gateway → Identity → Context → Agent Orchestrator → Execution → Channel Response
```

**Voice is a first-class execution channel** — inbound/outbound calls, campaigns, appointment/lead-qualification/follow-up calls, surveys, reminders, support, human escalation/transfer, voicemail handling, call summaries, structured extraction. Voice agents require consent controls, call-recording policy, disclosure controls, interruption handling, latency targets, fallback behavior, and human-transfer capability. **Do not assume every jurisdiction permits identical recording or automated-calling behavior — compliance must be configurable by geography and use case.**

**The voice pipeline, end to end:**

```
Inbound/Outbound Call → Telephony → Speech-to-Text (STT) → Agent Orchestrator (§12–§14)
   → Text-to-Speech (TTS) → Telephony → Caller
```

Every stage carries its own reliability requirement — voice is not "the text agent with a microphone bolted on":

- **STT confidence gating** — below a configured transcription-confidence threshold, the call routes to a human instead of letting the agent act on a guess. Audio input is inherently noisier than text, so this extends §14's risk-based control to the input side, not just the action side.
- **Dual-provider fallback** — telephony, STT, and TTS each have a configured backup provider; an outage degrades to the backup or to human handoff, never to a dropped or silently broken call. This is §28's failure-recovery toolkit applied specifically to voice.
- **Call quality monitoring** — latency (target sub-1s round-trip), interruption/barge-in handling, and dropped-call rate are tracked per agent per language, feeding the same Agent Health Score and Drift Detection as text (§25).
- **Full evidence chain** — every call produces the same transcript, extracted facts, policy trace, confidence, and outcome record as a text conversation (§14), so a voice call is exactly as auditable as WhatsApp, never a black box because it happened over audio.
- **Accuracy targets follow the same per-risk-tier ceiling as everything else in this document (§37) — voice gets no exemption and no absolute "always correct" claim; it gets the same measured, tiered reliability commitment, backed by the mechanisms above.**

**Voice multilingual support is evaluated separately from text (§20) — it does not follow automatically.** A model that reads and writes fluent Telugu can still transcribe or speak it poorly. Before launching voice in any regional language: benchmark STT accuracy and TTS naturalness for that specific language with native-speaker review, test code-switched speech explicitly (e.g., Telugu + English within the same call, not just clean single-language input), and evaluate India-focused voice providers (built for Indic phonetics and code-mixing natively) alongside global voice platforms (typically English-first) rather than assuming either wins by default. A language counts as "supported" for voice only once STT, TTS, and the underlying agent have each individually cleared this bar — never because the text channel already supports it.

---

## 20. Multilingual / Regional Language System

**India is a first-class market.** Support English, Hindi, Telugu, Tamil, Kannada, Malayalam, Marathi, Bengali, Gujarati, Punjabi, Odia, Urdu, Assamese — with the architecture open to additional languages globally. Support multilingual chat/WhatsApp/email/voice, code-switching, transliteration, regional speech, language-specific knowledge retrieval, and customer-preferred-language memory, including mixed-language conversations (e.g., Telugu + English).

**Do not simply translate literally.** Preserve names, products, locations, dates, currency, domain terms, and customer intent. Language support is evaluated **separately per language** — never advertise a language as supported purely because a model can technically generate it.

---

## 21. Communication Intelligence & Follow-Up Governance

Extract and track over time: intent, urgency, sentiment, dissatisfaction, purchase readiness, objections, preferences, language, intent change, escalation/churn/buying signals (e.g., sentiment Positive→Neutral→Negative, churn probability 18%→41%→73%). The dashboard must explain **why** a score changed.

A unified **Follow-Up Engine** knows who needs follow-up, why, when, on which channel, based on what prior interaction, toward what outcome, at what priority, and who owns the next action — preventing duplicate follow-ups, over-messaging, contradictory messages, and campaigns colliding with support interactions.

A central **Communication Frequency Governor** prevents independent agent teams from repeatedly contacting the same customer, considering recent messages/calls, open support issues, campaign activity, customer preferences, quiet hours, channel limits, and regulatory restrictions.

A **Review/Reputation Agent** handles post-purchase review requests, timing, sentiment, categorization, response suggestions, escalation of negative reviews, and recurring-issue detection. It never fabricates reviews or manipulates customers, and it respects platform policies and applicable regulation.

---

## 22. Business & Predictive Intelligence

A **Business Intelligence / Executive Agent** turns operational activity into answers: what happened, why, what's changing, what needs attention, what opportunity exists, what risk exists, what to do next — every recommendation linked to underlying evidence. An optional **Executive Daily Briefing** surfaces revenue, new leads, conversion, CSAT, at-risk customers, outstanding issues, agent failures, opportunities, risks, and recommended actions — real, actionable information, not a generic AI summary.

Predictive capabilities (churn, conversion probability, LTV, demand/workload forecast, staffing, anomalies, revenue forecast, renewal probability, campaign performance) must always carry model/version, timestamp, confidence, feature provenance where appropriate, evaluation information, and limitations. **Never present a prediction as a fact.**

A **Business Digital Twin** — company → departments → people → customers → products/services → locations → policies → workflows → systems → agents → KPIs → business rules → risks → goals — becomes the context layer for autonomous operations over the long term.

---

## 23. Goals, Rules, Workflows, Builder, Marketplace

**Goal-driven agents:** `Goal → Metrics → Allowed actions → Constraints → Agents → Experiments → Evaluation → Outcome`. A stated business goal is never interpreted as unlimited authority.

**Business Rule Engine:** critical rules live in deterministic, admin-editable configuration, not buried inside prompts (e.g., `IF customer_status = active AND invoice_status = overdue AND overdue_days > 7 THEN trigger approved reminder workflow`).

**Workflow Builder:** visual, node-based (Trigger, Condition, Agent, Tool, API, Human Approval, Delay, Wait for Event, Branch, Parallel, Merge, Retry, Escalate, Notification, End) — no-code for business users, API/config for developers.

**Agent Builder wizard:** `Goal → Capability → Channels → Knowledge → Systems → Permissions → Autonomy → Escalation → Test → Simulate → Approve → Deploy`, complexity hidden by default and exposed under "Advanced Configuration."

**Agent Marketplace:** reusable templates (Lead Qualification, Sales Follow-Up, Appointment, Support, Review, Retention, Win-Back, Voice, Document, CRM, Research, Scheduling, ...) across official/customer-created/partner/certified/industry-specific tiers, each versioned with permissions, supported integrations, capabilities, limitations, risk level, performance metrics, and supported regions/languages.

**Natural-language admin control:** an authorized admin can describe an agent in plain language; the system proposes a structured configuration (trigger, actions, channels, permissions, limits, escalation, cost estimate, risk) for explicit confirmation before deployment. **Natural language must never silently bypass governance.**

**Business Command Center:** a natural-language query surface ("What needs my attention today?", "Why did sales drop yesterday?") whose answers are derived from platform data and linked to evidence.

---

## 24. Cost Intelligence & Model Routing

Track model, token, voice, communication, external API, browser-automation, compute, and storage cost per agent. The key metric is **cost per successful business outcome**, not tokens.

Model routing is provider-agnostic, choosing by task, cost, latency, capability, language, privacy, availability, and risk level, with automatic fallback on provider failure. **Never architect the platform around permanent dependence on a single model provider.**

Agent budgets (daily, monthly, token, communication, voice, tool, API) support threshold actions: 70% warning → 85% optimization → 95% restrict non-critical work → 100% stop per policy.

---

## 25. Observability & Explainability

Track agent availability, task success/failure, latency, retries, tool failures, escalation rate, human-handoff rate, CSAT, hallucination indicators, policy violations, cost, throughput, and outcome rate. Every execution supports an **Agent Trace**: `Event → Agent → Model → Tool → Data → Decision → Action → Verification`, inspectable by an admin.

A **Real-Time Activity Center** shows a live feed with severity states (informational / success / warning / attention / critical). A **Human Attention Center** surfaces only what needs a person: approvals, failed tasks, high-risk decisions, unresolved complaints, low-confidence decisions, unusual activity, security alerts, agent conflicts.

**"Why did the agent do that?"** — every important action supports structured explainability: reason, evidence, policy applied, risk, action taken, verification result. **Never expose hidden chain-of-thought; expose structured decision evidence, rules, retrieved sources, tool actions, and outcome data.**

A **Customer Interaction Explorer** lets admins see, per customer, all interactions/channels/agents, extracted information, sentiment, decisions, actions, outcomes, and follow-ups.

**Agent Health Score** is multidimensional (reliability, quality, policy compliance, latency, cost efficiency, outcome performance, escalation rate, integration health) and its components must always be inspectable — never one opaque number. **Agent Drift Detection** watches these dimensions trend over time (e.g., success 94%→87%, escalations 6%→15%) and triggers investigation. An **Integration Health Center** shows connection status, auth state, last sync/failure, latency, API quota, and errors per integration, with reconnection flows.

---

## 26. Security & Governance

Security is a product feature: encryption in transit and at rest, RBAC, least privilege, tenant isolation, secret/credential vault, audit logging, API protection, rate limiting, session security, retention/deletion workflows, consent and privacy controls, data minimization, export controls, and data residency where applicable. Align to recognized frameworks (NIST AI RMF / GenAI Profile, ISO 27001/27701, SOC 2, GDPR, India DPDP, sector-specific regulation) as a risk-management model. **Never claim "compliant" or a certification that has not actually been obtained.**

AI-specific threats to defend against: prompt injection (direct and indirect), data exfiltration, tool abuse, privilege escalation, malicious documents, poisoned knowledge sources, agent impersonation, unauthorized agent-to-agent access, credential theft, malicious websites/unauthorized browser actions, excessive tool permissions, sensitive-data leakage. Mitigate with a policy engine, tool allowlists, data-access scopes, content isolation, instruction hierarchy, input sanitization, output validation, sandboxing, network restrictions, and secret isolation.

**Emergency controls** — independently protected and audited — at global, per-agent, per-workflow, per-tool, and per-tenant granularity ("kill switches").

**Access control** roles: owner, admin, operations manager, sales manager, support manager, analyst, finance, security administrator, compliance officer, agent operator, read-only, and custom roles, via RBAC (evolving toward ABAC) with department, branch, data-domain, tool, and action restrictions.

**Audit everything consequential**: logins, user/role changes, agent creation/configuration/deployment/execution, tool invocation, customer communication, approvals, data access, policy changes, integration changes, billing changes, security events, emergency actions — with correlation IDs and distributed tracing. Keep the audit/event log separate from operational application state.

**Agent Safety Firewall** — a centralized runtime policy engine, independent from the LLM:

```
Agent Request → Identity Check → Tenant Check → Permission Check → Data Policy
   → Tool Policy → Risk Policy → Business Rule → Approval Check → Execution → Verification
```

**Policy-as-code:** critical rules live in versioned, tested, auditable, deployable, rollbackable configuration — not hidden prompts.

**Mediated tool execution:** agents never hold raw production credentials directly — `Agent → Tool Gateway → Authorization → Scoped Credential → Tool`, not `Agent → Permanent API Secret`.

**Context minimization:** assemble context explicitly via scoped retrieval, filters, masking, and tenant/role boundaries. *"Give an agent the minimum information required to perform its task."* Data carries a classification (public / internal / confidential / sensitive / highly sensitive) that gates agent and tool permissions.

**Customer identity & fraud:** distinguish verified / unknown / uncertain identity states; **never disclose sensitive data solely because a customer asks.** Fraud/abuse detection generates signals for review rather than making unlawful or unsupported unilateral decisions.

---

## 27. Tool, Integration & Automation Governance

Every tool has a formal registry entry: ID, name, description, owner, version, permissions, input/output schema, risk level, rate limits, cost, allowed agents/tenants/environments, audit requirements, approval requirements, timeout, retry policy. **Agents never automatically gain access to every tool.**

The integration layer supports REST, GraphQL where useful, webhooks, OAuth, API keys, service accounts, MCP-compatible tools where appropriate, browser automation, and RPA — never arbitrary internet/tool access by default, always via allowlists, scopes, credential vault, and network/domain/action restrictions. Build the **integration framework first**, then integrations incrementally (Salesforce, HubSpot, Zoho, SAP, Dynamics, Oracle, Shopify, WooCommerce, Stripe, Razorpay, Google Workspace, Microsoft 365, Slack, Teams, WhatsApp, email providers, telephony, accounting, helpdesks, ticketing, calendars, analytics, databases, and more).

**Browser automation** is a controlled tool with session isolation, credential isolation, URL and action allowlists, screenshots, DOM inspection, state/action verification, timeout, retry, recording/audit, and a kill switch. **Never let a generic autonomous agent freely browse and interact with arbitrary websites.**

Autonomous business tasks extend beyond conversation — monitoring leads, updating CRM, following up with prospects, scheduling and summarizing meetings, monitoring complaints, detecting churn/expansion opportunities, preparing reports, flagging overdue tasks and operational anomalies, reconciling selected records, classifying documents, extracting data, preparing business reviews, monitoring service levels, notifying managers of operational risk. **Every such task has explicit boundaries.**

---

## 28. Data Architecture, Events & Reliability

Domain boundaries (avoid one giant model): identity, tenants, users, customers, communications, conversations, agents, agent_teams, tasks, workflows, tools, integrations, knowledge, memory, policies, approvals, audit, observability, billing, analytics, predictions, reviews, campaigns, notifications — event-driven where appropriate.

Event-driven engine reacts to events like `LeadCreated`, `CustomerReplied`, `PaymentReceived`, `PaymentFailed`, `BookingCreated`, `BookingCancelled`, `ReviewPosted`, `TicketCreated`, `CustomerInactive`, `SubscriptionExpiring`, `DocumentUploaded`, `AgentTaskFailed`, `RiskDetected`, `ApprovalRequired`.

Scheduling supports immediate, scheduled, recurring, delayed, and windowed execution, aware of business hours, timezones, regional holidays, and customer preferred communication times, with **idempotency to prevent duplicate execution**. Never message a customer at an inappropriate time.

**Failure recovery toolkit:** retries, backoff, idempotency, duplicate prevention, timeout handling, fallback tool, fallback model, alternate agent, human escalation, compensation workflow, rollback where possible, dead-letter queues. **Never assume external systems always work, and never silently mark a failed action as successful.**

**Database principles:** explicit ownership (`tenant_id`, `organization_id`, `workspace_id` where applicable, `created_by`, `updated_by`, `created_at`, `updated_at`, `version`, `status`), correct indexing, retention/partitioning for unbounded history tables. Keep operational state, events, and audit evidence as separate concerns.

**API/webhook security:** authentication, authorization, scopes, rate limiting, request validation, replay protection, signature verification, idempotency, audit logging. Never blindly trust an incoming webhook.

---

## 29. Reliability Engineering

Define measurable SLOs: API availability, workflow completion, queue processing, integration availability, event/notification delivery for the platform, and task success rate, verified factual accuracy, safe action rate, policy compliance, and escalation correctness for AI. Communicate *"built for reliable autonomous execution,"* never *"AI can never make mistakes."*

**Zero-trust agent model:** assume models can be wrong, tools and integrations can fail, data can be stale, documents can be malicious, customer instructions can be adversarial, agents can misinterpret, and external systems can change. **Trust is established through permissions, evidence, validation, and verification — never through model confidence alone.**

**Customer experience protection:** track complaint rate, opt-outs, repeat-contact rate, frustration, failed resolution, inappropriate escalation, and excessive messaging. On degradation: `Detect → Alert → Restrict → Investigate → Correct`. Never optimize automation at the expense of the customer experience.

---

## 30. Commercial, Extensibility & Deployment

**Billing:** platform subscription plus optional usage-based billing on conversations, agent executions, voice minutes, automation tasks, API usage, integrations, and storage. Enterprise contracts may add minimum commitments, custom limits, private/dedicated infrastructure, regional deployment, advanced support, and custom agents.

**Channel-based service plans:** channel access is a first-order plan dimension, not just a technical toggle. Every tenant subscribes to at least one of three channel plans — **WhatsApp-only**, **Voice-only**, or **Combined** — chosen during onboarding (§4) and changeable like any other subscription upgrade. This is a real product boundary: it determines which integrations get provisioned (WhatsApp Cloud API credentials vs. telephony/STT/TTS credentials vs. both), which settings the Agent Builder wizard exposes (§23 — a WhatsApp-only tenant is never shown telephony configuration it doesn't have), and how billing is metered (voice minutes only accrue for tenants who opted into voice). Within each channel choice, plan tiers still follow the volume/agent-count/autonomy structure and the Simple/Expert split in §31.

**White-label / OEM readiness:** architect for future partner resellers, agencies, franchise networks, enterprise groups, embedded AI workforce, and API-only customers, with configurable tenant branding.

**API-first:** everything important (tenants, agents, workflows, tasks, conversations, customers, executions, analytics, events, integrations, policies) is exposed through secure APIs, with webhooks for important events. A future developer platform layer (Xylarc SDK, Agent SDK, Tool SDK, Workflow SDK, Events, Webhooks) lets developers build custom agents and tools, extended by a **plugin/extension model** with permission manifests (agents, tools, channels, integrations, dashboards, workflow actions, industry packs, analytics modules).

**Industry packs** compose on top of Xylarc Core (Healthcare Pack, Retail Pack, Finance Pack, Logistics Pack, Hospitality Pack, Education Pack, ...), each bundling templates, agents, workflows, compliance rules, dashboards, terminology, and integrations — instead of separate products built from scratch.

**Deployment models:** shared SaaS, regional SaaS, dedicated tenant, private cloud, enterprise-managed environment. Do not implement every variant immediately — keep the architecture deployment-aware from day one. Design for internationalization (languages, currencies, timezones, date formats, regional practices), data residency (region, jurisdiction, storage location, processing policy, preventing unauthorized cross-region processing where required), and enterprise-contractual controls (customer-specific retention, model/provider/tool restrictions, logging requirements, access policies, SLAs).

---

## 31. Admin Experience & Visual Design

Core navigation: Overview · Customers · Conversations · Digital Workforce · Agents · Agent Teams · Tasks · Workflows · Knowledge · Integrations · Automation · Approvals · Attention Center · Analytics · Business Intelligence · Reviews · Campaigns · Security · Audit · Billing · Settings — with **progressive disclosure** so the interface never overwhelms.

**Simple Mode** ("I want to automate lead follow-up" → the platform asks only essential questions and recommends an initial workforce) and **Expert Mode** (agent policies, tools, model routing, permissions, workflow graphs, data scopes, evaluation, deployment strategy, compliance, observability, budgets) sit on **one architecture, two complexity levels.**

Visual language: futuristic, enterprise-grade, intelligent, trustworthy, clean, high-performance, premium, minimal, data-rich. Avoid childish chatbot aesthetics, generic AI purple gradients, excessive animation, noisy dashboards, unnecessary 3D, and meaningless AI decoration; every chart must be actionable or informative (lifecycle funnel, customer journey, agent hierarchy, workflow graph, operations timeline, KPI cards, trend lines, cohort charts, churn map, geographic activity, agent health matrix, workload distribution, automation savings, sentiment, review intelligence, opportunity/risk matrix). An optional **Real-Time Agent Map** visualizes orchestrator → teams → fleets → customers/cases/workflows, click-through to execution traces.

**Typography and color follow a deliberate, named token system — never framework defaults left untouched.** A bounded palette (4–6 named colors, not an open theme picker) and typefaces assigned by role, not one family stretched over everything: a display face for headlines and hero numbers, a body face for UI text and tables, and a monospace face for IDs, logs, and numeric tables where digit alignment matters. A reasonable starting point for this platform's register — a geometric or grotesk sans (e.g., Inter or IBM Plex Sans) for display and body, paired with a matching mono (e.g., IBM Plex Mono or JetBrains Mono) for data — but this is a placeholder for an actual design pass, not a final answer. Whatever is chosen, avoid the recognizable generic-AI-dashboard defaults (a cream background with a high-contrast serif and one warm accent color; a near-black theme with a single neon accent; a hairline-rule broadsheet layout) — the choice should come from Xylarc's own register (§2–§5), not a design tool's default output.

**Match chart type to what the data actually says, not to habit:** trend lines for change over time, funnels for conversion stages, heatmaps for time-of-day/day-of-week density (e.g., call volume by hour for voice tenants, §19), network/graph views for agent hierarchy and relationships, cohort grids for retention. A bar chart because it's the default is exactly the "meaningless AI decoration" this document already rules out above.

The **mobile experience** covers alerts, approvals, summaries, agent status, critical metrics, the Human Attention Queue, and emergency controls — it does not attempt full desktop parity.

Customers also get a **Privacy Center** (what data is stored, its origin, which agents accessed it, retention, access, deletion/export, connected systems), **data lineage** views (`Source → Extraction → Transformation → Agent → Decision → Action`), and visible **information freshness** on every fact (e.g., *"Product price — Source: ERP — Updated: 2 minutes ago — Freshness: Current"*) so stale knowledge never appears authoritative.

---

## 32. Engineering & Testing Standards

Development discipline: `Understand → Inspect → Architect → Design → Implement → Test → Threat Model → Evaluate → Observe → Deploy`. **Never jump directly from request to code.**

Testing pyramid: unit, integration, API, workflow, agent, tool, security, permission, multilingual, regression, load, failure, disaster-recovery, and end-to-end tests — plus agent-specific golden tests, adversarial tests, prompt-injection tests, tool-abuse tests, hallucination tests, and policy regression suites.

**Quality gate before production:** Functional + Security + Reliability + Performance + Evaluation + Policy + Observability + Rollback. *"It works in the demo"* is never sufficient on its own.

Strict environment separation (development / test / staging / production); a **demo/sandbox mode** using mock integrations, sandbox credentials, fake customers, simulated tool calls, and dry-run mode that can never accidentally send real customer messages, make payments, or change production records; feature flags for tenant-specific rollout of new agents, models, tools, and workflows.

**Frontend and backend stay contract-locked, not just environment-separated:** the API is versioned, the frontend targets a specific version explicitly, and a backend change that could break a deployed frontend ships behind a flag or a new version path — never a silent breaking change. Deploy backend before frontend for additive changes; deploy frontend before backend only when it still works against the current API. Every deploy is a one-step rollback, not a forward-only bet — this extends §17's agent-versioning discipline to the platform itself.

**Backward compatibility:** existing Xylarc products must not break. The platform coexists with prior/parallel Xylarc systems (e.g. a healthcare automation deployment, a compliance-copilot product). Shared infrastructure is abstracted carefully, without tight product coupling.

---

## 33. Roadmap

| Phase | Focus |
|---|---|
| **1 — Platform Core** | Tenant management, organizations, auth, Customer 360, conversations, basic agent orchestration, agent management, workflows, integrations, dashboard, audit, permissions |
| **2 — Customer Lifecycle** | Lead / sales / support / booking / follow-up / retention / review agents, multilingual, voice |
| **3 — Autonomous Workforce** | Agent teams, hierarchical orchestration, event-driven autonomy, advanced workflow engine, business intelligence, predictive intelligence, approvals, agent health, cost intelligence |
| **4 — Enterprise Control Plane** | Governance, advanced policy engine, simulation, evaluation, benchmarking, deployment lifecycle, enterprise security, multi-region, advanced audit |
| **5 — Business Autonomy** | Goal-driven agents, business digital twin, optimization, experimentation, predictive operations, agent marketplace, developer platform, industry packs |

**Do not attempt every phase at once.** Before adding a capability, determine which phase the repository is actually in and inspect what already exists.

---

## 34. Competitive Positioning

Differentiate through: one AI workforce instead of isolated bots; hierarchical multi-agent organization; cross-department orchestration; customer lifecycle intelligence; business operational automation beyond conversation; evidence-backed autonomous execution; a real agent control plane; agent governance and observability; business-outcome measurement; regional-language-first architecture; enterprise security; human exception management; one unified business command center.

**Never claim "no one else provides this."** Maintain a living competitive matrix (capability × Xylarc × competitors × market maturity × differentiation × difficulty × potential moat) and continuously research the real landscape — enterprise agent platforms, customer engagement platforms, voice-agent platforms, and workflow automation platforms among them. Seek genuine architectural moats: orchestration quality, the business digital twin, accumulated workflow/evaluation data, the lifecycle graph, verified execution records, industry packs, governance depth, outcome intelligence, and integration/operational-data network effects. **Model choice alone is not a moat.**

---

## 35. Outcome Measurement

Track cost per resolved interaction, cost per qualified lead, cost per booking, cost per retained customer, cost per successful workflow, human hours avoided, revenue influenced/generated, customer retention, and customer satisfaction — always asking *"is the AI workforce actually improving the business?"*

Generate a periodic **Client Value Report** (tasks completed, customers contacted, issues resolved, leads qualified, bookings created, revenue influenced, customers retained, hours avoided, escalations, agent failures, top opportunities/risks, recommended improvements) — **every number traceable to its evidence.**

Xylarc's own platform-owner dashboard tracks tenants, agents deployed, executions, uptime, growth, agent success, integration failures, usage, revenue, churn, support demand, high-risk events, feature adoption, and model/infrastructure costs — **never exposing one tenant's confidential information to another.**

---

## 36. North Star & Product Philosophy

**North star: Verified Autonomous Business Outcomes — not conversation count.**

- AI should reason.
- Rules should constrain.
- Tools should execute.
- Databases should remain authoritative.
- Policies should govern.
- Verification should validate.
- Observability should expose.
- Humans should handle exceptions.
- Businesses should measure outcomes.

---

## 37. Reliability Commitment & Forward-Looking Upgrades

**On "100% accurate and reliable":** no credible engineering organization — not in aviation, medical devices, or finance — promises 100% accuracy from any AI-involved or large-scale distributed system, and this document already rules that claim out (§29; Operating Instruction #15, "Never claim AI is infallible"). The stronger, credible version of that goal is: **the highest achievable accuracy per risk tier, backed by redundancy and independent verification, with automatic containment the moment real performance falls short of target** — a system that degrades safely instead of failing silently or overclaiming. Publish target accuracy/reliability *ranges* per risk tier (e.g., LOW ≥ 99%, MEDIUM ≥ 99.5%, HIGH ≥ 99.9%, CRITICAL always requires human sign-off regardless of model confidence) and report measured performance against them via Agent Health Score and Agent Drift Detection (§25).

Mechanisms that actually close the gap toward that ceiling:

- **Ensemble / cross-model verification** — HIGH and CRITICAL actions get an independent second check, from a different model or a deterministic validator, before execution; disagreement routes to a human (extends the Agent Disagreement System, §16).
- **Error-budget-linked autonomy throttling** — each agent carries a rolling error budget per risk tier; exhausting it automatically steps that agent's autonomy level down (e.g., Level 3 → Level 1) until a human reviews it, wiring §15 (Autonomy) directly into §25 (Observability) instead of leaving autonomy as a static setting.
- **Chaos engineering** — scheduled fault injection (killed integrations, slow APIs, malformed data) against staging/canary, proving failure paths actually work rather than assuming they do.
- **Synthetic transaction monitoring** — continuous automated "fake customer journeys" through critical paths (booking, payment, escalation) in production, catching breaks before a real customer does.
- **Self-healing infrastructure** — circuit breakers and bulkheads around every integration, auto-restart/auto-rollback playbooks for known failure signatures, so a human is only paged for what doesn't already have a proven auto-remediation.
- **Formal verification for policy-as-code** — critical business rules and approval thresholds get static analysis and property-based testing, not just example-based unit tests, before deployment.

Forward-looking capabilities worth architecting room for, sequenced into later roadmap phases (§33):

- **Multimodal agents** that read images, scanned documents, and video where the business needs it (damage photos, ID verification, product photos), under the same evidence and risk-classification rules as text.
- **Business knowledge graph** alongside vector search, so agents can answer relationship questions ("which accounts share a billing contact with this at-risk customer?") that embedding retrieval alone handles poorly.
- **Outcome-verified continuous improvement** — agent behavior improves only through a human-reviewed pipeline trained on *verified-correct* past outcomes (§17), never through silent, automatic self-modification from live traffic.
- **Deepfake / voice-clone detection** on the voice channel, a natural extension of §19's consent-gated voice architecture as cloning gets cheaper and fraud risk rises.
- **Continuous adversarial red-teaming and a bug-bounty program** against the Agent Safety Firewall (§26), not just a one-time check at each release gate.

And on "simpler usage" specifically:

- **Adaptive disclosure** — evolve Simple/Expert mode (§31) from a binary toggle into a spectrum, where the UI reveals more controls automatically as an admin demonstrates comfort with the ones already shown, instead of forcing an upfront choice.
- **Proactive setup co-pilot** — beyond the reactive natural-language config in §23, let the platform *suggest* likely-useful changes in plain language ("your booking agent's no-show rate rose 12% this week — enable a reminder call?"), always presented for confirmation, never auto-applied.
- **Command palette** so power users can jump to any tenant, agent, workflow, or record without menu-diving.
- **WCAG 2.1 AA accessibility** as an explicit, testable requirement for the admin dashboard and mobile app, not an afterthought — the original spec never mentions accessibility, and it belongs in a "production-grade" platform.

Most of this section belongs in Phase 4/5 of the roadmap (§33) — only the honest reliability framing at the top should be true starting Phase 1. Adding capability here is not license to build all of it now; see §43 (Final Directive).

---

## 38. Claude Code — Operating Instructions

When working on this repository, always:

1. Read this CLAUDE.md before modifying the product.
2. Inspect the existing codebase before proposing architecture changes — do not assume the repo is empty.
3. Preserve working functionality.
4. Prefer modular architecture.
5. Avoid unnecessary rewrites.
6. Never hardcode secrets.
7. Never bypass tenant isolation.
8. Never bypass authorization.
9. Never expose sensitive customer data.
10. Never make unrestricted autonomous tools.
11. Never assume external integrations are reliable.
12. Never silently mark failed actions as successful.
13. Never fabricate business information.
14. Never claim certifications or compliance that do not exist.
15. Never claim AI is infallible.
16. Use deterministic logic for critical business rules.
17. Use structured schemas for agent communication.
18. Test all consequential workflows.
19. Add observability to new production capabilities.
20. Add auditability to consequential actions.
21. Provide rollback mechanisms for significant deployments.
22. Prefer configuration over hardcoded business logic.
23. Keep customer-facing simplicity while preserving deep enterprise controls.
24. Treat security and privacy as architectural requirements.
25. Treat agent governance as a first-class subsystem.
26. Validate important outputs before execution.
27. Verify important actions after execution.
28. Escalate uncertainty rather than inventing answers.

---

## 39. Definition-of-Done Checklists

**New agent** — not production-complete until it defines: Purpose · Owner · Inputs · Outputs · Knowledge · Tools · Permissions · Risk · Autonomy level · Limits (cost/time/concurrency/communication) · Data access scope · Model policy · Fallback model · Escalation rules · Verification approach · Evaluation tests · Success metrics · Failure conditions · Version · Rollback plan · Audit hooks.

**New tool** — must define: Input schema · Output schema · Permissions · Risk class · Allowed agents · Allowed tenants · Authentication · Timeout · Retry policy · Idempotency · Audit requirements · Failure behavior.

**New workflow** — must define: Trigger · Input · Steps · Conditions · Agents · Tools · Permissions · Approvals · Timeouts · Retries · Fallback · Compensation · Verification · Success condition · Failure condition · Audit · Metrics.

**New dashboard metric** — must define: Name · Definition · Source · Calculation · Time window · Tenant scope · Refresh frequency · Accuracy limitations · Drill-down path. No vanity metrics.

---

## 40. Incident Protocol: When AI Output Is Wrong

Do not merely patch the response. Trace the failure through the pipeline it actually passed through:

```
Input → Context → Retrieval → Model → Tool → Policy → Execution → Verification
```

Identify the failing layer, then add whichever is appropriate: a regression test, a guardrail, a validation step, a policy change, improved retrieval, or a workflow correction.

---

## 41. Feasibility Classification

Never fake feasibility. Classify honestly as: **Production-ready** · **Prototype-ready** · **Research-stage** · **Technically possible but expensive** · **Regulated/restricted** · **Not currently reliable enough** — and recommend a safer architecture where a request falls short.

---

## 42. Conflict Resolution Priority Order

When requirements conflict, resolve in this order:

**Safety → Security → Privacy → Correctness → Compliance → Reliability → Data integrity → User trust → Business outcome → Performance → Cost → Convenience.**

Never optimize cost or convenience by violating a higher-priority requirement.

When asked to design or implement any subsystem, always produce: architecture, data model, APIs, security model, agent model, workflow model, observability plan, testing strategy, failure handling, and deployment considerations — then implement only what is appropriate for the current roadmap phase.

---

## 43. Final Directive

Before implementing anything substantial: inspect the repository and determine what already exists. Do not assume the repository is empty. Do not replace production systems unnecessarily. Do not create duplicate infrastructure. Do not create fake integrations. Do not use mock data in production paths. Do not hardcode credentials. Do not bypass security or tenant isolation. Do not claim unsupported capabilities.

Build Xylarc as though it will eventually serve enterprises whose daily operations depend on it. The standard is not *"the demo works."* The standard is:

> **The business can trust the system to perform the approved work, prove what it did, detect when it cannot safely proceed, and recover when something fails.**
