import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteDatabaseClient, db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { TenantRepository } from '../../src/storage/repositories/tenantRepository.js';
import { OrganizationRepository, WorkspaceRepository } from '../../src/storage/repositories/orgRepository.js';
import { UserRepository } from '../../src/storage/repositories/userRepository.js';
import { TenantContextManager } from '../../src/core/context/tenantContext.js';

describe('Repository Integration', () => {
  let client: SQLiteDatabaseClient;
  let tenantRepo: TenantRepository;
  let orgRepo: OrganizationRepository;
  let workspaceRepo: WorkspaceRepository;
  let userRepo: UserRepository;

  beforeEach(async () => {
    client = new SQLiteDatabaseClient(':memory:');
    db.setClientForTesting(client);
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    tenantRepo = new TenantRepository(client);
    orgRepo = new OrganizationRepository(client);
    workspaceRepo = new WorkspaceRepository(client);
    userRepo = new UserRepository(client);
  });

  afterEach(async () => {
    await client.close();
  });

  it('should create and configure tenants', async () => {
    const tenant = await tenantRepo.create({
      name: 'Acme Enterprise',
      slug: 'acme-corp',
      plan_tier: 'enterprise',
      channel_plan: 'combined',
    });

    expect(tenant.id).toBeDefined();
    expect(tenant.slug).toBe('acme-corp');

    await tenantRepo.setConfiguration(tenant.id, {
      maxAgents: 25,
      allowedChannels: ['whatsapp', 'voice', 'email'],
    });

    const config = await tenantRepo.getConfiguration<{ maxAgents: number; allowedChannels: string[] }>(tenant.id);
    expect(config.maxAgents).toBe(25);
    expect(config.allowedChannels).toContain('voice');
  });

  it('should manage organizations and workspaces with tenant boundaries', async () => {
    const tenant = await tenantRepo.create({ name: 'Beta Ltd', slug: 'beta-ltd' });

    await TenantContextManager.withTenant(tenant.id, 'org-placeholder', async () => {
      const org = await orgRepo.create({
        name: 'Beta Global Ops',
        slug: 'beta-global',
      });

      expect(org.id).toBeDefined();
      expect(org.tenant_id).toBe(tenant.id);

      const workspace = await workspaceRepo.create({
        organization_id: org.id,
        name: 'Sales Dept',
        slug: 'sales-dept',
      });

      expect(workspace.id).toBeDefined();
      expect(workspace.tenant_id).toBe(tenant.id);

      const orgWorkspaces = await workspaceRepo.findByOrg(org.id);
      expect(orgWorkspaces.length).toBe(1);
      expect(orgWorkspaces[0].name).toBe('Sales Dept');
    });
  });

  it('should create users and verify password authentication', async () => {
    const tenant = await tenantRepo.create({ name: 'Gamma Corp', slug: 'gamma-corp' });

    await TenantContextManager.withTenant(tenant.id, 'org-placeholder', async () => {
      const user = await userRepo.createWithPassword({
        email: 'admin@gamma.com',
        password: 'SuperSecretAdmin123!',
        full_name: 'Gamma Administrator',
      });

      expect(user.id).toBeDefined();
      expect(user.email).toBe('admin@gamma.com');

      const found = await userRepo.findByEmail('admin@gamma.com');
      expect(found).not.toBeNull();
      expect(found?.full_name).toBe('Gamma Administrator');
    });
  });
});
