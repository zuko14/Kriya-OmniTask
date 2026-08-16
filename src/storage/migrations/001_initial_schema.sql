-- ==============================================================================
-- Xylarc AI Migration 001: Initial Platform Foundation Schema
-- Defines core tenant, identity, workspace, role, and immutable audit structures.
-- ==============================================================================

-- 1. Tenants (Top-level isolation boundary)
CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'active', -- active, suspended, disabled
    plan_tier TEXT NOT NULL DEFAULT 'standard',
    channel_plan TEXT NOT NULL DEFAULT 'combined', -- whatsapp_only, voice_only, combined
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug);
CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status);

-- 2. Organizations (Customer legal / commercial entity within a tenant)
CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_orgs_tenant ON organizations(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orgs_tenant_slug ON organizations(tenant_id, slug);

-- 3. Workspaces (Operational units, branches, or department scopes)
CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    organization_id TEXT NOT NULL,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY(organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_workspaces_tenant ON workspaces(tenant_id);
CREATE INDEX IF NOT EXISTS idx_workspaces_org ON workspaces(organization_id);

-- 4. Users (Administrators, operators, analysts)
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    email TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active', -- active, inactive, locked
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_tenant_email ON users(tenant_id, email);
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);

-- 5. Roles & Permissions
CREATE TABLE IF NOT EXISTS roles (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL, -- null or 'system' for global system roles
    name TEXT NOT NULL,
    description TEXT,
    permissions_json TEXT NOT NULL DEFAULT '[]',
    is_system INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_roles_tenant ON roles(tenant_id);

-- 6. User Roles Mapping
CREATE TABLE IF NOT EXISTS user_roles (
    user_id TEXT NOT NULL,
    role_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, role_id),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(role_id) REFERENCES roles(id) ON DELETE CASCADE,
    FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_roles_tenant ON user_roles(tenant_id);

-- 7. Tenant Configurations (Feature flags, quotas, channel settings)
CREATE TABLE IF NOT EXISTS tenant_configurations (
    tenant_id TEXT PRIMARY KEY,
    settings_json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL,
    FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- 8. Immutable Audit Logs (Cryptographic actor & action ledger)
CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    organization_id TEXT,
    workspace_id TEXT,
    user_id TEXT,
    correlation_id TEXT NOT NULL,
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT,
    details_json TEXT NOT NULL DEFAULT '{}',
    ip_address TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_tenant ON audit_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_correlation ON audit_logs(correlation_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);

-- 9. Seed Default System Roles
INSERT OR IGNORE INTO roles (id, tenant_id, name, description, permissions_json, is_system, created_at, updated_at) VALUES
('role-owner', 'system', 'owner', 'Tenant Owner with full administrative authority', '["*"]', 1, '2026-08-15T00:00:00.000Z', '2026-08-15T00:00:00.000Z'),
('role-admin', 'system', 'admin', 'Tenant Administrator', '[]', 1, '2026-08-15T00:00:00.000Z', '2026-08-15T00:00:00.000Z'),
('role-operations_manager', 'system', 'operations_manager', 'Operations Manager', '[]', 1, '2026-08-15T00:00:00.000Z', '2026-08-15T00:00:00.000Z'),
('role-sales_manager', 'system', 'sales_manager', 'Sales Manager', '[]', 1, '2026-08-15T00:00:00.000Z', '2026-08-15T00:00:00.000Z'),
('role-support_manager', 'system', 'support_manager', 'Support Manager', '[]', 1, '2026-08-15T00:00:00.000Z', '2026-08-15T00:00:00.000Z'),
('role-agent_operator', 'system', 'agent_operator', 'Agent Fleet Operator', '[]', 1, '2026-08-15T00:00:00.000Z', '2026-08-15T00:00:00.000Z'),
('role-analyst', 'system', 'analyst', 'Business & Operational Analyst', '[]', 1, '2026-08-15T00:00:00.000Z', '2026-08-15T00:00:00.000Z'),
('role-finance', 'system', 'finance', 'Finance & Billing Manager', '[]', 1, '2026-08-15T00:00:00.000Z', '2026-08-15T00:00:00.000Z'),
('role-read_only', 'system', 'read_only', 'Read-Only Viewer', '[]', 1, '2026-08-15T00:00:00.000Z', '2026-08-15T00:00:00.000Z');
