import { describe, it, expect } from 'vitest';
import { KpiEngine } from '../../src/digitaltwin/kpi/kpiEngine.js';
import { OrganizationKpiRecord } from '../../src/digitaltwin/types/digitalTwinTypes.js';

describe('KPI Metric Evaluation Engine Unit Tests', () => {
  it('should evaluate higher-is-better metrics properly (e.g. lead conversion rate)', () => {
    // 1. On Track
    const res1 = KpiEngine.evaluateStatus('lead_conversion_rate', 30.0, 31.0);
    expect(res1.status).toBe('on_track');
    expect(res1.deviationPercent).toBeGreaterThan(0);

    // 2. Exceeded (> +10%)
    const res2 = KpiEngine.evaluateStatus('lead_conversion_rate', 30.0, 36.0);
    expect(res2.status).toBe('exceeded');

    // 3. At Risk (between 80% and 100%)
    const res3 = KpiEngine.evaluateStatus('lead_conversion_rate', 30.0, 25.0);
    expect(res3.status).toBe('at_risk');

    // 4. Critical (< 80%)
    const res4 = KpiEngine.evaluateStatus('lead_conversion_rate', 30.0, 15.0);
    expect(res4.status).toBe('critical');
  });

  it('should evaluate lower-is-better metrics properly (e.g. SLA response time)', () => {
    // 1. On Track (actual <= target)
    const res1 = KpiEngine.evaluateStatus('avg_response_time_seconds', 60.0, 45.0);
    expect(res1.status).toBe('on_track');

    // 2. At Risk (actual <= 1.25 * target)
    const res2 = KpiEngine.evaluateStatus('avg_response_time_seconds', 60.0, 70.0);
    expect(res2.status).toBe('at_risk');

    // 3. Critical (actual > 1.25 * target)
    const res3 = KpiEngine.evaluateStatus('avg_response_time_seconds', 60.0, 120.0);
    expect(res3.status).toBe('critical');
  });

  it('should format structured diagnosis summary from KPI record', () => {
    const kpi: OrganizationKpiRecord = {
      id: 'kpi_1',
      tenant_id: 'tenant_1',
      organization_id: 'default',
      kpi_name: 'Lead Conversion Rate',
      kpi_key: 'lead_conversion_rate',
      category: 'growth',
      target_value: 30.0,
      actual_value: 15.0,
      unit: 'percent',
      status: 'critical',
      timeframe: 'monthly',
      calculation_method_json: '{}',
      last_evaluated_at: '2026-01-01T00:00:00Z',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };

    const diagnosis = KpiEngine.evaluate(kpi);
    expect(diagnosis.status).toBe('critical');
    expect(diagnosis.summary).toContain('Immediate operational remediation required');
  });
});
