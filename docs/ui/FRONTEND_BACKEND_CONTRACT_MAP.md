# Frontend ↔ Backend Contract Map (Phase 1)

Seeded with exactly what Phase 1 builds. Later phases append rows as new pages are added — this doc is not written speculatively ahead of the pages that use it.

## Shared contracts

**Error envelope** (`src/core/errors/errors.ts`, applied to every route): all errors return
```
{ "error": { "code": string, "message": string, "statusCode": number, "correlationId"?: string, "details"?: object } }
```
`statusCode` semantics the frontend branches on: `401` = not authenticated / expired token → clear session, redirect to `/login`. `403` = authenticated but RBAC-denied → render an in-page "Access Denied" state, do not redirect.

**Auth**
| Method + Path | Auth | Request | Response |
|---|---|---|---|
| `POST /api/v1/auth/login` | none | `{ tenantSlug, email, password }` | `{ accessToken, user: { id, email, fullName, roles: string[] }, tenant: { id, name, slug, planTier, channelPlan } }` |
| `GET /api/v1/auth/me` | Bearer | — | `{ user: { id, email, fullName, roles }, tenant: { id, name, slug, planTier, channelPlan } }` |

JWT payload (`src/security/auth/jwt.ts`): `{ userId, tenantId, organizationId?, roles, email, iat, exp }`, HS256, ~1hr expiry, **no refresh-token endpoint** — a 401 after expiry is expected and handled by redirect-to-login, not silent renewal.

## Page: `/app/overview` (Client plane) — `web/src/pages/app/ExecutiveOverview.tsx`

| Method + Path | Required permission | Response shape used | UI element |
|---|---|---|---|
| `GET /api/v1/attention/items?status=pending` | `customer:read` | `{ items: AttentionItemRecord[], count }` — record fields (snake_case DB row): `id, title, description, priority, status, reason_category, assigned_user_id, created_at`. `status` enum is `pending \| claimed \| resolved \| dismissed \| timed_out` — verified live against a running server (an earlier `status=open` guess 500'd with a ZodError; caught by end-to-end verification, not by typecheck/unit tests, since request-shape mismatches aren't caught by either) | "Needs Attention" KPI card (count) + top items |
| `GET /api/v1/cost/records?limit=20` | `tenant:read` | `{ records: CostAttributionRecord[], count }` — record fields (camelCase): `id, agentId, costCategory, provider, totalCostUsd, createdAt` | "Recent Spend" card (sum of `totalCostUsd`, latest records) |
| `GET /api/v1/bi/briefings?startDate=&endDate=` | `audit:read` | `{ briefings: ExecutiveBriefingRecord[], count }` — record fields (snake_case): `id, briefing_date, title, summary_markdown, status` | "Latest Briefing" card |

`audit:read` is not held by every role (e.g. `sales_manager`, `support_manager`, `agent_operator`, `read_only` lack it per `src/security/rbac/rbac.ts`) — the briefing card renders its own 403 state independently of the other two cards succeeding.

## Page: `/app/attention` (Client plane) — `web/src/pages/app/HumanAttention.tsx`

| Method + Path | Required permission | Response shape used | UI element |
|---|---|---|---|
| `GET /api/v1/attention/metrics` | `customer:read` | `AttentionMetricsOverview { totalItems, pendingCount, claimedCount, resolvedCount, slaBreachCount, activeTakeoversCount, avgResolutionMinutes }` | Top metrics strip |
| `GET /api/v1/attention/items?status=&priority=&limit=50` | `customer:read` | `{ items: AttentionItemRecord[], count }` | Attention queue `DataTable` with status & priority filters |
| `POST /api/v1/attention/items/:id/claim` | `customer:write` | `AttentionItemRecord` | "Claim" button in row actions |
| `POST /api/v1/attention/items/:id/resolve` | `customer:write` | `AttentionItemRecord` (body: `{ action, notes?, overridePayload? }`) | Resolution modal verdict & audit notes submission |
| `POST /api/v1/attention/takeovers` | `customer:write` | `ConversationTakeoverRecord` (body: `{ customerId, channel, reason }`) | "Takeover" button for live agent intervention |
| `POST /api/v1/attention/takeovers/:customerId/handback` | `customer:write` | `{ success, customerId, handedBack: true }` | Handback action from active takeover |

## Page: `/app/customers` (Client plane) — `web/src/pages/app/CustomerList.tsx`

| Method + Path | Required permission | Response shape used | UI element |
|---|---|---|---|
| `GET /api/v1/customers?q=&lifecycleStage=&limit=50` | `customer:read` | `{ customers: CustomerRecord[], total: number }` | Customer directory `DataTable` with search and stage filters |
| `POST /api/v1/customers` | `customer:write` | `{ customer: CustomerRecord }` (body: `{ fullName, primaryEmail?, primaryPhone?, preferredChannel, lifecycleStage }`) | New customer modal form |

## Page: `/app/customers/:id` (Client plane) — `web/src/pages/app/CustomerDetail.tsx`

| Method + Path | Required permission | Response shape used | UI element |
|---|---|---|---|
| `GET /api/v1/customers/:id` | `customer:read` | `Customer360View { profile, identities, timeline, consents, signals }` | Header card, signals grid, timeline events list, identities list, and consent records |
| `POST /api/v1/customers/:id/consent` | `customer:write` | `{ consent: CustomerConsentRecord }` (body: `{ consentType, status, source }`) | Toggle regulatory consent buttons |
| `GET /api/v1/customers/:id/export` | `customer:read` | `CustomerExportPackage { customer, identities, timeline, consents, exportedAt }` | GDPR Article 20 JSON data portability export download |
| `DELETE /api/v1/customers/:id` | `customer:write` | `{ success: true, message: string }` | GDPR Article 17 Right to Erasure / permanent anonymization |

## Page: `/app/conversations` (Client plane) — `web/src/pages/app/Conversations.tsx`

| Method + Path | Required permission | Response shape used | UI element |
|---|---|---|---|
| `POST /api/v1/channels/send` | `customer:write` | `{ status: string, messageId?: string }` (body: `{ channel, recipient, messageType, payload, customerId?, idempotencyKey }`) | Outbound message dispatcher form |

## Page: `/app/agents` (Client plane) — `web/src/pages/app/AgentFleet.tsx`

| Method + Path | Required permission | Response shape used | UI element |
|---|---|---|---|
| `GET /api/v1/agents?category=&department=&status=` | `agent:read` | `{ agents: AgentRecord[] }` | Fleet metrics and `DataTable` with category, department, and status filters |
| `POST /api/v1/agents/bootstrap` | `agent:write` | `{ status: 'bootstrapped', createdCount: number, agents: AgentRecord[] }` | "Bootstrap Templates" action button |
| `POST /api/v1/agents` | `agent:write` | `{ agent: AgentRecord }` (body: Agent registration spec) | Register new agent modal form |
| `POST /api/v1/agents/:id/transition` | `agent:deploy` | `{ status: 'transitioned', agent: AgentRecord, event: any }` (body: `{ action, reason, metadata? }`) | Quick Activate, Pause, Resume row action buttons |

## Page: `/app/agents/:id` (Client plane) — `web/src/pages/app/AgentDetail.tsx`

| Method + Path | Required permission | Response shape used | UI element |
|---|---|---|---|
| `GET /api/v1/agents/:id` | `agent:read` | `{ agent: AgentRecord }` | Header card, specs grid (Autonomy, Risk, Model Policy, Tools), system prompt preview |
| `GET /api/v1/agents/:id/history` | `agent:read` | `{ history: AgentLifecycleEventRecord[] }` | Lifecycle state transition history `DataTable` |
| `POST /api/v1/agents/:id/transition` | `agent:deploy` | `{ status: 'transitioned', agent: AgentRecord, event: any }` (body: `{ action, reason }`) | Publish, Activate, Pause, Resume, Recover action buttons |
| `DELETE /api/v1/agents/:id` | `agent:write` | `{ status: 'deleted', agentId: string }` | Deregister agent with explicit confirmation modal |

## Page: `/app/workflows` (Client plane) — `web/src/pages/app/WorkflowList.tsx`

| Method + Path | Required permission | Response shape used | UI element |
|---|---|---|---|
| `GET /api/v1/workflows` | `workflow:read` | `{ total: number, workflows: WorkflowDefinitionRecord[] }` | Workflows metrics and `DataTable` |
| `GET /api/v1/workflows/approvals` | `attention:read` | `{ total: number, approvals: WorkflowApprovalRequestRecord[] }` | Pending human approval gates strip |
| `POST /api/v1/workflows/approvals/decide` | `attention:approve` | `WorkflowExecutionRecord` (body: `{ executionId, stepId, decision, notes? }`) | Approve / Reject action buttons |
| `POST /api/v1/workflows` | `workflow:write` | `WorkflowDefinitionRecord` (body: Workflow definition DAG) | Create workflow definition modal form |
| `POST /api/v1/workflows/:slug/trigger` | `workflow:execute` | `WorkflowExecutionRecord` (body: `{ context?, correlationId? }`) | Trigger execution row action button |

## Page: `/app/workflows/:slug` (Client plane) — `web/src/pages/app/WorkflowDetail.tsx`

| Method + Path | Required permission | Response shape used | UI element |
|---|---|---|---|
| `GET /api/v1/workflows/:slug` | `workflow:read` | `WorkflowDefinitionRecord` | Header info card, visual DAG step pipeline inspector |
| `GET /api/v1/workflows/executions` | `workflow:read` | `{ total: number, executions: WorkflowExecutionRecord[] }` | Recent workflow executions `DataTable` |
| `POST /api/v1/workflows/:slug/trigger` | `workflow:execute` | `WorkflowExecutionRecord` | Trigger execution action button |
| `DELETE /api/v1/workflows/:slug` | `workflow:write` | `{ success: true, slug: string }` | Delete workflow pipeline with confirmation modal |

## Page: `/app/bi` (Client plane) — `web/src/pages/app/BusinessIntelligence.tsx`

| Method + Path | Required permission | Response shape used | UI element |
|---|---|---|---|
| `GET /api/v1/bi/briefings` | `audit:read` | `{ briefings: ExecutiveBriefingRecord[], count: number }` | Past briefings list sidebar & active briefing viewer |
| `POST /api/v1/bi/briefings/generate` | `audit:read` | `ExecutiveBriefingRecord` | On-demand briefing generation button |
| `POST /api/v1/bi/briefings/:id/deliver` | `audit:read` | `{ success: boolean, messageId: string }` (body: `{ recipientPhoneNumber }`) | WhatsApp outbound broadcast delivery modal |

## Page: `/app/analytics` (Client plane) — `web/src/pages/app/AnalyticsDashboard.tsx`

| Method + Path | Required permission | Response shape used | UI element |
|---|---|---|---|
| `GET /api/v1/cost/summary` | `tenant:read` | `{ totalCostUsd, byCategory, byProvider, period }` | Spend metrics strip & category/provider breakdown charts |
| `GET /api/v1/cost/outcomes/unit-economics` | `tenant:read` | `{ economics: UnitEconomicItem[] }` | Business outcome unit economics `DataTable` |
| `GET /api/v1/cost/budget` | `tenant:read` | `BudgetPolicy` | Budget & circuit breaker status card |
| `POST /api/v1/cost/budget/reset-circuit` | `tenant:write` | `{ message: string }` | Reset circuit breaker button |

## Page: `/app/knowledge` (Client plane) — `web/src/pages/app/KnowledgeCenter.tsx`

| Method + Path | Required permission | Response shape used | UI element |
|---|---|---|---|
| `GET /api/v1/knowledge/documents` | `customer:read` | `{ documents: KnowledgeDocumentRecord[], total: number }` | Knowledge documents inventory `DataTable` & metric summary |
| `POST /api/v1/knowledge/documents` | `customer:write` | `KnowledgeDocumentRecord` (body: `{ title, sourceType, content, summary?, staleAfterDays }`) | Ingest document modal form |
| `POST /api/v1/knowledge/query` | `customer:read` | `KnowledgeRetrievalResponse { results: RetrievedChunkResult[], totalMatches, sanitizedContext }` (body: `{ query, topK, qualityFilter }`) | Hybrid vector & keyword query testing sandbox |
| `POST /api/v1/knowledge/documents/:id/verify` | `customer:write` | `KnowledgeDocumentRecord` (body: `{ status }`) | Document quality verification action (`VERIFIED`, `STALE`) |
| `DELETE /api/v1/knowledge/documents/:id` | `customer:write` | `{ deleted: true, documentId: string }` | Document deletion with confirmation dialog |

## Page: `/app/billing` (Client plane) — `web/src/pages/app/BillingSubscription.tsx`

| Method + Path | Required permission | Response shape used | UI element |
|---|---|---|---|
| `GET /api/v1/billing/subscription` | `billing:read` | `SubscriptionInfo` | Active subscription details card |
| `GET /api/v1/billing/plans` | `authenticate` | `{ count: number, plans: PlanTierItem[] }` | Plan tier selection & comparison grid |
| `POST /api/v1/billing/subscription` | `billing:write` | `SubscriptionInfo` (body: `{ planTier, channelPlan }`) | Plan tier upgrade / change action |
| `GET /api/v1/billing/invoices` | `billing:read` | `{ count: number, invoices: InvoiceItem[] }` | Invoice & payment history `DataTable` |

## Page: `/app/settings` (Client plane) — `web/src/pages/app/TenantSettings.tsx`

| Method + Path | Required permission | Response shape used | UI element |
|---|---|---|---|
| `GET /api/v1/tenants/:id` | `tenant:read` | `TenantDetails { tenant, configuration, limits }` | Tenant profile card & effective plan quotas grid |
| `PATCH /api/v1/tenants/:id/config` | `tenant:admin` | `{ success: true, message: string }` (body: `{ settings }`) | Configuration & feature flag updater |
| `GET /api/v1/users` | `user:read` | `{ users: UserRecord[] }` | Team members directory `DataTable` |
| `POST /api/v1/users/invite` | `user:invite` | `{ user: UserRecord, assignedRole: string }` (body: `{ email, fullName, temporaryPassword, role }`) | Invite team member modal dialog |

## Page: `/platform/overview` (Owner plane) — `web/src/pages/platform/PlatformOverview.tsx`

Built only on `adminRoutes.ts`'s genuinely cross-tenant endpoints. `observabilityRoutes.ts`/`sreRoutes.ts` were deliberately **not** used here — they're wrapped per-request in `TenantContextManager.withTenant(user.tenantId, ...)` and only ever return the caller's own tenant's data, so using them for a "platform-wide" page would misrepresent single-tenant data as cross-tenant.

| Method + Path | Required permission | Response shape used | UI element |
|---|---|---|---|
| `GET /api/v1/admin/tenants` | `system:admin` | `{ tenants: Array<{ id, name, slug, status, plan_tier, channel_plan, created_at, updated_at }>, count }` | Tenant count + status table |
| `GET /api/v1/admin/fleet/diagnostics` | `system:admin` | `FleetDiagnosticsSummary { totalNodes, onlineNodes, degradedNodes, offlineNodes, avgCpuUsagePct, avgMemoryUsagePct, clusterHealth }` | Fleet health card |
| `GET /api/v1/admin/maintenance` | authenticated only | `PlatformMaintenanceState { isMaintenanceActive, maintenanceMessage?, readOnlyMode, emergencyKillActive, updatedAt }` | Maintenance-mode banner (shown only if `isMaintenanceActive`) |

## Page: `/platform/tenants` (Owner plane) — `web/src/pages/platform/PlatformTenants.tsx`

| Method + Path | Required permission | Response shape used | UI element |
|---|---|---|---|
| `GET /api/v1/admin/tenants` | `system:admin` | `{ tenants: AdminTenantRecord[], count: number }` | Cross-tenant organizations `DataTable` with status filter |
| `POST /api/v1/admin/tenants/provision` | `system:admin` | `TenantRecord` (body: `ProvisionTenantRequest`) | Organization tenant provisioning modal dialog |
## Page: `/platform/fleet` (Owner plane) — `web/src/pages/platform/PlatformFleet.tsx`

| Method + Path | Required permission | Response shape used | UI element |
|---|---|---|---|
| `GET /api/v1/admin/fleet/diagnostics` | `system:admin` | `FleetDiagnosticsSummary` | Fleet health KPIs + compute nodes `DataTable` |
| `POST /api/v1/admin/fleet/heartbeat` | `system:admin` | `NodeFleetRecord` (body: `NodeHeartbeatRequest`) | Dispatch node heartbeat modal dialog |

## Page: `/platform/models` (Owner plane) — `web/src/pages/platform/PlatformModelHealth.tsx`

| Method + Path | Required permission | Response shape used | UI element |
|---|---|---|---|
| `GET /api/v1/model-resilience/models` | `tenant:read` | `{ models: ModelRegistryRecord[], count: number }` | Approved model registry catalog `DataTable` |
| `POST /api/v1/model-resilience/models` | `tenant:write` | `ModelRegistryRecord` (body: `RegisterModelRequest`) | Register approved model modal dialog |
| `GET /api/v1/model-resilience/decisions` | `tenant:read` | `{ decisions: ModelRoutingDecision[], count: number }` | Dynamic resilience routing & fallback decision audit `DataTable` |

## Page: `/platform/security` (Owner plane) — `web/src/pages/platform/PlatformSecurity.tsx`

| Method + Path | Required permission | Response shape used | UI element |
|---|---|---|---|
| `POST /api/v1/security/scan` | `audit:read` | `SecurityComplianceReport` | Zero-trust compliance scan posture card & findings `DataTable` |
| `GET /api/v1/security/audit/verify` | `audit:read` | `AuditLedgerVerificationReport` | Cryptographic audit hash-chain integrity card |
| `GET /api/v1/security/secrets` | `tenant:write` | `{ secrets: SecretRotationRecord[], count: number }` | Zero-trust secrets & key version registry `DataTable` |
| `POST /api/v1/security/secrets/rotate` | `tenant:write` | `SecretRotationResult` (body: `RotateSecretRequest`) | Rotate security secret key modal dialog |

## Page: `/platform/audit` (Owner plane) — `web/src/pages/platform/PlatformAudit.tsx`

| Method + Path | Required permission | Response shape used | UI element |
|---|---|---|---|
| `GET /api/v1/admin/audit-logs` | `system:admin` | `{ logs: OperatorAuditLog[], count: number }` | Operator audit log stream `DataTable` with filter |
| `POST /api/v1/security/audit/log` | `tenant:write` | `SecurityAuditLedgerRecord` (body: `LogSecurityEventRequest`) | Log chained security event modal dialog |

## Page: `/platform/billing` (Owner plane) — `web/src/pages/platform/PlatformBilling.tsx`

| Method + Path | Required permission | Response shape used | UI element |
|---|---|---|---|
| `GET /api/v1/admin/tenants` | `system:admin` | `{ tenants: AdminTenantRecord[], count: number }` | Cross-tenant recurring revenue & subscription directory `DataTable` |
| `GET /api/v1/billing/plans` | authenticated | `{ plans: PlanTierItem[], count: number }` | Workforce plan & quota tier catalog cards |
| `GET /api/v1/billing/invoices` | `billing:read` | `{ invoices: InvoiceItem[], count: number }` | Platform invoices and receipts `DataTable` |

## Component: Command Palette & Global Search (Cross-plane) — `web/src/components/CommandPalette.tsx`

| Method + Path | Required permission | Response shape used | UI element |
|---|---|---|---|
| `GET /api/v1/customers?search=` | `customer:read` | `{ customers: Array<{ id, name, email }> }` | Dynamic customer entity search results |
| `GET /api/v1/workforce/agents` | `agent:read` | `{ agents: Array<{ id, name, role }> }` | Dynamic workforce agent search results |
| `GET /api/v1/workflows` | `workflow:read` | `{ workflows: Array<{ id, name, slug }> }` | Dynamic workflow pipeline search results |

**Known backend gap (not fixed in Phase 1):** every RBAC role is tenant-scoped; a tenant's own `owner` role already holds `system:admin` via self-service `/auth/register`, so there is no backend-enforced separate "platform staff" identity yet. The `/platform/*` route gate in the frontend is navigation convenience, not a real access boundary — the real boundary is still whatever `system:admin` means today. Flagged for a future backend change, not a frontend fix.





