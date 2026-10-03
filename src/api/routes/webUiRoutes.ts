/**
 * Kriya Omnitask — Web Console Hosting
 * Serves the compiled web console (web/dist) from the API origin so /admin (client admin portal)
 * and /owner (platform owner console) resolve on the same host as /api. Unknown non-API GETs
 * fall back to index.html for client-side routing; /api/* misses stay JSON 404s.
 */

import { FastifyInstance } from 'fastify';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

export function registerWebUi(fastify: FastifyInstance, distDir = resolve(process.cwd(), 'web', 'dist')): boolean {
  const indexPath = join(distDir, 'index.html');
  if (!existsSync(indexPath)) return false;
  const root = distDir + sep;

  fastify.setNotFoundHandler((request, reply) => {
    let path: string;
    try {
      path = decodeURIComponent(request.url.split('?')[0] ?? '/');
    } catch {
      path = '/';
    }
    if ((request.method !== 'GET' && request.method !== 'HEAD') || path.startsWith('/api/') || path === '/metrics') {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: `Route ${request.method} ${path} not found`, statusCode: 404 },
      });
    }

    reply
      .header('X-Content-Type-Options', 'nosniff')
      .header('X-Frame-Options', 'DENY')
      .header('Referrer-Policy', 'strict-origin-when-cross-origin')
      .header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

    const candidate = resolve(distDir, '.' + path);
    if (candidate.startsWith(root) && existsSync(candidate) && statSync(candidate).isFile()) {
      const immutable = path.startsWith('/assets/'); // Vite content-hashes everything under /assets
      return reply
        .header('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=3600')
        .type(MIME[extname(candidate).toLowerCase()] ?? 'application/octet-stream')
        .send(readFileSync(candidate));
    }

    // A missing hashed asset (stale tab after a deploy) must 404, not receive HTML as JavaScript.
    if (path.startsWith('/assets/')) {
      return reply.status(404).type('text/plain; charset=utf-8').send('Not found');
    }

    // SPA route (/admin, /owner/tenants/..., etc.) — never cache the shell so deploys take effect immediately.
    return reply
      .header('Cache-Control', 'no-cache')
      .header('Content-Security-Policy', CSP)
      .type(MIME['.html'])
      .send(readFileSync(indexPath));
  });
  return true;
}
