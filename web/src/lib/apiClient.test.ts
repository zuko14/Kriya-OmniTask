import { describe, it, expect, vi, beforeEach } from 'vitest';
import { apiFetch, ApiError, setUnauthorizedHandler } from './apiClient';

describe('apiFetch', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('throws a typed ApiError and clears the session on 401', async () => {
    sessionStorage.setItem('kriya_access_token', 'stale-token');
    const unauthorizedHandler = vi.fn();
    setUnauthorizedHandler(unauthorizedHandler);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({
          error: { code: 'UNAUTHORIZED', message: 'Token expired', statusCode: 401 },
        }),
      })
    );

    await expect(apiFetch('/api/v1/auth/me')).rejects.toBeInstanceOf(ApiError);
    expect(sessionStorage.getItem('kriya_access_token')).toBeNull();
    expect(unauthorizedHandler).toHaveBeenCalledOnce();
  });

  it('does not clear the session on 403', async () => {
    sessionStorage.setItem('kriya_access_token', 'valid-token');
    const unauthorizedHandler = vi.fn();
    setUnauthorizedHandler(unauthorizedHandler);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({
          error: { code: 'FORBIDDEN', message: 'Insufficient permissions', statusCode: 403 },
        }),
      })
    );

    await expect(apiFetch('/api/v1/bi/briefings')).rejects.toMatchObject({ statusCode: 403 });
    expect(sessionStorage.getItem('kriya_access_token')).toBe('valid-token');
    expect(unauthorizedHandler).not.toHaveBeenCalled();
  });
});
