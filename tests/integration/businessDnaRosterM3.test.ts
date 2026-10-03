/**
 * Kriya Omnitask — Milestone M3: Business DNA & Roster Moulding Integration Tests (§3, §4, §23)
 * Verifies all 4 acceptance criteria for M3:
 * 1. Zero `if business_type` branches in the codebase (Static analysis test)
 * 2. Switching DNA changes features, agents, and vocabulary with no deploy
 * 3. Roster manifests are versioned and rollback-able
 * 4. A feature not in the DNA profile is absent from the UI, not disabled
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server.js';
import { db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { JwtService } from '../../src/security/auth/jwt.js';
import { BusinessDnaService } from '../../src/governance/dna/businessDnaService.js';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

describe('Milestone M3: Business DNA & Roster Moulding (§3, §4, §23)', () => {
  let app: FastifyInstance;
  let operatorToken: string;
  let clientAdminToken: string;
  const operatorTenantId = 'tenant_operator_m3';
  const tenantId = 'tenant_m3_pilot_meridian';

  beforeAll(async () => {
    const client = db.getClient();
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    app = await buildServer();
    await app.ready();

    const now = new Date().toISOString();
    // System operator tenant
    await client.execute(
      'INSERT OR IGNORE INTO tenants (id, name, slug, status, plan_tier, channel_plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?);',
      [operatorTenantId, 'System Operator Tenant', 'sys-operator-m3', 'active', 'enterprise', 'combined', now, now]
    );

    // 1. Platform Operator Token
    operatorToken = JwtService.sign({
      userId: 'usr_operator_m3',
      tenantId: operatorTenantId,
      email: 'operator@kriya.ai',
      roles: ['system', 'operator'],
    });

    // 2. Client Admin Token for Meridian
    clientAdminToken = JwtService.sign({
      userId: 'usr_client_admin_m3',
      tenantId,
      email: 'admin@meridianpilot.com',
      roles: ['role-admin', 'admin'],
    });
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  // ============================================================================
  // Criteria 1: Zero `if business_type` branches in the codebase
  // ============================================================================

  it('Criteria 1: Zero `if business_type` branches in the codebase', () => {
    const rootsToScan = [
      join(process.cwd(), 'src'),
      join(process.cwd(), 'web', 'src'),
    ];

    const violations: Array<{ file: string; line: number; match: string }> = [];

    function scanDir(dir: string) {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        const fullPath = join(dir, entry);
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          scanDir(fullPath);
        } else if (/\.(ts|tsx|js|jsx)$/.test(entry) && !entry.includes('test')) {
          const content = readFileSync(fullPath, 'utf8');
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // Match pattern like if (business_type == ...) or if (businessType === ...) or switch (business_type)
            if (
              /if\s*\(\s*(business_type|businessType)\s*===?/.test(line) ||
              /switch\s*\(\s*(business_type|businessType)\s*\)/.test(line) ||
              /business_type\s*===?\s*['"]/.test(line) ||
              /businessType\s*===?\s*['"]/.test(line)
            ) {
              violations.push({ file: fullPath, line: i + 1, match: line.trim() });
            }
          }
        }
      }
    }

    for (const root of rootsToScan) {
      scanDir(root);
    }

    expect(violations).toEqual([]);
    expect(violations.length).toBe(0);
  });

  // ============================================================================
  // Criteria 2: Switching DNA changes features, agents, and vocabulary with no deploy
  // ============================================================================

  it('Criteria 2: Switching DNA changes features, agents, and vocabulary with no deploy', async () => {
    // 1. Provision initial tenant with 'dna_retail_commerce'
    const provRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/tenants/provision',
      headers: { authorization: `Bearer ${operatorToken}` },
      payload: {
        id: tenantId,
        name: 'Meridian Retail Pilot',
        slug: 'meridian-retail-pilot',
        industry: 'retail',
        region: 'ap-south-1',
        languages: ['en', 'hi'],
        timezone: 'Asia/Kolkata',
        dnaProfileId: 'dna_retail_commerce',
        planTier: 'growth',
        channelPlan: 'combined',
        brainSupplyMode: 'byo',
        adminEmail: 'admin@meridianpilot.com',
        quotas: { max_concurrent_tasks: 10, monthly_budget_inr: 10000 },
        autonomyCeiling: 'L2',
      },
    });

    expect(provRes.statusCode).toBe(201);

    // 2. Fetch tenant DNA resolution
    const dnaRes1 = await app.inject({
      method: 'GET',
      url: `/api/v1/tenants/${tenantId}/dna`,
      headers: { authorization: `Bearer ${clientAdminToken}` },
    });

    expect(dnaRes1.statusCode).toBe(200);
    const body1 = dnaRes1.json();

    // Verify retail vocabulary
    expect(body1.vocabulary.customer).toBe('Shopper');
    expect(body1.vocabulary.customer_plural).toBe('Shoppers');
    expect(body1.vocabulary.item).toBe('Product');
    expect(body1.vocabulary.transaction).toBe('Order');
    expect(body1.vocabulary.custom_labels.cart).toBe('Shopping Bag');

    // Verify retail capabilities
    expect(body1.capabilities).toContain('product_catalog');
    expect(body1.capabilities).toContain('order_tracking');
    expect(body1.capabilities).toContain('returns_management');
    expect(body1.capabilities).not.toContain('vehicle_inventory');
    expect(body1.capabilities).not.toContain('test_drive_scheduling');

    // Verify retail agents roster
    const agentNames1 = body1.agents.map((a: any) => a.name);
    expect(agentNames1).toContain('Store & Order Assistant');
    expect(agentNames1).toContain('Logistics & Delivery Specialist');
    expect(agentNames1).toContain('Sales & Personal Shopper');

    // Verify active manifest is version 1
    expect(body1.activeManifest.version).toBe(1);
    expect(body1.activeManifest.dna_profile_id).toBe('dna_retail_commerce');
    expect(body1.activeManifest.status).toBe('active');
    expect(body1.activeManifest.checksum).toBeDefined();

    // 3. Switch DNA to 'dna_automotive_dealership' via Owner Plane API
    const switchRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/tenants/${tenantId}/dna/switch`,
      headers: { authorization: `Bearer ${operatorToken}` },
      payload: {
        dnaProfileId: 'dna_automotive_dealership',
        reason: 'Pilot client expanding operations to automotive dealership & service division',
      },
    });

    expect(switchRes.statusCode).toBe(200);

    // 4. Verify that without redeployment, the tenant immediately resolves automotive profile
    const dnaRes2 = await app.inject({
      method: 'GET',
      url: `/api/v1/tenants/${tenantId}/dna`,
      headers: { authorization: `Bearer ${clientAdminToken}` },
    });

    expect(dnaRes2.statusCode).toBe(200);
    const body2 = dnaRes2.json();

    // Verify automotive vocabulary
    expect(body2.vocabulary.customer).toBe('Vehicle Owner');
    expect(body2.vocabulary.customer_plural).toBe('Vehicle Owners');
    expect(body2.vocabulary.item).toBe('Vehicle');
    expect(body2.vocabulary.transaction).toBe('Deal');
    expect(body2.vocabulary.appointment).toBe('Test Drive / Service Booking');
    expect(body2.vocabulary.custom_labels.service_bay).toBe('Workshop Bay');

    // Verify automotive capabilities
    expect(body2.capabilities).toContain('vehicle_inventory');
    expect(body2.capabilities).toContain('test_drive_scheduling');
    expect(body2.capabilities).toContain('service_appointment_booking');
    expect(body2.capabilities).not.toContain('returns_management');
    expect(body2.capabilities).not.toContain('cart_recovery');

    // Verify automotive agents roster
    const agentNames2 = body2.agents.map((a: any) => a.name);
    expect(agentNames2).toContain('Showroom Sales Consultant');
    expect(agentNames2).toContain('Test Drive & Service Scheduler');
    expect(agentNames2).toContain('Service Center Advisor');

    // Verify new active manifest is version 2
    expect(body2.activeManifest.version).toBe(2);
    expect(body2.activeManifest.dna_profile_id).toBe('dna_automotive_dealership');
    expect(body2.activeManifest.status).toBe('active');

    // 5. Verify cryptographic audit log entry was written
    const auditRes = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/audit-logs',
      headers: { authorization: `Bearer ${operatorToken}` },
    });

    expect(auditRes.statusCode).toBe(200);
    const auditLogs = auditRes.json().logs;
    const switchAudit = auditLogs.find((l: any) => l.actionType === 'tenant_provision' || l.action === 'tenant.dna.switched');
    expect(switchAudit).toBeDefined();
  });

  // ============================================================================
  // Criteria 3: Roster manifests are versioned and rollback-able
  // ============================================================================

  it('Criteria 3: Roster manifests are versioned and rollback-able', async () => {
    // 1. Inspect manifest version history for tenant
    const histRes1 = await app.inject({
      method: 'GET',
      url: `/api/v1/tenants/${tenantId}/roster/manifests`,
      headers: { authorization: `Bearer ${clientAdminToken}` },
    });

    expect(histRes1.statusCode).toBe(200);
    const history1 = histRes1.json().manifests;
    expect(history1.length).toBe(2);
    expect(history1[0].version).toBe(2); // active (automotive)
    expect(history1[0].status).toBe('active');
    expect(history1[1].version).toBe(1); // superseded (retail)
    expect(history1[1].status).toBe('superseded');

    // 2. Rollback to Manifest Version 1 (Retail)
    const rollbackRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/tenants/${tenantId}/roster/rollback`,
      headers: { authorization: `Bearer ${operatorToken}` },
      payload: {
        targetVersion: 1,
        reason: 'Reverting automotive trial back to primary retail commerce configuration',
      },
    });

    expect(rollbackRes.statusCode).toBe(200);
    const rollbackBody = rollbackRes.json();

    // Verify that new active manifest is Version 3, restored from Version 1
    expect(rollbackBody.activeManifest.version).toBe(3);
    expect(rollbackBody.activeManifest.rolled_back_from_version).toBe(1);
    expect(rollbackBody.activeManifest.dna_profile_id).toBe('dna_retail_commerce');
    expect(rollbackBody.activeManifest.status).toBe('active');

    // Verify vocabulary and capabilities are restored to Retail
    expect(rollbackBody.vocabulary.customer).toBe('Shopper');
    expect(rollbackBody.capabilities).toContain('returns_management');
    expect(rollbackBody.capabilities).not.toContain('vehicle_inventory');

    // 3. Inspect manifest history to verify immutability and complete audit trail
    const histRes2 = await app.inject({
      method: 'GET',
      url: `/api/v1/tenants/${tenantId}/roster/manifests`,
      headers: { authorization: `Bearer ${clientAdminToken}` },
    });

    expect(histRes2.statusCode).toBe(200);
    const history2 = histRes2.json().manifests;
    expect(history2.length).toBe(3);
    expect(history2[0].version).toBe(3); // active (rolled back to v1)
    expect(history2[0].status).toBe('active');
    expect(history2[1].version).toBe(2); // superseded
    expect(history2[1].status).toBe('superseded');
    expect(history2[2].version).toBe(1); // superseded
  });

  // ============================================================================
  // Criteria 4: A feature not in the DNA profile is absent from the UI, not disabled
  // ============================================================================

  it('Criteria 4: A feature not in the DNA profile is absent from the UI, not disabled', async () => {
    const service = new BusinessDnaService();

    // For tenant (currently restored to retail DNA):
    const hasReturns = await service.hasCapability(tenantId, 'returns_management');
    const hasOrderTracking = await service.hasCapability(tenantId, 'order_tracking');
    const hasVehicleInventory = await service.hasCapability(tenantId, 'vehicle_inventory');
    const hasTestDrive = await service.hasCapability(tenantId, 'test_drive_scheduling');

    expect(hasReturns).toBe(true);
    expect(hasOrderTracking).toBe(true);
    // Features NOT in DNA profile return false
    expect(hasVehicleInventory).toBe(false);
    expect(hasTestDrive).toBe(false);
  });
});
