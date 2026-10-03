/**
 * Kriya Omnitask — MCP Server Unit & Integration Tests (WP-5.7, 02 §8)
 *
 * Verifies:
 * 1. MCP Protocol Lifecycle (initialize, notifications/initialized, ping, error codes).
 * 2. Tool Discovery (tools/list with JSON Schema conversion and risk tier annotation).
 * 3. Tool Execution via MCP (tools/call with mediated ToolGateway execution).
 * 4. Mandate Gating:
 *    - Unmandated consequential actions (T2) are rejected.
 *    - Valid mandates allow execution and consume limits.
 *    - Over-limit actions are blocked and report mandate refusal.
 * 5. T3 Irreversible Action Protection (autonomous execution blocked, human gate enforced).
 * 6. Cryptographic Proof Receipts:
 *    - External MCP calls produce verifiable Ed25519-signed proof receipts.
 *    - Proof receipts are verifiable offline via verifyReceiptOffline.
 *    - Tampering with receipts fails verification.
 * 7. Fastify HTTP Transport:
 *    - Authentication enforcement (401 on missing auth).
 *    - Single & batch JSON-RPC request execution.
 *    - Discovery endpoint GET /api/v1/mcp/tools.
 * 8. Stdio Stream Transport:
 *    - Line-delimited JSON-RPC 2.0 streaming over duplex streams.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PassThrough } from 'node:stream';
import { SQLiteDatabaseClient, db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { TenantRepository } from '../../src/storage/repositories/tenantRepository.js';
import { CustomerRepository } from '../../src/customer360/repositories/customerRepository.js';
import { MandateService } from '../../src/trust/mandate/mandateService.js';
import { ProofService, verifyReceiptOffline, loadSigningKey } from '../../src/trust/proof/proofService.js';
import { JwtService } from '../../src/security/auth/jwt.js';
import { TenantContextManager } from '../../src/core/context/tenantContext.js';
import { buildServer } from '../../src/api/server.js';
import { FastifyInstance } from 'fastify';
import {
  McpActionServer,
  StdioMcpTransport,
  McpErrorCodes,
  MCP_PROTOCOL_VERSION,
  KRIYA_MCP_SERVER_NAME,
  KRIYA_MCP_SERVER_VERSION,
} from '../../src/index.js';

describe('WP-5.7 Model Context Protocol (MCP) Server Tests', () => {
  let client: SQLiteDatabaseClient;
  let tenantId: string;
  let server: McpActionServer;
  let mandateService: MandateService;
  let proofService: ProofService;
  let fastifyApp: FastifyInstance;
  let authToken: string;

  beforeEach(async () => {
    client = new SQLiteDatabaseClient(':memory:');
    db.setClientForTesting(client);
    await new SchemaMigrator(client).applyMigrations();

    const tenantRepo = new TenantRepository(client);
    const tenant = await tenantRepo.create({
      name: 'Acme Health Tech',
      slug: 'acme-health',
      plan_tier: 'enterprise',
      channel_plan: 'combined',
    });
    tenantId = tenant.id;

    mandateService = new MandateService(client);
    proofService = new ProofService(client);
    server = new McpActionServer({
      dbClient: client,
      mandateService,
      proofService,
    });

    authToken = JwtService.sign({
      userId: 'usr_admin_1',
      tenantId,
      email: 'admin@acme.com',
      roles: ['tenant_admin', 'operator'],
    });

    fastifyApp = await buildServer();
  });

  afterEach(async () => {
    await fastifyApp.close();
    await client.close();
  });

  describe('Suite 1: MCP Protocol Lifecycle & Handshake', () => {
    it('handles initialize request and returns standard protocol capabilities', async () => {
      const initReq = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'claude-desktop', version: '1.2.0' },
        },
      };

      const res = await server.handleMessage(initReq, { tenantId });
      expect(res).not.toBeNull();
      expect(res?.jsonrpc).toBe('2.0');
      expect(res?.id).toBe(1);

      const result = res?.result as any;
      expect(result.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
      expect(result.serverInfo.name).toBe(KRIYA_MCP_SERVER_NAME);
      expect(result.serverInfo.version).toBe(KRIYA_MCP_SERVER_VERSION);
      expect(result.capabilities.tools).toBeDefined();
    });

    it('handles notifications/initialized without returning a response', async () => {
      const notifReq = {
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      };

      const res = await server.handleMessage(notifReq, { tenantId });
      expect(res).toBeNull();
    });

    it('handles ping request with empty object result', async () => {
      const pingReq = {
        jsonrpc: '2.0',
        id: 'ping-42',
        method: 'ping',
      };

      const res = await server.handleMessage(pingReq, { tenantId });
      expect(res?.id).toBe('ping-42');
      expect(res?.result).toEqual({});
    });

    it('rejects malformed JSON-RPC requests with standard error codes', async () => {
      // Missing jsonrpc version
      const badReq1 = { id: 1, method: 'ping' };
      const res1 = await server.handleMessage(badReq1, { tenantId });
      expect(res1?.error?.code).toBe(McpErrorCodes.INVALID_REQUEST);

      // Non-object body
      const res2 = await server.handleMessage('raw string', { tenantId });
      expect(res2?.error?.code).toBe(McpErrorCodes.PARSE_ERROR);

      // Unknown method
      const unknownReq = { jsonrpc: '2.0', id: 3, method: 'unknown/action' };
      const res3 = await server.handleMessage(unknownReq, { tenantId });
      expect(res3?.error?.code).toBe(McpErrorCodes.METHOD_NOT_FOUND);
    });
  });

  describe('Suite 2: Tool Discovery (tools/list)', () => {
    it('returns available registered tools with JSON Schema and risk tier annotations', async () => {
      const listReq = {
        jsonrpc: '2.0',
        id: 'list-1',
        method: 'tools/list',
      };

      const res = await server.handleMessage(listReq, { tenantId });
      expect(res?.id).toBe('list-1');

      const result = res?.result as any;
      expect(result.tools).toBeInstanceOf(Array);
      expect(result.tools.length).toBeGreaterThan(0);

      // Check CRM Customer Lookup tool schema
      const crmTool = result.tools.find((t: any) => t.name === 'crm_customer_lookup');
      expect(crmTool).toBeDefined();
      expect(crmTool.inputSchema.type).toBe('object');
      expect(crmTool.riskTier).toBe('T0');
      expect(crmTool.requiresMandate).toBe(false);

      // Check Reach Browser Session tool
      const reachTool = result.tools.find((t: any) => t.name === 'reach_browser_session');
      expect(reachTool).toBeDefined();
      expect(reachTool.inputSchema.properties.url).toBeDefined();
      expect(reachTool.riskTier).toBe('T1');

      // Check Payment tool
      const paymentTool = result.tools.find((t: any) => t.name === 'payment_create_link');
      expect(paymentTool).toBeDefined();
      expect(paymentTool.riskTier).toBe('T1');
      expect(paymentTool.requiresMandate).toBe(true);

      // Check Payment hold tool (T2)
      const holdTool = result.tools.find((t: any) => t.name === 'payment_hold');
      expect(holdTool).toBeDefined();
      expect(holdTool.riskTier).toBe('T2');
      expect(holdTool.requiresMandate).toBe(true);
    });
  });

  describe('Suite 3: Tool Execution (tools/call) & Proof Receipts', () => {
    it('executes a non-consequential tool and issues a signed ProofReceipt', async () => {
      // Seed a customer in the database within tenant context
      const customerRepo = new CustomerRepository(client);
      const customer = await TenantContextManager.withTenant(tenantId, 'default', async () =>
        customerRepo.create({
          full_name: 'Aditi Sharma',
          primary_phone: '+919876543210',
          primary_email: 'patient@example.com',
          lifecycle_stage: 'customer',
          sentiment_score: 0.9,
          churn_risk_score: 0.1,
          preferred_language: 'en',
          preferred_channel: 'whatsapp',
          attributes_json: '{}',
          status: 'active',
        })
      );

      const callReq = {
        jsonrpc: '2.0',
        id: 'call-1',
        method: 'tools/call',
        params: {
          name: 'crm_customer_lookup',
          arguments: {
            customerId: customer.id,
          },
        },
      };

      const res = await server.handleMessage(callReq, { tenantId, clientName: 'test-agent' });
      expect(res?.error).toBeUndefined();

      const result = res?.result as any;
      expect(result.isError).toBe(false);
      expect(result.content[0].type).toBe('text');

      const payload = JSON.parse(result.content[0].text);
      expect(payload.status).toBe('completed');
      expect(payload.result.customer.id).toBe(customer.id);
      expect(payload.result.customer.full_name).toBe('Aditi Sharma');

      // Verify Proof receipt is attached
      expect(result.proofReceipt).toBeDefined();
      const receipt = result.proofReceipt;
      expect(receipt.body.actionType).toBe('crm_customer_lookup');
      expect(receipt.body.tenantId).toBe(tenantId);
      expect(receipt.body.receiptId).toMatch(/^rcpt_/);
      expect(receipt.signature).toBeDefined();

      // Offline verification of the cryptographic Ed25519 signature
      const signingKey = loadSigningKey().publicKeyPem;
      const verifyOffline = verifyReceiptOffline(receipt, signingKey);
      expect(verifyOffline.valid).toBe(true);
    });
  });

  describe('Suite 4: Mandate Gating for Consequential Actions (T2)', () => {
    it('blocks execution when no mandate exists for a consequential action', async () => {
      const callReq = {
        jsonrpc: '2.0',
        id: 'call-payment-unmandated',
        method: 'tools/call',
        params: {
          name: 'payment_create_link',
          arguments: {
            amount: 500,
            currency: 'INR',
            title: 'Cardiology Consultation Fee',
            customerId: 'cust_unauth_1',
          },
        },
      };

      const res = await server.handleMessage(callReq, {
        tenantId,
        agentSlug: 'unauthorized-external-agent',
      });

      const result = res?.result as any;
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('[MANDATE DENIED]');
      expect(result.mandate.decision).toBe('denied');
      expect(result.proofReceipt).toBeUndefined();
    });

    it('allows execution when a valid mandate with sufficient limits exists', async () => {
      // Create delegated mandate for mcp-agent within tenant context
      await TenantContextManager.withTenant(tenantId, 'default', async () =>
        mandateService.create(
          {
            principalId: 'admin_user',
            agentSlug: 'mcp-billing-agent',
            actionTypes: ['payment_create_link'],
            perActionLimit: 2000,
            dailyLimit: 10000,
            currency: 'INR',
          },
          'admin_user'
        )
      );

      const callReq = {
        jsonrpc: '2.0',
        id: 'call-payment-mandated',
        method: 'tools/call',
        params: {
          name: 'payment_create_link',
          arguments: {
            customerRef: 'cust_mandated_1',
            amount: 750,
            currency: 'INR',
            description: 'Telehealth Follow-up consultation fee',
          },
        },
      };

      const res = await server.handleMessage(callReq, {
        tenantId,
        agentSlug: 'mcp-billing-agent',
      });

      expect(res?.error).toBeUndefined();
      const result = res?.result as any;
      expect(result.isError).toBe(false);
      expect(result.mandate.decision).toBe('allow');
      expect(result.proofReceipt).toBeDefined();

      const payload = JSON.parse(result.content[0].text);
      expect(payload.status).toBe('completed');
      expect(payload.result.linkId).toMatch(/^plink_/);
      expect(payload.result.status).toBe('created');

      // Verify the proof receipt records the mandate reference
      expect(result.proofReceipt.body.mandate?.id).toBe(result.mandate.mandateId);
      expect(result.proofReceipt.body.mandate?.decision).toBe('allow');

      // Verify offline verification passes
      const offline = verifyReceiptOffline(result.proofReceipt, loadSigningKey().publicKeyPem);
      expect(offline.valid).toBe(true);
    });

    it('refuses execution when action amount exceeds perActionLimit in mandate', async () => {
      // Create mandate with 500 INR limit within tenant context
      await TenantContextManager.withTenant(tenantId, 'default', async () =>
        mandateService.create(
          {
            principalId: 'admin_user',
            agentSlug: 'mcp-limited-agent',
            actionTypes: ['payment_create_link'],
            perActionLimit: 500,
            dailyLimit: 2000,
            currency: 'INR',
          },
          'admin_user'
        )
      );

      const callReq = {
        jsonrpc: '2.0',
        id: 'call-payment-overlimit',
        method: 'tools/call',
        params: {
          name: 'payment_create_link',
          arguments: {
            customerRef: 'cust_overlimit_1',
            amount: 1500, // Exceeds 500
            currency: 'INR',
            description: 'Specialist Surgery Booking fee',
          },
        },
      };

      const res = await server.handleMessage(callReq, {
        tenantId,
        agentSlug: 'mcp-limited-agent',
      });

      const result = res?.result as any;
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('[MANDATE OVER LIMIT]');
      expect(result.mandate.decision).toBe('over_limit');
      expect(result.proofReceipt).toBeUndefined();
    });
  });

  describe('Suite 5: T3 Irreversible Action Protection (Human Gate)', () => {
    it('refuses autonomous external MCP execution for T3 Irreversible actions', async () => {
      const refundCall = {
        jsonrpc: '2.0',
        id: 'call-refund-t3',
        method: 'tools/call',
        params: {
          name: 'financial_issue_refund',
          arguments: {
            customerId: 'cust_1',
            transactionId: 'tx_123',
            amountUsd: 100,
            reason: 'Requested full refund',
          },
        },
      };

      const res = await server.handleMessage(refundCall, { tenantId });
      const result = res?.result as any;
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('[HUMAN GATE REFUSAL]');
      expect(result.content[0].text).toContain('requires explicit human authorization');
    });
  });

  describe('Suite 6: Cryptographic Proof Receipt Integrity & Offline Verification', () => {
    it('proves that tampering with any field in a proof receipt fails offline verification', async () => {
      const callReq = {
        jsonrpc: '2.0',
        id: 'call-verify-tamper',
        method: 'tools/call',
        params: {
          name: 'crm_customer_lookup',
          arguments: {
            phone: '+919999999999',
          },
        },
      };

      const res = await server.handleMessage(callReq, { tenantId });
      const receipt = (res?.result as any).proofReceipt;
      expect(receipt).toBeDefined();

      const pubKey = loadSigningKey().publicKeyPem;

      // Original receipt must be valid
      expect(verifyReceiptOffline(receipt, pubKey).valid).toBe(true);

      // Tamper with receipt sequence
      const tampered1 = {
        ...receipt,
        body: {
          ...receipt.body,
          sequence: receipt.body.sequence + 999,
        },
      };
      const check1 = verifyReceiptOffline(tampered1, pubKey);
      expect(check1.valid).toBe(false);
      expect(check1.reason).toContain('hash does not match body');

      // Tamper with actionType
      const tampered2 = {
        ...receipt,
        body: {
          ...receipt.body,
          actionType: 'malicious_injected_action',
        },
      };
      const check2 = verifyReceiptOffline(tampered2, pubKey);
      expect(check2.valid).toBe(false);
      expect(check2.reason).toContain('hash does not match body');
    });
  });

  describe('Suite 7: Fastify HTTP Transport (POST /api/v1/mcp)', () => {
    it('rejects unauthenticated HTTP requests with 401 Unauthorized', async () => {
      const response = await fastifyApp.inject({
        method: 'POST',
        url: '/api/v1/mcp',
        payload: {
          jsonrpc: '2.0',
          id: 1,
          method: 'ping',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe(McpErrorCodes.UNAUTHORIZED);
    });

    it('executes authenticated JSON-RPC requests via HTTP Bearer token', async () => {
      const response = await fastifyApp.inject({
        method: 'POST',
        url: '/api/v1/mcp',
        headers: {
          authorization: `Bearer ${authToken}`,
        },
        payload: {
          jsonrpc: '2.0',
          id: 'http-call-1',
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'cursor-ide', version: '0.40.0' },
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.jsonrpc).toBe('2.0');
      expect(body.id).toBe('http-call-1');
      expect(body.result.serverInfo.name).toBe(KRIYA_MCP_SERVER_NAME);
    });

    it('supports batch JSON-RPC requests via HTTP', async () => {
      const response = await fastifyApp.inject({
        method: 'POST',
        url: '/api/v1/mcp',
        headers: {
          authorization: `Bearer ${authToken}`,
        },
        payload: [
          { jsonrpc: '2.0', id: 'batch-1', method: 'ping' },
          { jsonrpc: '2.0', id: 'batch-2', method: 'ping' },
        ],
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBe(2);
      expect(body[0].id).toBe('batch-1');
      expect(body[1].id).toBe('batch-2');
    });

    it('exposes discovery endpoint GET /api/v1/mcp/tools', async () => {
      const response = await fastifyApp.inject({
        method: 'GET',
        url: '/api/v1/mcp/tools',
        headers: {
          authorization: `Bearer ${authToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.tools).toBeInstanceOf(Array);
      expect(body.tools.length).toBeGreaterThan(0);
    });

    it('exposes server info endpoint GET /api/v1/mcp/info', async () => {
      const response = await fastifyApp.inject({
        method: 'GET',
        url: '/api/v1/mcp/info',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.name).toBe('kriya-omnitask-mcp');
      expect(body.governance.mandateGated).toBe(true);
      expect(body.governance.proofReceipts).toBe(true);
    });
  });

  describe('Suite 8: Stdio Stream Transport', () => {
    it('communicates over duplex streams using line-delimited JSON-RPC 2.0 messages', async () => {
      const readable = new PassThrough();
      const writable = new PassThrough();

      const transport = new StdioMcpTransport({
        readable,
        writable,
        context: {
          tenantId,
          agentSlug: 'stdio-agent',
          clientName: 'stdio-client',
        },
        server,
      });

      transport.start();

      let outputData = '';
      writable.on('data', (chunk) => {
        outputData += chunk.toString('utf8');
      });

      // Send ping message
      readable.write(JSON.stringify({ jsonrpc: '2.0', id: 'stdio-ping', method: 'ping' }) + '\n');

      // Wait a tick for async stream processing
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(outputData).toContain('"id":"stdio-ping"');
      const parsedRes = JSON.parse(outputData.trim());
      expect(parsedRes.jsonrpc).toBe('2.0');
      expect(parsedRes.id).toBe('stdio-ping');
      expect(parsedRes.result).toEqual({});

      transport.close();
    });

    it('handles invalid JSON lines over stream gracefully with parse error', async () => {
      const readable = new PassThrough();
      const writable = new PassThrough();

      const transport = new StdioMcpTransport({
        readable,
        writable,
        context: { tenantId },
        server,
      });

      transport.start();

      let outputData = '';
      writable.on('data', (chunk) => {
        outputData += chunk.toString('utf8');
      });

      // Send invalid non-JSON string
      readable.write('this is not valid json\n');

      await new Promise((resolve) => setTimeout(resolve, 50));

      const parsedRes = JSON.parse(outputData.trim());
      expect(parsedRes.error.code).toBe(McpErrorCodes.PARSE_ERROR);

      transport.close();
    });
  });
});
