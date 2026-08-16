import { describe, it, expect } from 'vitest';
import { RedTeamValidator } from '../../src/hardening/security/redTeamValidator.js';

describe('RedTeamValidator Unit Tests', () => {
  it('should execute adversarial security probes and prove isolation boundaries against SQLi, JWT forgery, IDOR, and prompt injection', () => {
    const audit = RedTeamValidator.runAudit('Unit Adversarial Red-Team Audit');

    expect(audit.id).toBeDefined();
    expect(audit.totalProbes).toBe(4);
    expect(audit.attacksBlocked).toBe(4);
    expect(audit.vulnerabilitiesFound).toBe(0);
    expect(audit.threatScore).toBe(0.0);
    expect(audit.status).toBe('passed');

    const probeNames = audit.findings.map((f) => f.probeName);
    expect(probeNames).toContain('sql_injection_parameter_isolation');
    expect(probeNames).toContain('jwt_tampering_forgery');
    expect(probeNames).toContain('indirect_prompt_injection_shield');
    expect(probeNames).toContain('cross_tenant_idor_boundary');
  });
});
