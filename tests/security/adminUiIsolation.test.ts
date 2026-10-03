import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerWebUi } from '../../src/api/routes/webUiRoutes.js';

/**
 * WP-7.6 retired the legacy server-rendered admin (hardcoded metrics, unauthenticated "healthy" status).
 * /admin and /owner now resolve to the React console shell; data only ever comes from authenticated /api calls.
 */
describe('Web console hosting (/admin, /owner)', () => {
  let app: FastifyInstance;
  let dist: string;

  beforeAll(async () => {
    dist = mkdtempSync(join(tmpdir(), 'kriya-web-'));
    mkdirSync(join(dist, 'assets'));
    writeFileSync(join(dist, 'index.html'), '<!doctype html><div id="root"></div><!--spa-shell-->');
    writeFileSync(join(dist, 'assets', 'index-abc123.js'), 'console.log(1)');
    app = Fastify();
    app.get('/api/v1/health', async () => ({ ok: true }));
    expect(registerWebUi(app, dist)).toBe(true);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    rmSync(dist, { recursive: true, force: true });
  });

  it.each(['/admin', '/admin/overview', '/owner', '/owner/tenants/tnt_x', '/admin/api/status'])(
    '%s serves the SPA shell with security headers and no server-rendered data',
    async (url) => {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('spa-shell');
      expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['cache-control']).toBe('no-cache');
    }
  );

  it('serves hashed assets with immutable caching', async () => {
    const res = await app.inject({ method: 'GET', url: '/assets/index-abc123.js' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('javascript');
    expect(res.headers['cache-control']).toContain('immutable');
  });

  it('keeps unknown API routes as JSON 404s and never serves the shell for non-GET', async () => {
    const api = await app.inject({ method: 'GET', url: '/api/v1/does-not-exist' });
    expect(api.statusCode).toBe(404);
    expect(JSON.parse(api.body).error.code).toBe('NOT_FOUND');
    const post = await app.inject({ method: 'POST', url: '/admin' });
    expect(post.statusCode).toBe(404);
  });

  it('does not serve files outside web/dist (path traversal)', async () => {
    for (const url of ['/../package.json', '/%2e%2e/%2e%2e/package.json', '/assets/../../secret']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.body).not.toContain('"dependencies"');
    }
  });

  it('404s a missing hashed asset instead of serving HTML as JavaScript', async () => {
    const res = await app.inject({ method: 'GET', url: '/assets/index-stale999.js' });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('spa-shell');
  });
});
