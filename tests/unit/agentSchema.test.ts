/**
 * Xylarc AI — Agent Schema & Output Contract Unit Tests
 * Validates Zod formal agent specifications, limits, and structured output contracts (§12, §15, §39 of CLAUDE.md).
 */

import { describe, it, expect } from 'vitest';
import {
  AgentSpecificationSchema,
  StructuredAgentOutputSchema,
  AutonomyLevelEnum,
  RiskTierEnum,
} from '../../src/agents/types/agentTypes.js';

describe('Agent Specification & Output Schema Tests', () => {
  it('should validate a compliant agent specification', () => {
    const validSpec = {
      slug: 'lead_qualifier_v1',
      name: 'Lead Qualifier Agent',
      description: 'Qualifies inbound B2B enterprise leads',
      category: 'specialist' as const,
      department: 'sales' as const,
      autonomyLevel: 2 as const,
      riskTier: 'LOW' as const,
      version: '1.0.0',
      isSystem: false,
      config: {
        systemPrompt: 'You are an enterprise sales qualifier. Ask 3 discovery questions.',
        tools: ['crm_lookup', 'calendar_check'],
        dataAccessScope: ['customer_profile'],
        modelPolicy: {
          primaryModel: 'gemini-2.5-flash',
          temperature: 0.2,
          maxTokens: 2048,
        },
        escalationRules: {
          triggers: ['deal_size_over_50k'],
          escalationTarget: 'human' as const,
          minConfidenceThreshold: 0.85,
        },
        limits: {
          maxConcurrentTasks: 10,
          maxCostPerExecutionUsd: 0.20,
          timeoutMs: 15000,
          maxDailyOutreachPerCustomer: 3,
        },
        verificationApproach: 'deterministic' as const,
        owner: 'sales_ops',
      },
    };

    const parsed = AgentSpecificationSchema.parse(validSpec);
    expect(parsed.slug).toBe('lead_qualifier_v1');
    expect(parsed.autonomyLevel).toBe(2);
    expect(parsed.config.tools).toHaveLength(2);
  });

  it('should reject invalid slug formats or missing system prompt', () => {
    expect(() =>
      AgentSpecificationSchema.parse({
        slug: 'Invalid Slug With Spaces!',
        name: 'Invalid Agent',
        category: 'specialist',
        config: {
          systemPrompt: 'Short', // Under 10 chars
        },
      })
    ).toThrow();
  });

  it('should validate structured agent output according to §12 contract', () => {
    const outputPayload = {
      taskId: 'task-9988',
      status: 'completed' as const,
      facts: ['Customer owns 50 retail locations', 'Current software contract expires in 30 days'],
      evidence: [
        { source: 'crm_contract_record', timestamp: '2026-08-15T00:00:00Z', confidence: 0.98 },
        { source: 'customer_inbound_message', referenceId: 'msg-445' },
      ],
      confidence: 0.94,
      recommendedAction: 'Schedule priority consultation with VP of Sales',
      risks: ['Customer evaluating competitive offering'],
      policyFlags: [],
      requiresApproval: false,
      details: { estimatedDealValue: 75000 },
    };

    const validated = StructuredAgentOutputSchema.parse(outputPayload);
    expect(validated.status).toBe('completed');
    expect(validated.confidence).toBe(0.94);
    expect(validated.evidence).toHaveLength(2);
  });

  it('should enforce autonomy level boundaries (0-5)', () => {
    expect(AutonomyLevelEnum.safeParse(0).success).toBe(true);
    expect(AutonomyLevelEnum.safeParse(3).success).toBe(true);
    expect(AutonomyLevelEnum.safeParse(5).success).toBe(true);
    expect(AutonomyLevelEnum.safeParse(6).success).toBe(false);
    expect(AutonomyLevelEnum.safeParse(-1).success).toBe(false);
  });
});
