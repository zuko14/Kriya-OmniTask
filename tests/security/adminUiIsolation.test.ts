import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server.js';

/**
 * WP-7.6: the legacy server-rendered admin (src/admin/ui, S16/S25) is retired. It showed hardcoded metrics and
 * served an unauthenticated, hardcoded "healthy" status. The React console replaces it; these routes must be gone.
 */
describe('Legacy admin UI is retired', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildServer();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it.each(['/admin', '/admin/dashboard', '/admin/assets/app.css', '/admin/assets/app.js', '/admin/api/status'])(
    '%s returns 404',
    async (url) => {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(404);
    }
  );
});
