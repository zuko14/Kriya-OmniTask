import { Navigate, useLocation } from 'react-router';
import type { ReactNode } from 'react';
import { useAuth } from '../lib/authContext';

/**
 * Navigation convenience only, not authorization — every page still hits the real API, which
 * enforces tenant scope and `system:admin` server-side.
 *  - plane="admin": client admin portal. Signed-out → /admin login; platform operators → /owner.
 *  - plane="owner": platform owner console. Anyone who isn't a platform operator → /owner login.
 */
export function RouteGuard({ children, plane }: { children: ReactNode; plane: 'admin' | 'owner' }) {
  const { auth, status } = useAuth();
  const location = useLocation();

  if (status === 'checking') {
    return <div style={{ padding: 'var(--space-5)', color: 'var(--text2)' }}>Loading session…</div>;
  }

  if (status === 'unauthenticated' || !auth) {
    return <Navigate to={`/${plane}`} replace state={{ from: location.pathname }} />;
  }

  if (plane === 'owner' && !auth.isPlatformOperator) {
    return <Navigate to="/owner" replace />;
  }
  if (plane === 'admin' && auth.isPlatformOperator) {
    return <Navigate to="/owner/overview" replace />;
  }

  return <>{children}</>;
}
