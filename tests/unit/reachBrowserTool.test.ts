/**
 * Kriya Omnitask — Reach Browser Automation Unit Tests (WP-5.5, Blueprint §10, §15, ADR-022)
 *
 * Verifies:
 * 1. Security Policy & Domain/Protocol/SSRF Enforcement:
 *    - Blocks unlisted domains, malicious protocols, private IPs, and cloud metadata (169.254.169.254).
 *    - Validates wildcard subdomain matching (*.domain.com).
 * 2. Action Allowlist & Step Bounds:
 *    - Enforces permitted action types and maxActionsPerSession limit.
 * 3. Per-Run Session Isolation:
 *    - Proves state, cookies, and DOM do not leak across distinct browser sessions.
 * 4. Screenshot Evidence & Cryptographic Ed25519 Proof Receipts:
 *    - Captures screenshots on consequential actions, computes SHA-256 evidence hashes,
 *      issues signed Ed25519 ProofReceipts, and verifies receipts offline.
 * 5. Emergency Kill Switch:
 *    - Immediate refusal on global/tenant kill switches, and in-flight session termination.
 * 6. Tool Contract Integration:
 *    - Registered reach_browser_session tool with input validation, verify(), and compensate().
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SQLiteDatabaseClient, db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { TenantContextManager } from '../../src/core/context/tenantContext.js';
import { TenantRepository } from '../../src/storage/repositories/tenantRepository.js';
import { ProofService, verifyReceiptOffline } from '../../src/trust/proof/proofService.js';
import {
  ReachSecurityPolicy,
  ReachKillSwitch,
  ReachBrowserService,
  HermeticMockBrowserDriver,
  ReachSessionRepository,
  reachTools,
  ReachSecurityViolationError,
  ReachKillSwitchActiveError,
  ReachExecutionError,
} from '../../src/index.js';

describe('WP-5.5 Reach Browser Automation Tool Unit Tests', () => {
  let client: SQLiteDatabaseClient;
  let tenantA: string;
  let tenantB: string;
  let killSwitch: ReachKillSwitch;
  let proofService: ProofService;
  let repository: ReachSessionRepository;

  beforeEach(async () => {
    client = new SQLiteDatabaseClient(':memory:');
    db.setClientForTesting(client);
    await new SchemaMigrator(client).applyMigrations();

    const tenants = new TenantRepository(client);
    tenantA = (await tenants.create({ name: 'Tenant Alpha', slug: 'tenant-a', plan_tier: 'enterprise', channel_plan: 'combined' })).id;
    tenantB = (await tenants.create({ name: 'Tenant Beta', slug: 'tenant-b', plan_tier: 'pro', channel_plan: 'combined' })).id;

    killSwitch = ReachKillSwitch.getInstance();
    killSwitch.resetForTesting();

    proofService = new ProofService(client);
    repository = new ReachSessionRepository(client);
  });

  afterEach(async () => {
    killSwitch.resetForTesting();
    await client.close();
  });

  describe('Suite 1: Security Policy & Domain / Protocol / SSRF Enforcement', () => {
    it('allows valid domains and exact/wildcard subdomains', () => {
      const allowed = ['*.apollohospitals.com', 'mohfw.gov.in', 'cowin.gov.in'];

      // Exact match
      expect(ReachSecurityPolicy.validateUrl('https://mohfw.gov.in/portal', allowed).valid).toBe(true);

      // Wildcard subdomains
      expect(ReachSecurityPolicy.validateUrl('https://portal.apollohospitals.com/doctors', allowed).valid).toBe(true);
      expect(ReachSecurityPolicy.validateUrl('https://billing.dept.apollohospitals.com/receipt', allowed).valid).toBe(true);
      expect(ReachSecurityPolicy.validateUrl('https://apollohospitals.com', allowed).valid).toBe(true);
    });

    it('blocks navigation to unlisted domains (Key Acceptance Criterion)', () => {
      const allowed = ['*.apollohospitals.com', 'cowin.gov.in'];

      expect(() => {
        ReachSecurityPolicy.validateUrl('https://malicious-portal.com/login', allowed);
      }).toThrowError(ReachSecurityViolationError);

      expect(() => {
        ReachSecurityPolicy.validateUrl('https://notapollohospitals.com', allowed);
      }).toThrowError(/not permitted by Reach security policy/);
    });

    it('blocks non-HTTP protocols (file, javascript, data, chrome)', () => {
      const allowed = ['*'];

      expect(() => {
        ReachSecurityPolicy.validateUrl('file:///etc/passwd', allowed);
      }).toThrowError(/Disallowed URL protocol/);

      expect(() => {
        ReachSecurityPolicy.validateUrl('javascript:alert(document.cookie)', allowed);
      }).toThrowError(/Disallowed URL protocol/);

      expect(() => {
        ReachSecurityPolicy.validateUrl('data:text/html,<html>Injected</html>', allowed);
      }).toThrowError(/Disallowed URL protocol/);
    });

    it('blocks SSRF to loopback, private RFC1918 ranges, and cloud metadata IP (169.254.169.254)', () => {
      const allowed = ['*'];

      // Cloud metadata service (AWS/GCP/Azure)
      expect(() => {
        ReachSecurityPolicy.validateUrl('http://169.254.169.254/latest/meta-data/', allowed);
      }).toThrowError(/Navigation to private, loopback, or cloud metadata address/);

      // Localhost & loopback
      expect(() => {
        ReachSecurityPolicy.validateUrl('http://127.0.0.1:8080/internal/api', allowed);
      }).toThrowError(/private, loopback/);

      expect(() => {
        ReachSecurityPolicy.validateUrl('http://localhost:3000', allowed);
      }).toThrowError(/private, loopback/);

      // Private RFC 1918 IPv4 ranges
      expect(() => {
        ReachSecurityPolicy.validateUrl('http://10.0.1.50/admin', allowed);
      }).toThrowError(/private, loopback/);

      expect(() => {
        ReachSecurityPolicy.validateUrl('http://172.20.0.1/dashboard', allowed);
      }).toThrowError(/private, loopback/);

      expect(() => {
        ReachSecurityPolicy.validateUrl('http://192.168.1.1/router', allowed);
      }).toThrowError(/private, loopback/);

      // IPv6 Loopback
      expect(() => {
        ReachSecurityPolicy.validateUrl('http://[::1]:5432/', allowed);
      }).toThrowError(/private, loopback/);
    });
  });

  describe('Suite 2: Action Allowlist & Step Bound Governance', () => {
    it('permits whitelisted browser actions and rejects unauthorized actions', () => {
      // Allowed set: navigate, click, fill
      const allowed = ['navigate', 'click', 'fill'] as const;

      expect(() => {
        ReachSecurityPolicy.validateAction({ type: 'click', target: '#submit-btn' }, [...allowed]);
      }).not.toThrow();

      // Attempting unallowed action
      expect(() => {
        ReachSecurityPolicy.validateAction({ type: 'select', target: '#dropdown', value: 'opt1' }, [...allowed]);
      }).toThrowError(/Action 'select' is forbidden by Reach action allowlist/);
    });

    it('rejects sessions requesting more actions than maxActionsPerSession', async () => {
      const service = new ReachBrowserService({
        driver: new HermeticMockBrowserDriver(),
        client,
      });

      const excessiveActions = new Array(30).fill(0).map((_, i) => ({
        type: 'click' as const,
        target: `#btn-${i}`,
      }));

      await expect(
        service.executeSession({
          config: {
            tenantId: tenantA,
            allowedDomains: ['portal.clinic.in'],
            maxActionsPerSession: 10,
          },
          initialUrl: 'https://portal.clinic.in/dashboard',
          actions: excessiveActions,
        })
      ).rejects.toThrowError(/exceeds maximum permitted actions per session/);
    });
  });

  describe('Suite 3: Per-Run Session Isolation & Lifecycle', () => {
    it('proves that consecutive sessions maintain strict isolation without state leakage', async () => {
      const driver = new HermeticMockBrowserDriver();
      const service = new ReachBrowserService({ driver, client });

      // Session 1: fills form data on portal
      const res1 = await service.executeSession({
        config: {
          tenantId: tenantA,
          allowedDomains: ['portal.clinic.in'],
        },
        initialUrl: 'https://portal.clinic.in/appointment',
        actions: [
          { type: 'fill', target: '#patient-name', value: 'Patient One' },
          { type: 'fill', target: '#patient-phone', value: '+919876543210' },
          { type: 'click', target: '#btn-submit' },
        ],
      });

      expect(res1.status).toBe('completed');
      expect(res1.results.length).toBe(4); // 1 initial nav + 3 actions

      // Session 2: separate run inspecting the page
      const res2 = await service.executeSession({
        config: {
          tenantId: tenantA,
          allowedDomains: ['portal.clinic.in'],
        },
        initialUrl: 'https://portal.clinic.in/appointment',
        actions: [
          { type: 'extractText', target: '#patient-name' },
        ],
      });

      expect(res2.status).toBe('completed');
      // Patient One was NOT retained in session 2 (isolation preserved)
      expect(res2.results[1].output).toBe('');
    });

    it('refuses interactions on an already closed driver session', async () => {
      const driver = new HermeticMockBrowserDriver();
      const session = await driver.createSession({
        tenantId: tenantA,
        allowedDomains: ['portal.clinic.in'],
      });

      await session.navigate('https://portal.clinic.in/home');
      await session.close();

      await expect(session.click('#btn')).rejects.toThrowError(
        /Cannot perform actions on a closed Reach browser session/
      );
    });
  });

  describe('Suite 4: Screenshot Evidence & Cryptographic Ed25519 Proof Receipts', () => {
    it('captures screenshot evidence, computes SHA-256 hashes, issues signed Ed25519 ProofReceipts, and verifies offline', async () => {
      const driver = new HermeticMockBrowserDriver();
      const service = new ReachBrowserService({ driver, proofService, repository, client });

      const res = await service.executeSession({
        config: {
          tenantId: tenantA,
          runId: 'run-reach-001',
          agentSlug: 'scheduling_agent',
          allowedDomains: ['hms.hospital.com'],
          recordScreenshots: true,
        },
        initialUrl: 'https://hms.hospital.com/calendar',
        actions: [
          { type: 'fill', target: '#doctor-id', value: 'DOC-1234' },
          { type: 'click', target: '#btn-confirm-slot', captureScreenshotAfter: true },
        ],
      });

      expect(res.status).toBe('completed');
      expect(res.proofReceiptId).toBeDefined();

      // Verify screenshot evidence
      expect(res.screenshotEvidence.length).toBeGreaterThanOrEqual(1);
      const evidence = res.screenshotEvidence[0];
      expect(evidence.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(evidence.screenshotBase64.length).toBeGreaterThan(50);

      // Verify cryptographic receipt issued in database
      const bundle = await TenantContextManager.withTenant(tenantA, 'default', () => proofService.exportBundle());
      expect(bundle.receipts.length).toBe(1);

      const receipt = bundle.receipts[0];
      expect(receipt.body.receiptId).toBe(res.proofReceiptId);
      expect(receipt.body.actionType).toBe('reach.browser_interaction');
      expect(receipt.body.riskTier).toBe('T2');
      expect(receipt.body.verification.method).toBe('screenshot_evidence');
      expect(receipt.body.verification.state).toBe('verified');

      // Offline Ed25519 verification without server or database
      const keyObj = bundle.publicKeys[receipt.keyId];
      const offlineVerification = verifyReceiptOffline(receipt, keyObj);
      expect(offlineVerification.valid).toBe(true);

      // Proves persistence in reach_sessions repository (migration 050)
      const storedSession = await TenantContextManager.withTenant(tenantA, 'default', () =>
        repository.findById(res.sessionId)
      );
      expect(storedSession).not.toBeNull();
      expect(storedSession?.status).toBe('completed');
      expect(storedSession?.proof_receipt_id).toBe(res.proofReceiptId);
      expect(storedSession?.actions_count).toBe(3);
    });

    it('enforces multi-tenant isolation on reach_sessions records', async () => {
      const service = new ReachBrowserService({ client, proofService, repository });

      // Tenant A runs a session
      const resA = await service.executeSession({
        config: { tenantId: tenantA, allowedDomains: ['portal.clinic.in'] },
        initialUrl: 'https://portal.clinic.in/a',
        actions: [{ type: 'click', target: '#a' }],
      });

      // Tenant B runs a session
      const resB = await service.executeSession({
        config: { tenantId: tenantB, allowedDomains: ['portal.clinic.in'] },
        initialUrl: 'https://portal.clinic.in/b',
        actions: [{ type: 'click', target: '#b' }],
      });

      // Tenant A cannot query Tenant B's session
      await TenantContextManager.withTenant(tenantA, 'default', async () => {
        expect(await repository.findById(resA.sessionId)).not.toBeNull();
        expect(await repository.findById(resB.sessionId)).toBeNull();
        const listA = await repository.listByTenant();
        expect(listA.some((s) => s.id === resB.sessionId)).toBe(false);
      });

      // Tenant B cannot query Tenant A's session
      await TenantContextManager.withTenant(tenantB, 'default', async () => {
        expect(await repository.findById(resB.sessionId)).not.toBeNull();
        expect(await repository.findById(resA.sessionId)).toBeNull();
      });
    });
  });

  describe('Suite 5: Emergency Kill Switch', () => {
    it('refuses new sessions immediately when global kill switch is activated', async () => {
      const service = new ReachBrowserService({ client, killSwitch });

      killSwitch.setGlobalKillSwitch(true, 'Rogue crawler behavior suspected');

      await expect(
        service.executeSession({
          config: { tenantId: tenantA, allowedDomains: ['portal.clinic.in'] },
          initialUrl: 'https://portal.clinic.in/dashboard',
          actions: [],
        })
      ).rejects.toThrowError(ReachKillSwitchActiveError);

      expect(killSwitch.isGlobalKillSwitchActive().active).toBe(true);
      expect(killSwitch.isGlobalKillSwitchActive().reason).toContain('Rogue crawler behavior');

      // Deactivation restores service
      killSwitch.setGlobalKillSwitch(false);
      const res = await service.executeSession({
        config: { tenantId: tenantA, allowedDomains: ['portal.clinic.in'] },
        initialUrl: 'https://portal.clinic.in/dashboard',
        actions: [],
      });
      expect(res.status).toBe('completed');
    });

    it('refuses sessions for targeted tenant when tenant kill switch is active while allowing others', async () => {
      const service = new ReachBrowserService({ client, killSwitch });

      killSwitch.setTenantKillSwitch(tenantA, true, 'Tenant A billing violation');

      // Tenant A is blocked
      await expect(
        service.executeSession({
          config: { tenantId: tenantA, allowedDomains: ['portal.clinic.in'] },
          initialUrl: 'https://portal.clinic.in/dashboard',
          actions: [],
        })
      ).rejects.toThrowError(ReachKillSwitchActiveError);

      // Tenant B can execute normally
      const resB = await service.executeSession({
        config: { tenantId: tenantB, allowedDomains: ['portal.clinic.in'] },
        initialUrl: 'https://portal.clinic.in/dashboard',
        actions: [],
      });
      expect(resB.status).toBe('completed');
    });

    it('kills active in-flight session when killSession is triggered', async () => {
      const driver = new HermeticMockBrowserDriver();
      const service = new ReachBrowserService({ driver, client, killSwitch });

      const abortController = new AbortController();
      const testSessionId = 'test-session-abort-123';
      killSwitch.registerSession(testSessionId, tenantA, abortController);

      expect(abortController.signal.aborted).toBe(false);
      const killed = killSwitch.killSession(testSessionId, 'Emergency operator halt');
      expect(killed).toBe(true);
      expect(abortController.signal.aborted).toBe(true);
    });
  });

  describe('Suite 6: Registered Tool Contract (reach_browser_session)', () => {
    it('validates tool schema and executes browser automation through tool contract', async () => {
      const service = new ReachBrowserService({ client, proofService, repository });
      const tools = reachTools({ reachService: service, client });
      const tool = tools.find((t) => t.definition.slug === 'reach_browser_session')!;

      expect(tool).toBeDefined();
      expect(tool.definition.riskTier).toBe('MEDIUM');
      expect(tool.definition.category).toBe('custom');

      // Valid execution via tool contract
      await TenantContextManager.withTenant(tenantA, 'default', async () => {
        const input = {
          url: 'https://portal.clinic.in/slots',
          actions: [
            { type: 'click' as const, target: '#book-slot' },
          ],
          allowedDomains: ['portal.clinic.in'],
        };

        const validatedInput = tool.inputValidator.parse(input);
        const output = await tool.handler(validatedInput, {
          tenantId: tenantA,
          agentSlug: 'scheduling',
        } as any);

        expect(output.sessionId).toBeDefined();
        expect(output.status).toBe('completed');
        expect(output.proofReceiptId).toBeDefined();
        expect(output.actionsCount).toBe(2);

        // Tool verify() read-back
        const verification = await tool.verify!(validatedInput, output, {} as any);
        expect(verification.state).toBe('verified');
        expect((verification.observed as any)?.proofReceiptId).toBe(output.proofReceiptId);

        // Tool compensate()
        await expect(tool.compensate!(validatedInput, output, {} as any)).resolves.not.toThrow();
      });
    });

    it('returns mismatch verification if output status is not completed or missing receipt', async () => {
      const tools = reachTools({ client });
      const tool = tools.find((t) => t.definition.slug === 'reach_browser_session')!;

      const failedOutput = {
        sessionId: 'sess-fail',
        status: 'failed',
        proofReceiptId: null,
      };

      const verification = await tool.verify!({} as any, failedOutput as any, {} as any);
      expect(verification.state).toBe('mismatch');
    });
  });
});
