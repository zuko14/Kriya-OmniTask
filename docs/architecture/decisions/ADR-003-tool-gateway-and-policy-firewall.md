# ADR-003: Mediated Tool Gateway & Agent Safety Firewall

**Status:** Accepted  
**Date:** 2026-08-15  
**Deciders:** Principal AI Systems Architect & Security Engineering Team  

---

## Context
Granting autonomous agents direct access to raw production credentials or unrestricted external APIs introduces severe security vulnerabilities, including credential theft, prompt injection exploits, and unauthorized data exfiltration (§26, §27 of `CLAUDE.md`).

## Decision
1. **Mediated Tool Gateway:**
   - Agents never possess raw API keys, database credentials, or system access tokens.
   - All tool executions are brokered through a centralized `ToolGateway`.
   - Tool requests are evaluated against the `AgentSafetyFirewall` (Policy-as-Code) before execution.
2. **Policy Enforcement Lifecycle:**
   ```text
   Agent Tool Request 
      ──> 1. Authentication & Tenant Boundary Validation
      ──> 2. Agent Permission Check (Role & Capability)
      ──> 3. Risk Tier Assessment (LOW, MEDIUM, HIGH, CRITICAL)
      ──> 4. Autonomy Level Gate (0 to 5)
      ──> 5. Approval Gate Check (If HIGH/CRITICAL or Low Confidence)
      ──> 6. Short-Lived Scoped Credential Injection
      ──> 7. Sandboxed Execution (with timeout, retry, & rate limits)
      ──> 8. Deterministic Output Schema Validation
      ──> 9. Cryptographic Audit Log Recording
   ```
3. **Emergency Controls (Kill Switches):**
   - Independent, tamper-evident kill switches allow operators and customers to immediately freeze tools, specific agents, entire workflows, or whole tenant execution pipelines.

## Consequences
- Positive: Defense-in-depth protection against prompt injection, credential exfiltration, and unauthorized actions.
- Trade-off: Small latency overhead for policy evaluation and audit recording (mitigated through in-memory policy compilation).
