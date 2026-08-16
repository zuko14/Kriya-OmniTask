import { describe, it, expect } from 'vitest';
import { renderDashboardHtml } from '../../src/admin/ui/dashboardHtml.js';
import { DASHBOARD_CSS } from '../../src/admin/ui/dashboardCss.js';
import { DASHBOARD_JS } from '../../src/admin/ui/dashboardJs.js';

describe('Admin UI Renderer Unit Tests', () => {
  it('should generate valid semantic HTML5 markup containing all 8 operational suites', () => {
    const html = renderDashboardHtml();

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('Xylarc AI — Operator Control Plane');
    expect(html).toContain('id="app-shell"');
    expect(html).toContain('id="sidebar"');
    expect(html).toContain('id="main-content"');
    expect(html).toContain('id="top-bar"');
    expect(html).toContain('id="modal-overlay"');
    expect(html).toContain('id="toast-container"');

    // Check all 8 operational suites
    expect(html).toContain('id="view-overview"');
    expect(html).toContain('id="view-workforce"');
    expect(html).toContain('id="view-customer360"');
    expect(html).toContain('id="view-cost"');
    expect(html).toContain('id="view-models"');
    expect(html).toContain('id="view-sre"');
    expect(html).toContain('id="view-deployment"');
    expect(html).toContain('id="view-hardening"');
  });

  it('should provide comprehensive glassmorphic CSS tokens and responsive rules', () => {
    expect(DASHBOARD_CSS).toContain('--bg-base: #06080e;');
    expect(DASHBOARD_CSS).toContain('--color-primary: #00f0ff;');
    expect(DASHBOARD_CSS).toContain('backdrop-filter: blur(');
    expect(DASHBOARD_CSS).toContain('.bento-grid');
    expect(DASHBOARD_CSS).toContain('@media (max-width: 768px)');
  });

  it('should provide complete client-side JavaScript with action handlers and token persistence', () => {
    expect(DASHBOARD_JS).toContain('localStorage.getItem(\'xylarc_admin_token\')');
    expect(DASHBOARD_JS).toContain('switchTab');
    expect(DASHBOARD_JS).toContain('apiFetch');
    expect(DASHBOARD_JS).toContain('runStressBenchmark');
    expect(DASHBOARD_JS).toContain('runChaosExperiment');
    expect(DASHBOARD_JS).toContain('runRedTeamAudit');
    expect(DASHBOARD_JS).toContain('fetchAndShowCertificate');
  });
});
