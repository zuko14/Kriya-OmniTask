import { describe, it, expect } from 'vitest';
import { IsolatedFetcherWorker } from '../../src/retrieval/external/fetcher/isolatedFetcher.js';

describe('Isolated Fetcher Worker Unit Tests (§10.3, §10.4, Criterion 2)', () => {
  it('should provably verify zero database credentials, zero secrets, and zero tool access', () => {
    const fetcher = new IsolatedFetcherWorker();
    const isolation = fetcher.verifyIsolation();

    expect(isolation.isIsolated).toBe(true);
    expect(isolation.hasDatabaseAccess).toBe(false);
    expect(isolation.hasSecretVaultAccess).toBe(false);
    expect(isolation.hasToolAccess).toBe(false);
  });

  it('should fetch HTML content using sandboxed HTTP fetch adapter', async () => {
    const mockHtml = '<html><body><h1>Acme Corporation</h1><p>Q3 Revenue: 50M USD</p></body></html>';
    const mockFetch = async () =>
      new Response(mockHtml, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });

    const fetcher = new IsolatedFetcherWorker(mockFetch as any);
    const result = await fetcher.fetchUrl('https://example.com/financials');

    expect(result.statusCode).toBe(200);
    expect(result.domain).toBe('example.com');
    expect(result.rawContent).toContain('Acme Corporation');
    expect(result.contentType).toBe('text/html');
  });

  it('should reject untrusted binary or disallowed content types', async () => {
    const mockBinaryFetch = async () =>
      new Response('binary_executable_bytes', {
        status: 200,
        headers: { 'content-type': 'application/octet-stream' },
      });

    const fetcher = new IsolatedFetcherWorker(mockBinaryFetch as any);
    await expect(fetcher.fetchUrl('https://example.com/binary.exe')).rejects.toThrow(
      /Untrusted or binary content type 'application\/octet-stream' rejected/
    );
  });
});
