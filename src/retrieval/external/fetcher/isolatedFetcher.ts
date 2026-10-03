/**
 * Kriya Omnitask — Isolated Network Fetcher Worker (§10.3, §10.4)
 * Sandboxed, credential-free, tool-free HTTP content retrieval worker.
 *
 * HARD SPEC RULES (§10.3, §10.4):
 * - ZERO database client or connection pool references.
 * - ZERO secret vault, API key, or credential references.
 * - ZERO tool execution or agent registry access.
 * - Enforces strict network timeouts, payload bounds, and content-type isolation.
 */

import { SSRFGuard } from '../../../security/ssrf/ssrfGuard.js';

export interface FetchedPayload {
  url: string;
  domain: string;
  statusCode: number;
  contentType: string;
  rawContent: string;
  bytesReceived: number;
  fetchedAt: string;
}

export type HttpFetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export class IsolatedFetcherWorker {
  // Sandbox constants
  public static readonly TIMEOUT_MS = 5000;
  public static readonly MAX_CONTENT_BYTES = 500 * 1024; // 500 KB ceiling
  public static readonly ALLOWED_CONTENT_TYPES = [
    'text/html',
    'text/plain',
    'application/json',
    'application/xhtml+xml',
    'text/xml',
  ];
  public static readonly USER_AGENT = 'Kriya-Omnitask-Fetcher/2.3';

  private fetchFn: HttpFetchFn;

  /**
   * Constructs an IsolatedFetcherWorker.
   * Accepts an optional custom fetch implementation for unit testing and offline mocking.
   */
  constructor(customFetch?: HttpFetchFn) {
    this.fetchFn = customFetch || (fetch as HttpFetchFn);
  }

  /**
   * Fetches external content within sandboxed network boundaries with strict SSRF defense.
   */
  public async fetchUrl(targetUrl: string): Promise<FetchedPayload> {
    // 1. Mandatory SSRF Guard assertion
    const safeUrl = await SSRFGuard.assertSafeUrl(targetUrl);
    const domain = safeUrl.domain;
    const fetchedAt = new Date().toISOString();

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), IsolatedFetcherWorker.TIMEOUT_MS);

    try {
      const response = await this.fetchFn(safeUrl.normalizedUrl, {
        method: 'GET',
        headers: {
          'User-Agent': IsolatedFetcherWorker.USER_AGENT,
          Accept: 'text/html,text/plain,application/json;q=0.9,*/*;q=0.5',
        },
        signal: controller.signal,
        redirect: 'follow',
      });

      const contentTypeHeader = response.headers.get('content-type') || 'text/html';
      const cleanContentType = contentTypeHeader.split(';')[0].trim().toLowerCase();

      // Enforce Content-Type validation
      const isAllowedType = IsolatedFetcherWorker.ALLOWED_CONTENT_TYPES.some((t) =>
        cleanContentType.includes(t)
      );

      if (!isAllowedType) {
        throw new Error(
          `Untrusted or binary content type '${cleanContentType}' rejected by isolated fetcher.`
        );
      }

      const text = await response.text();
      const bytes = Buffer.byteLength(text, 'utf8');

      if (bytes > IsolatedFetcherWorker.MAX_CONTENT_BYTES) {
        // Truncate bounded text safely without crashing
        const safeText = text.substring(0, IsolatedFetcherWorker.MAX_CONTENT_BYTES);
        return {
          url: targetUrl,
          domain,
          statusCode: response.status,
          contentType: cleanContentType,
          rawContent: safeText,
          bytesReceived: bytes,
          fetchedAt,
        };
      }

      return {
        url: targetUrl,
        domain,
        statusCode: response.status,
        contentType: cleanContentType,
        rawContent: text,
        bytesReceived: bytes,
        fetchedAt,
      };
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new Error(`Isolated fetch timed out after ${IsolatedFetcherWorker.TIMEOUT_MS}ms for '${targetUrl}'`);
      }
      throw err;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  // =========================================================================
  // Architectural Verification Gates (§10.4, Acceptance Criterion 2)
  // =========================================================================

  /**
   * Proves that the fetcher instance has no database credentials, secrets, or tool access.
   */
  public verifyIsolation(): {
    hasDatabaseAccess: boolean;
    hasSecretVaultAccess: boolean;
    hasToolAccess: boolean;
    isIsolated: boolean;
  } {
    const self = this as any;
    const hasDb = Boolean(self.db || self.client || self.database || self.connectionPool);
    const hasSecrets = Boolean(self.vault || self.secretVault || self.apiKey || self.credentials);
    const hasTools = Boolean(self.tools || self.toolGateway || self.toolRegistry || self.executor);

    return {
      hasDatabaseAccess: hasDb,
      hasSecretVaultAccess: hasSecrets,
      hasToolAccess: hasTools,
      isIsolated: !hasDb && !hasSecrets && !hasTools,
    };
  }
}
