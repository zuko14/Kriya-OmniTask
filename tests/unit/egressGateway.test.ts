import { describe, it, expect, beforeEach } from 'vitest';
import { EgressGateway } from '../../src/retrieval/external/gateway/egressGateway.js';
import { ExternalRetrievalRepository } from '../../src/retrieval/external/repositories/externalRetrievalRepository.js';
import { db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { ForbiddenError } from '../../src/core/errors/errors.js';

describe('Egress Gateway Unit Tests (§10.3, §10.4, Criteria 2 & 7)', () => {
  let repo: ExternalRetrievalRepository;
  let gateway: EgressGateway;
  const TEST_TENANT = 'tenant_egress_test';

  beforeEach(async () => {
    const client = db.getClient();
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();
    repo = new ExternalRetrievalRepository(client);
    gateway = new EgressGateway(repo);
  });

  it('should block external retrieval by default if agent has no explicit search grant (§10.4)', async () => {
    // Ungranted agent (search grants are off by default)
    await expect(
      gateway.validateEgress(TEST_TENANT, 'unregistered_agent', 'https://example.com/docs')
    ).rejects.toThrow(ForbiddenError);
  });

  it('should strictly forbid search grants for sensitive agents (payment, billing, identity, contract)', async () => {
    await expect(
      gateway.validateEgress(TEST_TENANT, 'payment_processing_agent', 'https://example.com/docs')
    ).rejects.toThrow(/restricted category/);

    await expect(
      gateway.validateEgress(TEST_TENANT, 'identity_verifier_agent', 'https://example.com/docs')
    ).rejects.toThrow(/restricted category/);
  });

  it('should permit egress when search grant is explicitly enabled for an agent', async () => {
    await repo.saveSearchGrant({
      id: 'grant_research_1',
      tenantId: TEST_TENANT,
      agentSlug: 'market_researcher',
      enabled: true,
      allowedDomains: ['example.com', 'wikipedia.org'],
      maxDailyQueries: 50,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const result = await gateway.validateEgress(
      TEST_TENANT,
      'market_researcher',
      'https://example.com/industry-report'
    );

    expect(result.allowed).toBe(true);
    expect(result.domain).toBe('example.com');
    expect(result.isAllowlisted).toBe(true);
  });

  it('should block platform denylisted SSRF targets (localhost, 169.254.169.254, internal networks)', async () => {
    await repo.saveSearchGrant({
      id: 'grant_research_2',
      tenantId: TEST_TENANT,
      agentSlug: 'market_researcher',
      enabled: true,
      allowedDomains: [],
      maxDailyQueries: 50,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const localhostResult = await gateway.validateEgress(
      TEST_TENANT,
      'market_researcher',
      'http://127.0.0.1:8080/admin'
    );
    expect(localhostResult.allowed).toBe(false);
    expect(localhostResult.isDenylisted).toBe(true);

    const metadataResult = await gateway.validateEgress(
      TEST_TENANT,
      'market_researcher',
      'http://169.254.169.254/latest/meta-data/'
    );
    expect(metadataResult.allowed).toBe(false);
    expect(metadataResult.isDenylisted).toBe(true);
  });

  it('should auto-denylist a domain that records >= 3 prompt injection attempts', async () => {
    const badDomain = 'malicious-seo-blog.biz';

    // Record 3 prompt injection strikes
    await repo.recordInjectionStrike(badDomain, 'Strike 1');
    await repo.recordInjectionStrike(badDomain, 'Strike 2');
    const strike3 = await repo.recordInjectionStrike(badDomain, 'Strike 3');

    expect(strike3.isAutoDenylisted).toBe(true);

    await repo.saveSearchGrant({
      id: 'grant_research_3',
      tenantId: TEST_TENANT,
      agentSlug: 'market_researcher',
      enabled: true,
      allowedDomains: [],
      maxDailyQueries: 50,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const result = await gateway.validateEgress(
      TEST_TENANT,
      'market_researcher',
      `https://${badDomain}/article`
    );

    expect(result.allowed).toBe(false);
    expect(result.isDenylisted).toBe(true);
    expect(result.blockedReason).toContain('auto-denylisted');
  });
});
