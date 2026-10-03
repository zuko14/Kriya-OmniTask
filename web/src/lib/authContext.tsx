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
}

interface LoginResponse {
  accessToken: string;
  user: AuthUser;
  tenant: AuthTenant;
}

interface MeResponse {
  user: AuthUser;
  tenant: AuthTenant;
}

interface AuthContextValue {
  auth: AuthState | null;
  status: 'checking' | 'authenticated' | 'unauthenticated';
  login: (tenantSlug: string, email: string, password: string) => Promise<void>;
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
        setAuth({ user: me.user, tenant: me.tenant });
        setStatus('authenticated');
      })
      .catch(() => {
        setStatus('unauthenticated');
      });
  }, []);

  async function login(tenantSlug: string, email: string, password: string): Promise<void> {
    const result = await apiFetch<LoginResponse>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ tenantSlug, email, password }),
    });
    sessionStorage.setItem(TOKEN_KEY, result.accessToken);
    setAuth({ user: result.user, tenant: result.tenant });
    setStatus('authenticated');
  }

  function logout(): void {
    sessionStorage.removeItem(TOKEN_KEY);
    setAuth(null);
    setStatus('unauthenticated');
  }

  return <AuthContext.Provider value={{ auth, status, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}

export { ApiError };
