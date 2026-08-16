# ADR-001: Multi-Tenant Foundation & Context Isolation Architecture

**Status:** Accepted  
**Date:** 2026-08-15  
**Deciders:** Principal AI Systems Architect & Enterprise Core Team  

---

## Context
Xylarc AI is an enterprise-grade multi-tenant platform designed to serve multiple organizations, workspaces, business units, departments, and franchise locations. Complete isolation between tenant data, memory, knowledge, agent executions, logs, and configuration is an absolute invariant (§6, §26 of `CLAUDE.md`). Data leaks across tenants are unacceptable.

## Decision
1. **Tenant Context Propagation:** Implement Node.js `AsyncLocalStorage` via a strict `TenantContextManager`. Every inbound request, background job, event handler, and agent execution must initialize and run within an immutable `TenantContext` containing:
   - `tenantId` (UUID)
   - `organizationId` (UUID)
   - `workspaceId` (UUID, optional)
   - `userId` (UUID, optional)
   - `roles` (Array of role strings)
   - `correlationId` (UUID for end-to-end tracing)
2. **Database Layer Enforcement:**
   - Every database table carrying business, customer, agent, or operational data includes a mandatory `tenant_id` foreign key.
   - All repository and data access queries automatically enforce `WHERE tenant_id = context.tenantId`.
   - Cross-tenant queries are structurally disallowed at the data access abstraction layer.
3. **Hermetic Testing:** Tenant isolation test suites must prove that Tenant A cannot read, mutate, or observe Tenant B's data under any condition.

## Consequences
- Positive: Zero risk of accidental cross-tenant data exposure, complete audit attribution, and transparent compliance with GDPR and India DPDP regulations.
- Trade-off: Every internal service and async worker must explicitly inherit or validate the tenant context.
