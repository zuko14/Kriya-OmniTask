/**
 * Kriya AI — Production Security Hardening & VAPT Test Suite (WP-8.1, Milestone M8)
 *
 * Verifies SSRFGuard, TenantRateLimiter, SecretRotationEngine (256-bit entropy & Ed25519 proofs),
 * SecretLeakageScanner, DependencyAuditScanner, and the 12-probe automated VAPT Engine.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SSRFGuard, SsrfSecurityError } from '../../src/security/ssrf/ssrfGuard.js';
import { TenantRateLimiter } from '../../src/security/ratelimit/tenantRateLimiter.js';
import { SecretRotationEngine } from '../../src/security/hardening/rotation/secretRotationEngine.js';
import { SecretLeakageScanner } from '../../src/security/audit/secretLeakageScanner.js';
import { DependencyAuditScanner } from '../../src/security/audit/dependencyAuditScanner.js';
import { VaptEngine } from '../../src/security/vapt/vaptEngine.js';
import { SecurityHardeningService } from '../../src/security/hardening/service/securityHardeningService.js';
import { TenantContextManager } from '../../src/core/context/tenantContext.js';

describe('WP-8.1: Security Hardening & VAPT Production Suite', () => {
  // --------------------------------------------------------------------------
  // 1. Centralized SSRF Guard
  // --------------------------------------------------------------------------
  describe('SSRF Guard Network Boundary Defense', () => {
    it('should strictly block loopback addresses in IPv4, IPv6, and localhost names', () => {
      const loopbacks = [
        'http://127.0.0.1:8080/admin',
        'http://127.0.1.1',
        'http://localhost',
        'http://localhost:3000/api',
        'http://[::1]',
        'http://[::1]:8080/metrics',
        'http://ip6-localhost',
      ];

      for (const url of loopbacks) {
        expect(() => SSRFGuard.validateUrl(url)).toThrow(SsrfSecurityError);
        expect(() => SSRFGuard.validateUrl(url)).toThrow(/private, loopback, or cloud metadata/);
      }
    });

    it('should block decimal, hexadecimal, and octal IP evasions', () => {
      const evasions = [
        'http://2130706433', // 127.0.0.1 in decimal
        'http://2130706433:8080/secret',
        'http://0x7f000001', // 127.0.0.1 in hex
        'http://0x7f.1',
      ];

      for (const url of evasions) {
        expect(() => SSRFGuard.validateUrl(url)).toThrow(SsrfSecurityError);
      }
    });

    it('should block AWS, GCP, and Azure cloud instance metadata endpoints', () => {
      const metadataUrls = [
        'http://169.254.169.254/latest/meta-data/',
        'http://169.254.169.254/latest/meta-data/iam/security-credentials/',
        'http://metadata.google.internal/computeMetadata/v1/',
        'http://metadata.internal',
        'http://instance-data',
      ];

      for (const url of metadataUrls) {
        expect(() => SSRFGuard.validateUrl(url)).toThrow(SsrfSecurityError);
      }
    });

    it('should block RFC 1918 private subnets, CGNAT, and broadcast ranges', () => {
      const privateUrls = [
        'http://10.0.0.1/admin',
        'http://10.255.255.254',
        'http://172.16.0.1:9000',
        'http://172.31.255.255',
        'http://192.168.1.1/router',
        'http://100.64.0.1', // CGNAT RFC 6598
        'http://0.0.0.0', // Broadcast
      ];

      for (const url of privateUrls) {
        expect(() => SSRFGuard.validateUrl(url)).toThrow(SsrfSecurityError);
      }
    });

    it('should allow legitimate public HTTP and HTTPS endpoints', () => {
      const publicUrls = [
        'https://api.github.com/repos',
        'https://vantage.csw.lenovo.com/v1/web',
        'https://example.com/api/v1',
        'http://example.com',
      ];

      for (const url of publicUrls) {
        const result = SSRFGuard.validateUrl(url);
        expect(result.valid).toBe(true);
        expect(result.domain).toBeDefined();
      }
    });

    it('should enforce domain allowlists with exact and wildcard matching', () => {
      const allowed = ['*.example.com', 'trusted.partner.org'];

      expect(SSRFGuard.validateUrl('https://portal.example.com', { allowedDomains: allowed }).valid).toBe(true);
      expect(SSRFGuard.validateUrl('https://example.com', { allowedDomains: allowed }).valid).toBe(true);
      expect(SSRFGuard.validateUrl('https://trusted.partner.org/feed', { allowedDomains: allowed }).valid).toBe(true);

      // Disallowed domain
      expect(() =>
        SSRFGuard.validateUrl('https://attacker.com/leak', { allowedDomains: allowed })
      ).toThrow(SsrfSecurityError);
    });

    it('should reject DNS rebinding resolving to private IP via assertSafeUrl', async () => {
      // Mock DNS lookup function returning a private IP
      const mockDns = async (_host: string) => ['192.168.1.100'];

      await expect(
        SSRFGuard.assertSafeUrl('https://rebind.attacker.com', { dnsLookupFn: mockDns })
      ).rejects.toThrow(SsrfSecurityError);
    });
  });

  // --------------------------------------------------------------------------
  // 2. Multi-Tenant Sliding-Window Rate Limiter & Abuse Governor
  // --------------------------------------------------------------------------
  describe('Multi-Tenant Sliding-Window Rate Limiter & Abuse Governor', () => {
    let limiter: TenantRateLimiter;
    let mockAttention: any;

    beforeEach(() => {
      mockAttention = {
        escalateToHuman: vi.fn().mockResolvedValue({ id: 'att-123' }),
      };
      limiter = new TenantRateLimiter(mockAttention);
      limiter.clearAll();
    });

    it('should allow requests within tiered quota and update remaining count', async () => {
      const tenant = 'tenant-test-1';
      const cat = 'auth'; // Limit 10

      const res1 = await limiter.checkRateLimit({ tenantId: tenant, category: cat });
      expect(res1.allowed).toBe(true);
      expect(res1.limit).toBe(10);
      expect(res1.remaining).toBe(9);
      expect(res1.currentCount).toBe(1);

      const headers = TenantRateLimiter.getHeaders(res1);
      expect(headers['X-RateLimit-Limit']).toBe('10');
      expect(headers['X-RateLimit-Remaining']).toBe('9');
      expect(headers['X-RateLimit-Reset']).toBeDefined();
    });

    it('should reject requests exceeding quota with 429 Retry-After headers', async () => {
      const tenant = 'tenant-test-burst';
      limiter.setTenantOverride(tenant, 'tools', 3);

      // 3 allowed
      for (let i = 0; i < 3; i++) {
        const res = await limiter.checkRateLimit({ tenantId: tenant, category: 'tools' });
        expect(res.allowed).toBe(true);
      }

      // 4th request throttled
      const throttled = await limiter.checkRateLimit({ tenantId: tenant, category: 'tools' });
      expect(throttled.allowed).toBe(false);
      expect(throttled.remaining).toBe(0);
      expect(throttled.retryAfterSeconds).toBeGreaterThan(0);

      const headers = TenantRateLimiter.getHeaders(throttled);
      expect(headers['Retry-After']).toBeDefined();
    });

    it('should track strikes and escalate sustained abuse to Attention Center', async () => {
      const tenant = 'tenant-abuser';
      limiter.setTenantOverride(tenant, 'auth', 2);

      // 2 allowed
      await limiter.checkRateLimit({ tenantId: tenant, category: 'auth' });
      await limiter.checkRateLimit({ tenantId: tenant, category: 'auth' });

      // Violations
      await limiter.checkRateLimit({ tenantId: tenant, category: 'auth' }); // strike 1
      await limiter.checkRateLimit({ tenantId: tenant, category: 'auth' }); // strike 2
      const res = await limiter.checkRateLimit({ tenantId: tenant, category: 'auth' }); // strike 3 (abuse)

      expect(res.isAbuse).toBe(true);
      expect(res.strikeCount).toBeGreaterThanOrEqual(3);
      expect(mockAttention.escalateToHuman).toHaveBeenCalled();
    });

    it('should report tenant status and allow administrative reset', async () => {
      const tenant = 'tenant-status-check';
      await limiter.checkRateLimit({ tenantId: tenant, category: 'agent_execution' });

      const status = limiter.getTenantStatus(tenant);
      expect(status.tenantId).toBe(tenant);
      expect(status.categories.agent_execution.currentCount).toBe(1);

      // Reset tenant
      limiter.resetTenant(tenant);
      const afterReset = limiter.getTenantStatus(tenant);
      expect(afterReset.categories.agent_execution.currentCount).toBe(0);
      expect(afterReset.categories.agent_execution.strikes).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // 3. Cryptographic Key Hygiene & Secret Rotation
  // --------------------------------------------------------------------------
  describe('Cryptographic Key Hygiene & Secret Rotation Engine', () => {
    const encKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

    it('should reject secrets with less than 256-bit entropy or short length', () => {
      // 1. Short string
      const shortRes = SecretRotationEngine.validateEntropy('short_secret');
      expect(shortRes.valid).toBe(false);
      expect(shortRes.reason).toContain('below the mandatory minimum of 32 characters');

      // 2. Low character diversity
      const lowDivRes = SecretRotationEngine.validateEntropy('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
      expect(lowDivRes.valid).toBe(false);
      expect(lowDivRes.reason).toContain('character diversity');
    });

    it('should accept 64-character hex keys and high-entropy secrets', () => {
      const hexKey = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
      const res = SecretRotationEngine.validateEntropy(hexKey);
      expect(res.valid).toBe(true);
      expect(res.bits).toBeGreaterThanOrEqual(256);
    });

    it('should issue Ed25519 proof receipts and record rotation in audit ledger', async () => {
      const mockRepo: any = {
        getActiveSecret: vi.fn().mockResolvedValue(null),
        saveSecretRotation: vi.fn().mockResolvedValue({
          id: 'sec-1',
          secret_name: 'PAYMENT_GATEWAY_KEY',
          secret_version: 1,
          status: 'active',
          rotated_at: new Date().toISOString(),
        }),
        revokeExpiredSecrets: vi.fn().mockResolvedValue({ count: 0, ids: [] }),
        appendAuditEvent: vi.fn().mockResolvedValue({ id: 'aud-1' }),
        listSecrets: vi.fn().mockResolvedValue([]),
      };

      const mockProofService: any = {
        issue: vi.fn().mockResolvedValue({
          body: { receiptId: 'rcpt_sec_rot_123' },
          hash: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
        }),
      };

      const service = new SecurityHardeningService(mockRepo, mockProofService);

      const result = await TenantContextManager.withTenant('t-sec', 'org-sec', async () => {
        return service.rotateSecret({
          secretName: 'PAYMENT_GATEWAY_KEY',
          newSecretValue: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
          gracePeriodSeconds: 3600,
        });
      });

      expect(result.secretName).toBe('PAYMENT_GATEWAY_KEY');
      expect(result.newVersion).toBe(1);
      expect(result.proofReceiptId).toBe('rcpt_sec_rot_123');
      expect(result.receiptHash).toBeDefined();
      expect(mockProofService.issue).toHaveBeenCalled();
      expect(mockRepo.revokeExpiredSecrets).toHaveBeenCalled();
    });

    it('should evaluate secret vault hygiene and detect expired grace period secrets', async () => {
      const mockRepo: any = {
        listSecrets: vi.fn().mockResolvedValue([
          { secret_name: 'KEY_1', secret_version: 2, status: 'active' },
          { secret_name: 'KEY_1', secret_version: 1, status: 'grace_period', expires_at: new Date(Date.now() - 1000).toISOString() },
        ]),
        revokeExpiredSecrets: vi.fn().mockResolvedValue({ count: 1, ids: ['sec-expired-1'] }),
      };

      const service = new SecurityHardeningService(mockRepo);
      const hygiene = await service.getSecretHygieneReport();

      expect(hygiene.totalSecrets).toBe(2);
      expect(hygiene.activeSecrets).toBe(1);
      expect(hygiene.expiredGraceSecretsRevoked).toBe(1);
      expect(hygiene.entropyCompliant).toBe(true);
      expect(hygiene.hygieneStatus).toBe('HEALTHY');
    });
  });

  // --------------------------------------------------------------------------
  // 4. Secret Leakage Scanner
  // --------------------------------------------------------------------------
  describe('Secret Leakage Scanner & Sanitizer', () => {
    it('should detect exposed OpenAI, Razorpay, GitHub, AWS, and private keys', () => {
      const payload = `
        const config = {
          openai: "sk-abcdef1234567890abcdef1234567890",
          razorpay: "rzp_live_12345678901234",
          github: "ghp_123456789012345678901234567890123456",
          aws: "AKIAIOSFODNN7EXAMPLE",
        };
      `;

      const findings = SecretLeakageScanner.scanContent(payload, 'src/config.ts');
      expect(findings.length).toBeGreaterThanOrEqual(4);

      const types = findings.map((f) => f.secretType);
      expect(types).toContain('openai_api_key');
      expect(types).toContain('razorpay_key');
      expect(types).toContain('github_token');
      expect(types).toContain('aws_access_key');
    });

    it('should cleanly redact detected secrets from content', () => {
      const raw = 'Authorization: Bearer sk-abcdef1234567890abcdef1234567890 and key rzp_test_12345678901234';
      const redacted = SecretLeakageScanner.redactSecrets(raw);

      expect(redacted).not.toContain('sk-abcdef');
      expect(redacted).not.toContain('rzp_test_');
      expect(redacted).toContain('[REDACTED_OPENAI_API_KEY]');
      expect(redacted).toContain('[REDACTED_RAZORPAY_KEY]');
    });

    it('should recursively scan structured objects for leaked secrets', () => {
      const obj = {
        metadata: {
          token: 'sk-abcdef1234567890abcdef1234567890',
        },
        items: ['clean_item', 'rzp_test_12345678901234'],
      };

      const findings = SecretLeakageScanner.scanObject(obj);
      expect(findings.length).toBe(2);
    });
  });

  // --------------------------------------------------------------------------
  // 5. Dependency & Native Code Execution Audit Scanner
  // --------------------------------------------------------------------------
  describe('Dependency & Dangerous Native Code Audit Scanner', () => {
    it('should detect dangerous eval(), dynamic Function(), and child_process calls', () => {
      const dangerousCode = `
        const result = eval("2 + 2");
        const fn = new Function("a", "return a");
        cp.exec("ls -la");
        vm.runInContext(code, context);
      `;

      const findings = DependencyAuditScanner.scanCode(dangerousCode, 'sample.ts');
      expect(findings.length).toBeGreaterThanOrEqual(4);

      const rules = findings.map((f) => f.rule);
      expect(rules).toContain('NO_RAW_EVAL');
      expect(rules).toContain('NO_FUNCTION_CONSTRUCTOR');
      expect(rules).toContain('RESTRICTED_CHILD_PROCESS_EXEC');
      expect(rules).toContain('NO_VM_UNSAFE_RUN');
    });

    it('should flag unpinned wildcard or latest package dependencies', () => {
      const manifest = JSON.stringify({
        name: 'test-app',
        dependencies: {
          'risky-lib': '*',
          'another-lib': 'latest',
          'safe-lib': '^1.2.3',
        },
      });

      const findings = DependencyAuditScanner.scanManifest(manifest, 'package.json');
      expect(findings.length).toBe(2);
      expect(findings[0].rule).toBe('UNPINNED_DEPENDENCY');
    });
  });

  // --------------------------------------------------------------------------
  // 6. Automated 12-Probe VAPT Penetration Engine
  // --------------------------------------------------------------------------
  describe('Automated 12-Probe VAPT Penetration Engine', () => {
    it('should execute all 12 penetration probes and achieve a 100% security score', async () => {
      const engine = new VaptEngine();
      const report = await engine.runFullSuite();

      expect(report.auditId).toBeDefined();
      expect(report.totalProbes).toBe(12);
      expect(report.passedProbes).toBe(12);
      expect(report.failedProbes).toBe(0);
      expect(report.securityScore).toBe(100);
      expect(report.overallStatus).toBe('SECURE');

      // Verify each expected probe is present and passing
      const expectedProbeIds = [
        'VAPT-PROBE-01',
        'VAPT-PROBE-02',
        'VAPT-PROBE-03',
        'VAPT-PROBE-04',
        'VAPT-PROBE-05',
        'VAPT-PROBE-06',
        'VAPT-PROBE-07',
        'VAPT-PROBE-08',
        'VAPT-PROBE-09',
        'VAPT-PROBE-10',
        'VAPT-PROBE-11',
        'VAPT-PROBE-12',
      ];

      const returnedProbeIds = report.probes.map((p) => p.probeId);
      for (const expectedId of expectedProbeIds) {
        expect(returnedProbeIds).toContain(expectedId);
      }

      for (const probe of report.probes) {
        expect(probe.status).toBe('PASSED');
        expect(probe.durationMs).toBeGreaterThanOrEqual(0);
      }
    });
  });
});
