import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server.js';
import { SQLiteDatabaseClient, db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { ensurePlatformOwner, scopeRolesToTenant } from '../../src/security/auth/platformOperator.js';

/**
 * /owner (platform operator) vs /admin (client admin) separation:
 * a client — even a self-registered "owner" — must never reach the platform control plane.
 */
describe('Platform operator isolation (/owner vs /admin)', () => {
  let app: FastifyInstance;
  let client: SQLiteDatabaseClient;
  const OWNER = { email: 'founder@kriya.test', password: 'Owner-Pass-2026!' };

  beforeEach(async () => {
    client = new SQLiteDatabaseClient(':memory:');
    db.setClientForTesting(client);
    await new SchemaMigrator(client).applyMigrations();
    process.env.PLATFORM_OWNER_EMAIL = OWNER.email;
    process.env.PLATFORM_OWNER_PASSWORD = OWNER.password;
    expect(await ensurePlatformOwner()).toBe('created');
    app = await buildServer();
    await app.ready();
  });

  afterEach(async () => {
    delete process.env.PLATFORM_OWNER_EMAIL;
    delete process.env.PLATFORM_OWNER_PASSWORD;
    await app.close();
    await client.close();
  });

  const ownerToken = async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/platform-login', payload: OWNER });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.isPlatformOperator).toBe(true);
    return body.accessToken as string;
  };

  it('bootstrap is idempotent and resets the password when the env value changes', async () => {
    expect(await ensurePlatformOwner()).toBe('unchanged');
    process.env.PLATFORM_OWNER_PASSWORD = 'Rotated-Pass-2026!';
    expect(await ensurePlatformOwner()).toBe('password_reset');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/platform-login',
      payload: { email: OWNER.email, password: 'Rotated-Pass-2026!' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('self-heals an owner left without its role by an earlier crashed boot (prod incident)', async () => {
    await client.execute('DELETE FROM user_roles WHERE tenant_id = ?;', ['tnt_platform']);
    const before = await app.inject({ method: 'POST', url: '/api/v1/auth/platform-login', payload: OWNER });
    expect(before.statusCode).toBe(401); // signs in to the platform tenant but has no platform role

    expect(await ensurePlatformOwner()).toBe('unchanged');
    await ownerToken(); // role restored → owner console works again
  });

  it('rejects wrong owner credentials with a generic 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/platform-login',
      payload: { email: OWNER.email, password: 'wrong-password' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('a self-registered tenant owner cannot use owner-console APIs or the owner login', async () => {
    const reg = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        tenantName: 'Rogue Co',
        tenantSlug: 'rogue',
        organizationName: 'Rogue HQ',
        email: 'boss@rogue.test',
        password: 'RoguePassword123!',
        fullName: 'Rogue Boss',
      },
    });
    expect(reg.statusCode).toBe(201);
    const token = JSON.parse(reg.body).accessToken;

    for (const url of ['/api/v1/admin/organizations/roster', '/api/v1/admin/tenants']) {
      const res = await app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
      expect(res.statusCode).toBe(403);
    }
    const viaOwnerLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/platform-login',
      payload: { email: 'boss@rogue.test', password: 'RoguePassword123!' },
    });
    expect(viaOwnerLogin.statusCode).toBe(401);
  });

  it('owner provisions a client with a generated password; client admin signs in at /admin but not /owner', async () => {
    const token = await ownerToken();
    const prov = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/tenants/provision',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Sunrise Clinic', slug: 'sunrise-clinic', adminEmail: 'Admin@Sunrise.test', dnaProfileId: 'dna_general_service' },
    });
    expect(prov.statusCode).toBe(201);
    const provisioned = JSON.parse(prov.body);
    expect(provisioned.generatedAdminPassword).toMatch(/^[0-9a-f]{24}$/);
    expect(provisioned.adminEmail).toBe('admin@sunrise.test');

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { tenantSlug: 'sunrise-clinic', email: 'admin@sunrise.test', password: provisioned.generatedAdminPassword },
    });
    expect(login.statusCode).toBe(200);
    const clientSession = JSON.parse(login.body);
    expect(clientSession.isPlatformOperator).toBe(false);

    const denied = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/organizations/roster',
      headers: { authorization: `Bearer ${clientSession.accessToken}` },
    });
    expect(denied.statusCode).toBe(403);

    // The owner sees the client's sign-in, attributed to the client user.
    const activity = JSON.parse(
      (
        await app.inject({
          method: 'GET',
          url: `/api/v1/admin/tenants/${provisioned.id}/activity`,
          headers: { authorization: `Bearer ${token}` },
        })
      ).body
    );
    expect(activity.users[0].lastLoginAt).toBeTruthy();
    expect(activity.auditTrail.find((e: any) => e.action === 'user.login').userId).toBe(activity.users[0].id);

    // Duplicate slug and the platform slug are both refused.
    for (const slug of ['sunrise-clinic', 'kriya-platform']) {
      const dup = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/tenants/provision',
        headers: { authorization: `Bearer ${token}` },
        payload: { name: 'Dup', slug, adminEmail: 'x@dup.test' },
      });
      expect(dup.statusCode).toBe(409);
    }
  });

  it('roster hides the platform tenant and reports measured (not fabricated) activity', async () => {
    const token = await ownerToken();
    await app.inject({
      method: 'POST',
      url: '/api/v1/admin/tenants/provision',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Quiet Co', slug: 'quiet-co', adminEmail: 'a@quiet.test', adminPassword: 'Quiet-Password-1' },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/organizations/roster',
      headers: { authorization: `Bearer ${token}` },
    });
    const { organizations } = JSON.parse(res.body);
    expect(organizations.map((o: any) => o.slug)).toEqual(['quiet-co']);
    const quiet = organizations[0];
    expect(quiet.executions24h).toBe(0);
    expect(quiet.errorRatePct).toBeNull();
    expect(quiet.spendInr).toBe(0);
    expect(quiet.userCount).toBe(1);
  });

  it('activity drill-down never exposes password hashes; delete (disable) blocks client login', async () => {
    const token = await ownerToken();
    const prov = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/admin/tenants/provision',
          headers: { authorization: `Bearer ${token}` },
          payload: { name: 'Gone Co', slug: 'gone-co', adminEmail: 'a@gone.test', adminPassword: 'Gone-Password-12' },
        })
      ).body
    );

    const act = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/tenants/${prov.id}/activity`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(act.statusCode).toBe(200);
    expect(act.body).not.toContain('password_hash');
    const activity = JSON.parse(act.body);
    expect(activity.users[0].email).toBe('a@gone.test');
    expect(activity.users[0].roles).toContain('admin');
    expect(activity.auditTrail.some((e: any) => e.action === 'tenant.provisioned')).toBe(true);

    const del = await app.inject({
      method: 'PUT',
      url: `/api/v1/admin/tenants/${prov.id}/status`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: 'disabled', reason: 'Client offboarded' },
    });
    expect(del.statusCode).toBe(200);

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { tenantSlug: 'gone-co', email: 'a@gone.test', password: 'Gone-Password-12' },
    });
    expect(login.statusCode).toBe(401);

    const missing = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/tenants/tnt_nope/activity',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(missing.statusCode).toBe(404);
  });

  it('platform roles are stripped outside the platform tenant', () => {
    expect(scopeRolesToTenant(['super_admin', 'admin'], 'acme')).toEqual(['admin']);
    expect(scopeRolesToTenant(['super_admin'], 'kriya-platform')).toEqual(['super_admin']);
  });
});
