import { Navigate } from 'react-router';
import type { ReactNode } from 'react';
import { useAuth } from '../lib/authContext';

/**
 * Mirrors which roles hold `system:admin` in src/security/rbac/rbac.ts (owner, super_admin,
 * admin, system). This is navigation convenience only, not authorization — every /platform/*
 * page still hits the real API and renders a live 403 if the backend disagrees.
 */
const PLATFORM_ROLES = ['owner', 'super_admin', 'admin', 'system'];

export function RouteGuard({ children, requirePlatformRole = false }: { children: ReactNode; requirePlatformRole?: boolean }) {
  const { auth, status } = useAuth();

  if (status === 'checking') {
    return <div style={{ padding: 'var(--space-5)', color: 'var(--color-ink-muted)' }}>Loading session…</div>;
  }

  if (status === 'unauthenticated' || !auth) {
    return <Navigate to="/login" replace />;
  }

  if (requirePlatformRole && !auth.user.roles.some((r) => PLATFORM_ROLES.includes(r))) {
    return (
      <div style={{ padding: 'var(--space-5)', color: 'var(--color-caution)' }}>
        Access denied — you don't have permission to view this.
      </div>
    );
  }

  return <>{children}</>;
}
