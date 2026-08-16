# ADR-002: Hierarchical Agent Orchestration & Typed Schema Contracts

**Status:** Accepted  
**Date:** 2026-08-15  
**Deciders:** Principal AI Systems Architect & Agentic AI Team  

---

## Context
A flat pool of uncoordinated chatbots or free-form LLM wrappers lacks predictability, creates cognitive overload, and leads to unprovable execution states (§12, §13, §14 of `CLAUDE.md`). Enterprise workflows require structured task delegation, clear domain boundaries, and deterministic result contracts.

## Decision
1. **Hierarchical Topology:**
   - **Business Orchestrator:** Classifies customer/business intent, decomposes goals into domain tasks, delegates to Manager Agents, and synthesizes outcomes.
   - **Manager Agents (Strategy, Operations, Sales, CS, Support, Booking, Retention):** Manage domain-specific state, enforce domain policies, and delegate sub-tasks to Specialist Agents.
   - **Specialist Agents (Voice, Extraction, CRM, Research, Qualification):** Narrow scope, single responsibility.
2. **Typed Communication Contracts:**
   - Internal agents never exchange unvalidated raw natural language strings.
   - All tasks and results conform to strictly typed Zod schemas containing:
     - `taskId` (UUID)
     - `status` (`completed` | `failed` | `waiting_approval` | `escalated` | `blocked`)
     - `facts` (Array of verified facts with source attribution)
     - `evidence` (Array of source documents / system records)
     - `confidence` (Float 0.0 to 1.0)
     - `risks` (Array of identified operational/compliance risks)
     - `policyFlags` (Array of policy evaluations)
     - `requiresApproval` (Boolean)
3. **Deterministic Verification Layer:** Consequential outcomes (pricing, bookings, refunds, contract changes) are verified by deterministic validators against authoritative systems of record before committing.

## Consequences
- Positive: Predictable execution, complete auditability, explainability for every business action, and zero hidden hallucinations in core business data.
- Trade-off: Schema definitions must be maintained and versioned alongside agent capabilities.
