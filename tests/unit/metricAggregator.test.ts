import { describe, it, expect, beforeAll } from 'vitest';
import { MetricAggregator } from '../../src/bi/aggregators/metricAggregator.js';
import { db, SQLiteDatabaseClient } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';

describe('Business Intelligence Metric Aggregator Unit Tests', () => {
  let client: SQLiteDatabaseClient;
  let aggregator: MetricAggregator;
  const tenantId = 'tenant_aggregator_test';
  const today = '2026-08-15';

  beforeAll(async () => {
    client = db.getClient() as SQLiteDatabaseClient;

    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    const now = new Date().toISOString();
    await client.execute(
      'INSERT OR IGNORE INTO tenants (id, name, slug, status, plan_tier, channel_plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?);',
      [tenantId, 'Aggregator Corp', 'aggregator-corp', 'active', 'enterprise', 'combined', now, now]
    );

    // Seed 2 customers (1 lead, 1 opportunity)
    await client.execute(
      `INSERT INTO customers (id, tenant_id, primary_phone, full_name, lifecycle_stage, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?);`,
      ['cust_1', tenantId, '+15550001', 'Alice Lead', 'lead', `${today}T10:00:00Z`, `${today}T10:00:00Z`]
    );
    await client.execute(
      `INSERT INTO customers (id, tenant_id, primary_phone, full_name, lifecycle_stage, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?);`,
      ['cust_2', tenantId, '+15550002', 'Bob Opportunity', 'opportunity', `${today}T11:00:00Z`, `${today}T11:00:00Z`]
    );

    // Seed 1 active bottleneck
    await client.execute(
      `INSERT INTO operational_bottlenecks (id, tenant_id, organization_id, bottleneck_type, title, description, severity, impact_estimate_usd, recommendation, status, detected_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      ['bot_1', tenantId, 'default', 'revenue_leak', 'Drop off', 'Desc', 'HIGH', 1500, 'Re-engage', 'detected', now]
    );

    aggregator = new MetricAggregator(client);
  });

  it('should accurately aggregate customer, funnel, bottleneck, and ROI metrics', async () => {
    const { snapshot, roi } = await aggregator.aggregateSnapshot(tenantId, today);

    expect(snapshot.date).toBe(today);
    expect(snapshot.totalCustomers).toBe(2);
    expect(snapshot.newLeadsToday).toBe(1);
    expect(snapshot.bookedAppointmentsToday).toBe(1);
    expect(snapshot.activeBottlenecksCount).toBe(1);
    expect(snapshot.estimatedRevenueLeakUsd).toBe(1500);

    // ROI verification
    expect(roi.totalAgentTasksExecuted).toBeGreaterThan(0);
    expect(roi.estimatedLaborHoursSaved).toBeGreaterThan(0);
    expect(roi.estimatedLaborCostSavedUsd).toBeGreaterThan(0);
    expect(roi.netSavingsUsd).toBeGreaterThan(0);
    expect(roi.roiMultiple).toBeGreaterThan(1);
  });
});
