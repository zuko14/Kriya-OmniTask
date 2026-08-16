import { describe, it, expect } from 'vitest';
import { DryRunSandbox } from '../../src/simulation/sandbox/dryRunSandbox.js';
import { SimulationScenarioRecord } from '../../src/simulation/types/simulationTypes.js';

describe('Dry Run Sandbox Virtual Environment Unit Tests', () => {
  it('should execute simulation in virtual sandbox with mock tools and zero production side effects', async () => {
    const mockScenario: SimulationScenarioRecord = {
      id: 'scen_mock_1',
      tenant_id: 'tenant_mock',
      organization_id: 'default',
      name: 'Lead Qualification Sandbox Test',
      description: 'Tests lead qualification flow in sandbox mode',
      category: 'lead_qualification',
      target_agent_id: 'lead_qualifier',
      mock_customer_json: JSON.stringify({ fullName: 'Alice Smith', companySize: 50 }),
      initial_message: 'Hi, I need enterprise pricing for 50 users.',
      conversation_history_json: '[]',
      mock_tool_responses_json: JSON.stringify({
        crm_check_lead: { status: 'qualified', leadScore: 92 },
      }),
      expected_outcomes_json: JSON.stringify({
        expectedToolsCalled: ['crm_check_lead'],
        expectedKeywords: ['Enterprise', 'schedule'],
      }),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const result = await DryRunSandbox.execute({
      scenario: mockScenario,
    });

    expect(result.simulatedOutput).toBeDefined();
    expect(result.simulatedToolCalls.length).toBeGreaterThanOrEqual(1);
    expect(result.simulatedToolCalls[0].toolName).toBe('crm_check_lead');
    expect(result.policyVerdicts).toContain('approved');
    expect(result.comparisonReport.overallResult).toBe('passed');
    expect(result.tokensUsed).toBeGreaterThan(0);
    expect(result.costUsd).toBeGreaterThan(0);
  });
});
