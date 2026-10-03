#!/usr/bin/env node
/**
 * Kriya Omnitask — MCP Stdio CLI Runner
 * Spawns an MCP server instance communicating via stdio for Claude Desktop, Cursor, or local agents.
 * (docs/kriya WP-5.7).
 */

import { StdioMcpTransport } from './transport/stdioTransport.js';
import { McpActionServer } from './service/mcpActionServer.js';

function parseArgs(): { tenantId: string; agentSlug: string; clientName: string } {
  const args = process.argv.slice(2);
  let tenantId = process.env.KRIYA_MCP_TENANT_ID || 'tenant_default';
  let agentSlug = process.env.KRIYA_MCP_AGENT_SLUG || 'mcp-agent';
  let clientName = process.env.KRIYA_MCP_CLIENT_NAME || 'cli-mcp-client';

  for (const arg of args) {
    if (arg.startsWith('--tenant=')) {
      tenantId = arg.slice(9);
    } else if (arg.startsWith('--agent=')) {
      agentSlug = arg.slice(8);
    } else if (arg.startsWith('--client=')) {
      clientName = arg.slice(9);
    }
  }

  return { tenantId, agentSlug, clientName };
}

async function main(): Promise<void> {
  const { tenantId, agentSlug, clientName } = parseArgs();

  const server = new McpActionServer();
  const transport = new StdioMcpTransport({
    readable: process.stdin,
    writable: process.stdout,
    context: {
      tenantId,
      agentSlug,
      clientName,
    },
    server,
  });

  transport.start();

  const shutdown = () => {
    transport.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    process.stderr.write(`Fatal MCP CLI error: ${err.message}\n`);
    process.exit(1);
  });
}
