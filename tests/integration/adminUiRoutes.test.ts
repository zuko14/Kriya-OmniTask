import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server.js';

describe('Admin UI Routes Integration Tests', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildServer();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should serve HTML document at /admin and /admin/dashboard', async () => {
    const res1 = await app.inject({
      method: 'GET',
      url: '/admin',
    });
    expect(res1.statusCode).toBe(200);
    expect(res1.headers['content-type']).toContain('text/html');
    expect(res1.body).toContain('Xylarc AI — Operator Control Plane');

    const res2 = await app.inject({
      method: 'GET',
      url: '/admin/dashboard',
    });
    expect(res2.statusCode).toBe(200);
    expect(res2.headers['content-type']).toContain('text/html');
  });

  it('should serve CSS stylesheet at /admin/assets/app.css', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/assets/app.css',
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/css');
    expect(res.body).toContain('--color-primary: #00f0ff;');
  });

  it('should serve client JavaScript at /admin/assets/app.js', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/assets/app.js',
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/javascript');
    expect(res.body).toContain('switchTab');
  });

  it('should return system status at /admin/api/status', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/api/status',
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.status).toBe('healthy');
    expect(json.version).toBe('1.0.0');
    expect(json.workforceStatus).toBe('operational');
    expect(json.activeAgents.length).toBe(4);
  });
});
