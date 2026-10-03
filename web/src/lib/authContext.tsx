import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { apiFetch, ApiError, setUnauthorizedHandler } from './apiClient';

interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  roles: string[];
}

interface AuthTenant {
  id: string;
  name: string;
  slug: string;
  planTier: string;
  channelPlan: string;
}

interface AuthState {
  user: AuthUser;
  tenant: AuthTenant;
  /** True only for the platform tenant (/owner console). Set by the server, never inferred from roles. */
  isPlatformOperator: boolean;
}

interface LoginResponse {
  accessToken: string;
  user: AuthUser;
  tenant: AuthTenant;
  isPlatformOperator?: boolean;
}

interface MeResponse {
  user: AuthUser;
  tenant: AuthTenant;
  isPlatformOperator?: boolean;
}

interface AuthContextValue {
  auth: AuthState | null;
  status: 'checking' | 'authenticated' | 'unauthenticated';
  login: (tenantSlug: string, email: string, password: string) => Promise<void>;
  loginOwner: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const TOKEN_KEY = 'kriya_access_token';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [status, setStatus] = useState<'checking' | 'authenticated' | 'unauthenticated'>('checking');

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setAuth(null);
      setStatus('unauthenticated');
    });

    const token = sessionStorage.getItem(TOKEN_KEY);
    if (!token) {
      setStatus('unauthenticated');
      return;
    }

    apiFetch<MeResponse>('/api/v1/auth/me')
      .then((me) => {
        setAuth({ user: me.user, tenant: me.tenant, isPlatformOperator: me.isPlatformOperator === true });
        setStatus('authenticated');
      })
      .catch(() => {
        setStatus('unauthenticated');
      });
  }, []);

  async function signIn(path: string, body: Record<string, string>): Promise<void> {
    const result = await apiFetch<LoginResponse>(path, { method: 'POST', body: JSON.stringify(body) });
    sessionStorage.setItem(TOKEN_KEY, result.accessToken);
    setAuth({ user: result.user, tenant: result.tenant, isPlatformOperator: result.isPlatformOperator === true });
    setStatus('authenticated');
  }

  const login = (tenantSlug: string, email: string, password: string) =>
    signIn('/api/v1/auth/login', { tenantSlug, email, password });
  const loginOwner = (email: string, password: string) => signIn('/api/v1/auth/platform-login', { email, password });

  function logout(): void {
    sessionStorage.removeItem(TOKEN_KEY);
    setAuth(null);
    setStatus('unauthenticated');
  }

  return <AuthContext.Provider value={{ auth, status, login, loginOwner, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}

export { ApiError };
