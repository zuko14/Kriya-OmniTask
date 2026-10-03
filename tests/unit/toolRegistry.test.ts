/**
 * Kriya AI — Tool Registry Unit Tests
 * Verifies tool definitions, Zod validation schemas, and database synchronization (§18 of CLAUDE.md).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db, DatabaseClient } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { ToolRegistryService } from '../../src/tools/registry/toolRegistry.js';
import { ToolDefinitionRepository } from '../../src/tools/repositories/toolRepository.js';

describe('Tool Registry & System Tools Unit Tests', () => {
  let client: DatabaseClient;
  let registry: ToolRegistryService;

  beforeEach(async () => {
    client = db.getClient();
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    registry = new ToolRegistryService();
  });

  afterEach(async () => {
    await client.execute('DELETE FROM tool_definitions;');
  });

  it('should list all built-in tools with definitions and risk tiers', () => {
    const tools = registry.listRegisteredTools();
    expect(tools.length).toBeGreaterThanOrEqual(6);

    const slugs = tools.map((t) => t.slug);
    expect(slugs).toContain('crm_customer_lookup');
    expect(slugs).toContain('calendar_check_availability');
    expect(slugs).toContain('calendar_book_slot');
    expect(slugs).toContain('whatsapp_send_message');
    expect(slugs).toContain('financial_issue_refund');
    expect(slugs).toContain('custom_http_webhook');

    const refundTool = tools.find((t) => t.slug === 'financial_issue_refund');
    expect(refundTool?.riskTier).toBe('CRITICAL');
    expect(refundTool?.requiresApproval).toBe(true);
  });

  it('should validate tool inputs and reject invalid payloads', () => {
    const calendarTool = registry.getTool('calendar_check_availability');
    expect(calendarTool).toBeDefined();

    // Valid
    expect(() => calendarTool?.inputValidator.parse({ date: '2026-08-20', durationMinutes: 45 })).not.toThrow();

    // Invalid date format
    expect(() => calendarTool?.inputValidator.parse({ date: 'invalid-date' })).toThrow();
  });

  it('should sync all in-code definitions to the relational database', async () => {
    await registry.syncDefinitionsToDatabase();

    const toolRepo = new ToolDefinitionRepository(client);
    const dbTools = await toolRepo.listTools();

    expect(dbTools.length).toBeGreaterThanOrEqual(6);
    const dbSlugs = dbTools.map((t) => t.slug);
    expect(dbSlugs).toContain('crm_customer_lookup');
    expect(dbSlugs).toContain('financial_issue_refund');
  });

  it('should register without errors in production mode and verify read-back', async () => {
    const originalEnv = process.env.APP_MODE;
    try {
      process.env.APP_MODE = 'production';
      // Registering tools in production mode requires verify() on HIGH / CRITICAL tools
      const refundTool = registry.getTool('financial_issue_refund');
      expect(refundTool?.verify).toBeDefined();
      const refundVerification = await refundTool!.verify!(
        { customerId: 'c1', transactionId: 't1', amountUsd: 10, reason: 'overcharged' },
        { refundId: 'ref_123', status: 'processed' },
        { tenantId: 'tenant_test', vault: {} as any }
      );
      expect(refundVerification.state).toBe('verified');
      expect(refundVerification.observed).toEqual({ refundId: 'ref_123', status: 'processed' });

      const webhookTool = registry.getTool('custom_http_webhook');
      expect(webhookTool?.verify).toBeDefined();
      const webhookVerification = await webhookTool!.verify!(
        { endpointUrl: 'https://example.com/hook', payload: {} },
        { statusCode: 200, delivered: true },
        { tenantId: 'tenant_test', vault: {} as any }
      );
      expect(webhookVerification.state).toBe('verified');
      expect(webhookVerification.observed).toEqual({ statusCode: 200, delivered: true });
    } finally {
      process.env.APP_MODE = originalEnv;
    }
  });
});
