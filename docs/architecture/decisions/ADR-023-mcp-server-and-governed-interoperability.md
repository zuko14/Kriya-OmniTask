# ADR-023 — Kriya Model Context Protocol (MCP) Server & Governed Interoperability

**Status:** Accepted · 2026-10-02 · Session 22 (WP-5.7, decision D23)

## Context
External AI clients and developer platforms (Claude Desktop, Cursor, external multi-agent orchestrators) require standard mechanisms to discover and execute actions within enterprise software ecosystems.
The Model Context Protocol (MCP, Anthropic 2024-11-05 standard) has emerged as the open industry specification for agentic tool discovery, resources, and execution.
However, exposing raw enterprise tools directly to autonomous external models without governance creates extreme financial, security, and reputational liability:
1. External agents can call irreversible or high-value financial actions without authorization.
2. Actions execute without cryptographic evidence, creating plausible deniability.
3. Tenant isolation and permissions can be bypassed if tool endpoints lack cryptographic context scoping.

## Decision
1. **MCP Server Implementation (`src/interop/mcp/`)**:
   - Built a compliant Model Context Protocol server (`kriya-omnitask-mcp`) supporting protocol version `2024-11-05` and JSON-RPC 2.0.
   - Dual-transport architecture:
     - **Fastify HTTP Endpoint (`POST /api/v1/mcp`)**: Supports single and batch JSON-RPC 2.0 requests, authenticated via JWT Bearer token or API key (`x-kriya-api-key`), scoped strictly to the caller's tenant via `TenantContextManager`.
     - **Stdio Stream Transport (`src/interop/mcp/transport/stdioTransport.ts` & `cli.ts`)**: Enables duplex line-delimited JSON-RPC 2.0 streaming over standard I/O for local agent tools and developer runners.
2. **Kriya Governance & Mandate Gating**:
   - Tools are mapped to Kriya Risk Tiers (`T0 Inform`, `T1 Reversible`, `T2 Consequential`, `T3 Irreversible`).
   - All `T2 Consequential` and financial actions require explicit delegated authority via `MandateService.authorize(...)`.
   - Actions exceeding per-action or daily financial limits are blocked deterministically with structured `[MANDATE OVER LIMIT]` or `[MANDATE DENIED]` refusals.
   - All `T3 Irreversible` actions (e.g. `financial_issue_refund`) strictly block autonomous external MCP execution (`[HUMAN GATE REFUSAL]`), mandating human approval in Kriya Attention Center.
3. **Target System Read-Back Verification & Proof Receipts**:
   - Consequential actions trigger read-back verification (`tool.verify()`) against the system of record.
   - Every completed action automatically produces an Ed25519-signed, SHA-256 hash-chained `ProofReceipt` via `ProofService.issue(...)`.
   - The signed receipt is returned directly in the MCP tool response and is verifiable offline via `verifyReceiptOffline(...)`.

## Consequences
- External agents can securely execute Kriya workforce tools without risk of unmonitored financial or operational damage.
- Every external MCP invocation produces undeniable cryptographic proof linkage.
- Zero third-party MCP SDK dependencies introduced; implemented using clean native TypeScript conforming to JSON-RPC 2.0.
