import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteDatabaseClient, db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { OrganizationRepository, WorkspaceRepository } from '../../src/storage/repositories/orgRepository.js';
import { UserRepository } from '../../src/storage/repositories/userRepository.js';
import { TenantRepository } from '../../src/storage/repositories/tenantRepository.js';
import { TenantContextManager } from '../../src/core/context/tenantContext.js';
import { NotFoundError, TenantIsolationError } from '../../src/core/errors/errors.js';

describe('Adversarial Tenant Isolation & Boundary Security', () => {
  let client: SQLiteDatabaseClient;
  let tenantRepo: TenantRepository;
  let orgRepo: OrganizationRepository;
  let workspaceRepo: WorkspaceRepository;
  let userRepo: UserRepository;

  let tenantAId: string;
  let tenantBId: string;
  let orgAId: string;
  let userAId: string;

  beforeEach(async () => {
    client = new SQLiteDatabaseClient(':memory:');
    db.setClientForTesting(client);
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    tenantRepo = new TenantRepository(client);
    orgRepo = new OrganizationRepository(client);
    workspaceRepo = new WorkspaceRepository(client);
    userRepo = new UserRepository(client);

    const tA = await tenantRepo.create({ name: 'Tenant Alpha', slug: 'alpha-corp' });
    const tB = await tenantRepo.create({ name: 'Tenant Beta', slug: 'beta-corp' });
    tenantAId = tA.id;
    tenantBId = tB.id;

    // Create resources in Tenant A
    await TenantContextManager.withTenant(tenantAId, 'org-a', async () => {
      const org = await orgRepo.create({ name: 'Alpha Org', slug: 'alpha-org' });
      orgAId = org.id;

      const user = await userRepo.createWithPassword({
        email: 'ceo@alpha.com',
        password: 'AlphaPassword123!',
        full_name: 'Alpha CEO',
      });
      userAId = user.id;
    });
  });

  afterEach(async () => {
    await client.close();
  });

  it('should prevent Tenant B from reading Tenant A organization by ID', async () => {
    await TenantContextManager.withTenant(tenantBId, 'org-b', async () => {
      const leakedOrg = await orgRepo.findById(orgAId);
      expect(leakedOrg).toBeNull();

      await expect(() => orgRepo.getById(orgAId)).rejects.toThrow(NotFoundError);
    });
  });

  it('should prevent Tenant B from listing Tenant A users', async () => {
    await TenantContextManager.withTenant(tenantBId, 'org-b', async () => {
      const users = await userRepo.findAll();
      expect(users.length).toBe(0);

      const foundUser = await userRepo.findByEmail('ceo@alpha.com');
      expect(foundUser).toBeNull();
    });
  });

  it('should prevent Tenant B from updating Tenant A resources', async () => {
    await TenantContextManager.withTenant(tenantBId, 'org-b', async () => {
      await expect(() => orgRepo.update(orgAId, { name: 'Hacked Alpha' })).rejects.toThrow(NotFoundError);
    });

    // Verify original data in Tenant A is intact
    await TenantContextManager.withTenant(tenantAId, 'org-a', async () => {
      const org = await orgRepo.getById(orgAId);
      expect(org.name).toBe('Alpha Org');
    });
  });

  it('should prevent Tenant B from deleting Tenant A resources', async () => {
    await TenantContextManager.withTenant(tenantBId, 'org-b', async () => {
      const deleted = await orgRepo.delete(orgAId);
      expect(deleted).toBe(false);
    });

    // Verify entity still exists in Tenant A
    await TenantContextManager.withTenant(tenantAId, 'org-a', async () => {
      const org = await orgRepo.findById(orgAId);
      expect(org).not.toBeNull();
    });
  });

  it('should fail fast if repository is invoked without any tenant context', async () => {
    await expect(() => orgRepo.findAll()).rejects.toThrow(TenantIsolationError);
  });
});
