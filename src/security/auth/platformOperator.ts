/**
 * Kriya Omnitask — Platform Operator Identity (§7)
 * Platform operators (the /owner console) live in one dedicated platform tenant. Platform roles
 * (super_admin, system) are honoured only for principals of that tenant, so no client tenant can
 * mint a platform operator through self-registration, invites, or role rows it creates itself.
 */

import { TenantRepository } from '../../storage/repositories/tenantRepository.js';
import { UserRepository } from '../../storage/repositories/userRepository.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import { CryptoUtils } from '../../core/utils/crypto.js';
import { auditLogger } from '../audit/auditLogger.js';
import { db } from '../../storage/db.js';
import { logger } from '../../core/logger/logger.js';

export const PLATFORM_ROLES = ['super_admin', 'system'];

export function platformTenantSlug(): string {
  return process.env.PLATFORM_TENANT_SLUG || 'kriya-platform';
}

export function isPlatformTenantSlug(slug: string | undefined | null): boolean {
  return !!slug && slug === platformTenantSlug();
}

/** Drops platform roles from any principal that is not in the platform tenant. */
export function scopeRolesToTenant(roles: string[], tenantSlug: string): string[] {
  return isPlatformTenantSlug(tenantSlug) ? roles : roles.filter((r) => !PLATFORM_ROLES.includes(r));
}

/**
 * Idempotently provisions the platform tenant and the first owner from
 * PLATFORM_OWNER_EMAIL / PLATFORM_OWNER_PASSWORD. Re-running with a different password resets it,
 * which is the break-glass recovery path (change the env var on Render, redeploy).
 */
export async function ensurePlatformOwner(): Promise<'created' | 'password_reset' | 'unchanged' | 'skipped'> {
  const email = process.env.PLATFORM_OWNER_EMAIL?.toLowerCase().trim();
  const password = process.env.PLATFORM_OWNER_PASSWORD;
  if (!email || !password) {
    logger.warn('PLATFORM_OWNER_EMAIL / PLATFORM_OWNER_PASSWORD not set — /owner console has no bootstrap login.');
    return 'skipped';
  }
  if (password.length < 12) {
    logger.error('PLATFORM_OWNER_PASSWORD must be at least 12 characters — platform owner not provisioned.');
    return 'skipped';
  }

  const tenantRepo = new TenantRepository();
  const slug = platformTenantSlug();
  const tenant =
    (await tenantRepo.findBySlug(slug)) ??
    (await tenantRepo.create({ id: `tnt_platform`, name: 'Kriya Platform', slug, plan_tier: 'enterprise' }));

  return TenantContextManager.withTenant(tenant.id, 'platform', async () => {
    const users = new UserRepository();
    const existing = await users.findByEmail(email);
    let outcome: 'created' | 'password_reset' | 'unchanged';

    if (!existing) {
      const user = await users.createWithPassword({ email, password, full_name: 'Platform Owner' });
      await users.assignRoleByName(user.id, 'super_admin');
      outcome = 'created';
    } else if (!CryptoUtils.verifyPassword(password, existing.password_hash)) {
      await db.getClient().execute('UPDATE users SET password_hash = ?, status = ?, updated_at = ? WHERE id = ?;', [
        CryptoUtils.hashPassword(password),
        'active',
        new Date().toISOString(),
        existing.id,
      ]);
      outcome = 'password_reset';
    } else {
      outcome = 'unchanged';
    }

    if (outcome !== 'unchanged') {
      await auditLogger.logEvent({
        action: `platform.owner_${outcome}`,
        resourceType: 'user',
        resourceId: email,
        details: { source: 'env_bootstrap' },
      });
    }
    logger.info(`Platform owner bootstrap: ${outcome} (${email})`);
    return outcome;
  }, { userId: 'system', roles: ['system'] });
}
