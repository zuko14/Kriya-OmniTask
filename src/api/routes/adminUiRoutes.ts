/**
 * Xylarc AI — Admin Control Plane UI Routes
 * Serves the single-page application dashboard, CSS styling, client JavaScript, and health status probe.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { renderDashboardHtml } from '../../admin/ui/dashboardHtml.js';
import { DASHBOARD_CSS } from '../../admin/ui/dashboardCss.js';
import { DASHBOARD_JS } from '../../admin/ui/dashboardJs.js';

export async function adminUiRoutes(app: FastifyInstance): Promise<void> {
  // 1. Dashboard Root HTML
  const serveHtml = async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply
      .header('Content-Type', 'text/html; charset=utf-8')
      .header('X-Content-Type-Options', 'nosniff')
      .header('X-Frame-Options', 'SAMEORIGIN')
      .header('X-XSS-Protection', '1; mode=block')
      .send(renderDashboardHtml());
  };

  app.get('/admin', serveHtml);
  app.get('/admin/dashboard', serveHtml);

  // 2. CSS Stylesheet Asset
  app.get('/admin/assets/app.css', async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply
      .header('Content-Type', 'text/css; charset=utf-8')
      .header('Cache-Control', 'public, max-age=3600')
      .send(DASHBOARD_CSS);
  });

  // 3. Client JavaScript Asset
  app.get('/admin/assets/app.js', async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply
      .header('Content-Type', 'application/javascript; charset=utf-8')
      .header('Cache-Control', 'public, max-age=3600')
      .send(DASHBOARD_JS);
  });

  // 4. Operator Dashboard Status API
  app.get('/admin/api/status', async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      status: 'healthy',
      version: '1.0.0',
      workforceStatus: 'operational',
      activeAgents: ['lead_qualifier', 'calendar_booker', 'customer_support', 'retention_reactivator'],
      timestamp: new Date().toISOString(),
    });
  });
}
