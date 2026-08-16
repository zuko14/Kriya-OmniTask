import { describe, it, expect } from 'vitest';
import { ProductionReadinessAuditor } from '../../src/hardening/readiness/productionReadinessAuditor.js';

describe('ProductionReadinessAuditor Unit Tests', () => {
  it('should evaluate full-platform 8-pillar maturity and generate signed production certificate', () => {
    const cert = ProductionReadinessAuditor.generateCertificate('1.0.0-enterprise');

    expect(cert.certificateId).toBeDefined();
    expect(cert.overallVerdict).toBe('PRODUCTION_READY');
    expect(cert.readinessScorePct).toBe(100);
    expect(cert.totalChecks).toBe(8);
    expect(cert.passedChecks).toBe(8);
    expect(cert.failedChecks).toBe(0);

    const checkCategories = cert.checks.map((c) => c.checkCategory);
    expect(checkCategories).toContain('Storage & Schema Migrations');
    expect(checkCategories).toContain('Multi-Tenancy & Isolation');
    expect(checkCategories).toContain('Model Provider Resilience');
    expect(checkCategories).toContain('Observability & SRE');
    expect(checkCategories).toContain('Deployment & Release Engineering');
  });
});
