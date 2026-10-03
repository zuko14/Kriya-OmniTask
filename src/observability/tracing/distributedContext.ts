/**
 * Kriya AI — W3C Trace Context & Distributed Trace Propagation
 * Compliant with W3C Trace Context Specification (Recommendation 23 Nov 2021)
 * providing traceparent, tracestate, and AsyncLocalStorage propagation across async tasks.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';

export interface DistributedTraceContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  traceFlags: string;
  tracestate?: Record<string, string>;
  correlationId: string;
  tenantId?: string;
  baggage?: Record<string, string>;
}

export interface ParsedTraceparent {
  version: string;
  traceId: string;
  parentId: string;
  flags: string;
}

const TRACEPARENT_REGEX = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i;
const ALL_ZEROS_32 = '00000000000000000000000000000000';
const ALL_ZEROS_16 = '0000000000000000';

export class DistributedContextManager {
  private static storage = new AsyncLocalStorage<DistributedTraceContext>();

  /**
   * Generates a standard W3C 16-byte (32 hex characters) trace ID.
   */
  public static generateTraceId(): string {
    let id: string;
    do {
      id = randomBytes(16).toString('hex').toLowerCase();
    } while (id === ALL_ZEROS_32);
    return id;
  }

  /**
   * Generates a standard W3C 8-byte (16 hex characters) span ID.
   */
  public static generateSpanId(): string {
    let id: string;
    do {
      id = randomBytes(8).toString('hex').toLowerCase();
    } while (id === ALL_ZEROS_16);
    return id;
  }

  /**
   * Formats a W3C traceparent header string.
   */
  public static formatTraceparent(
    traceId: string,
    spanId: string,
    flags = '01',
    version = '00'
  ): string {
    return `${version}-${traceId}-${spanId}-${flags}`;
  }

  /**
   * Parses and validates a W3C traceparent header string.
   */
  public static parseTraceparent(header?: string | null): ParsedTraceparent | null {
    if (!header || typeof header !== 'string') return null;

    const trimmed = header.trim();
    const match = trimmed.match(TRACEPARENT_REGEX);
    if (!match) return null;

    const [, version, traceId, parentId, flags] = match;

    // Version ff is invalid according to W3C spec
    if (version === 'ff') return null;
    // TraceId and ParentId cannot be all zeros
    if (traceId === ALL_ZEROS_32 || parentId === ALL_ZEROS_16) return null;

    return {
      version: version.toLowerCase(),
      traceId: traceId.toLowerCase(),
      parentId: parentId.toLowerCase(),
      flags: flags.toLowerCase(),
    };
  }

  /**
   * Parses a W3C tracestate header string into key-value pairs.
   */
  public static parseTracestate(header?: string | null): Record<string, string> {
    const result: Record<string, string> = {};
    if (!header || typeof header !== 'string') return result;

    const pairs = header.split(',');
    for (const rawPair of pairs) {
      const pair = rawPair.trim();
      if (!pair) continue;
      const eqIdx = pair.indexOf('=');
      if (eqIdx > 0) {
        const key = pair.slice(0, eqIdx).trim();
        const value = pair.slice(eqIdx + 1).trim();
        if (key && value) {
          result[key] = value;
        }
      }
    }

    return result;
  }

  /**
   * Formats key-value pairs into a W3C tracestate header string.
   */
  public static formatTracestate(state?: Record<string, string>): string {
    if (!state || Object.keys(state).length === 0) return '';
    return Object.entries(state)
      .map(([k, v]) => `${k}=${v}`)
      .join(',');
  }

  /**
   * Extracts distributed trace context from HTTP headers with graceful fallback to new context.
   */
  public static extractFromHeaders(
    headers: Record<string, string | string[] | undefined>
  ): DistributedTraceContext {
    const rawTraceparent = typeof headers['traceparent'] === 'string'
      ? headers['traceparent']
      : Array.isArray(headers['traceparent'])
      ? headers['traceparent'][0]
      : undefined;

    const rawTracestate = typeof headers['tracestate'] === 'string'
      ? headers['tracestate']
      : Array.isArray(headers['tracestate'])
      ? headers['tracestate'][0]
      : undefined;

    const rawCorrelationId = typeof headers['x-correlation-id'] === 'string'
      ? headers['x-correlation-id']
      : typeof headers['x-request-id'] === 'string'
      ? headers['x-request-id']
      : undefined;

    const parsed = this.parseTraceparent(rawTraceparent);
    const tracestate = this.parseTracestate(rawTracestate);

    if (parsed) {
      const spanId = this.generateSpanId();
      const correlationId = rawCorrelationId || parsed.traceId;
      return {
        traceId: parsed.traceId,
        spanId,
        parentSpanId: parsed.parentId,
        traceFlags: parsed.flags,
        tracestate,
        correlationId,
        tenantId: tracestate['tenant'] || undefined,
        baggage: {},
      };
    }

    // New root context
    const traceId = this.generateTraceId();
    const spanId = this.generateSpanId();
    const correlationId = rawCorrelationId || traceId;

    return {
      traceId,
      spanId,
      traceFlags: '01',
      tracestate,
      correlationId,
      tenantId: tracestate['tenant'] || undefined,
      baggage: {},
    };
  }

  /**
   * Injects traceparent, tracestate, and x-correlation-id into an outgoing headers object.
   */
  public static injectToHeaders(
    context: DistributedTraceContext,
    headers: Record<string, string> = {}
  ): Record<string, string> {
    headers['traceparent'] = this.formatTraceparent(
      context.traceId,
      context.spanId,
      context.traceFlags
    );

    const tracestateStr = this.formatTracestate(context.tracestate);
    if (tracestateStr) {
      headers['tracestate'] = tracestateStr;
    }

    if (context.correlationId) {
      headers['x-correlation-id'] = context.correlationId;
    }

    return headers;
  }

  /**
   * Executes a callback within the scope of a DistributedTraceContext.
   */
  public static run<R>(context: DistributedTraceContext, fn: () => R): R {
    return this.storage.run(context, fn);
  }

  /**
   * Retrieves the current DistributedTraceContext from the async execution context.
   */
  public static current(): DistributedTraceContext | undefined {
    return this.storage.getStore();
  }

  /**
   * Creates a child span context under the active trace context.
   */
  public static createChildContext(tenantId?: string): DistributedTraceContext {
    const parent = this.current();
    if (!parent) {
      const traceId = this.generateTraceId();
      const spanId = this.generateSpanId();
      return {
        traceId,
        spanId,
        traceFlags: '01',
        correlationId: traceId,
        tenantId,
        baggage: {},
      };
    }

    return {
      traceId: parent.traceId,
      spanId: this.generateSpanId(),
      parentSpanId: parent.spanId,
      traceFlags: parent.traceFlags,
      tracestate: parent.tracestate ? { ...parent.tracestate } : {},
      correlationId: parent.correlationId,
      tenantId: tenantId || parent.tenantId,
      baggage: parent.baggage ? { ...parent.baggage } : {},
    };
  }
}
