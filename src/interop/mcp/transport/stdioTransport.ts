/**
 * Kriya Omnitask — MCP Stdio Transport
 * Enables duplex JSON-RPC 2.0 communication over standard input/output streams.
 * Allows external agent tools (Claude Desktop, Cursor, CLI runners) to interact with Kriya MCP.
 */

import { Readable, Writable } from 'node:stream';
import { McpActionServer } from '../service/mcpActionServer.js';
import { McpClientContext, McpErrorCodes, JsonRpcResponse } from '../types/mcpTypes.js';
import { logger } from '../../../core/logger/logger.js';

export interface StdioTransportOptions {
  readable?: Readable;
  writable?: Writable;
  context: McpClientContext;
  server?: McpActionServer;
}

export class StdioMcpTransport {
  private readable: Readable;
  private writable: Writable;
  private context: McpClientContext;
  private server: McpActionServer;
  private buffer = '';
  private isRunning = false;
  private onDataBound: (chunk: Buffer | string) => void;
  private onEndBound: () => void;

  constructor(options: StdioTransportOptions) {
    this.readable = options.readable || process.stdin;
    this.writable = options.writable || process.stdout;
    this.context = options.context;
    this.server = options.server || new McpActionServer();

    this.onDataBound = this.handleData.bind(this);
    this.onEndBound = this.handleEnd.bind(this);
  }

  /**
   * Starts listening on the readable stream.
   */
  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    this.readable.on('data', this.onDataBound);
    this.readable.on('end', this.onEndBound);

    logger.info(`MCP Stdio Transport started for tenant '${this.context.tenantId}'`);
  }

  /**
   * Stops listening and cleans up listeners.
   */
  public close(): void {
    if (!this.isRunning) return;
    this.isRunning = false;

    this.readable.removeListener('data', this.onDataBound);
    this.readable.removeListener('end', this.onEndBound);

    logger.info(`MCP Stdio Transport stopped for tenant '${this.context.tenantId}'`);
  }

  private async handleData(chunk: Buffer | string): Promise<void> {
    this.buffer += chunk.toString('utf8');

    let newlineIndex = this.buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);

      if (line.length > 0) {
        await this.processLine(line);
      }

      newlineIndex = this.buffer.indexOf('\n');
    }
  }

  private async processLine(line: string): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (err: any) {
      const parseError: JsonRpcResponse = {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: McpErrorCodes.PARSE_ERROR,
          message: `Parse error: Invalid JSON received (${err.message})`,
        },
      };
      this.writeResponse(parseError);
      return;
    }

    try {
      const response = await this.server.handleMessage(parsed, this.context);
      if (response !== null) {
        this.writeResponse(response);
      }
    } catch (err: any) {
      const internalError: JsonRpcResponse = {
        jsonrpc: '2.0',
        id: (parsed as any)?.id ?? null,
        error: {
          code: McpErrorCodes.INTERNAL_ERROR,
          message: err.message || 'Internal transport error processing MCP message',
        },
      };
      this.writeResponse(internalError);
    }
  }

  private writeResponse(response: JsonRpcResponse): void {
    const serialized = JSON.stringify(response) + '\n';
    this.writable.write(serialized);
  }

  private handleEnd(): void {
    if (this.buffer.trim().length > 0) {
      this.processLine(this.buffer.trim()).catch(() => {});
      this.buffer = '';
    }
  }
}
