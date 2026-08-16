export interface ApiErrorBody {
  code: string;
  message: string;
  statusCode: number;
  correlationId?: string;
  details?: Record<string, unknown>;
}

export class ApiError extends Error {
  code: string;
  statusCode: number;
  correlationId?: string;
  details?: Record<string, unknown>;

  constructor(body: ApiErrorBody) {
    super(body.message);
    this.code = body.code;
    this.statusCode = body.statusCode;
    this.correlationId = body.correlationId;
    this.details = body.details;
  }
}

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

function getToken(): string | null {
  return sessionStorage.getItem('xylarc_access_token');
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(`${BASE_URL}${path}`, { ...init, headers });

  if (!response.ok) {
    let body: { error: ApiErrorBody };
    try {
      body = await response.json();
    } catch {
      throw new ApiError({
        code: 'UNKNOWN_ERROR',
        message: `Request failed with status ${response.status}`,
        statusCode: response.status,
      });
    }
    const err = new ApiError(body.error);
    if (err.statusCode === 401) {
      sessionStorage.removeItem('xylarc_access_token');
      onUnauthorized?.();
    }
    throw err;
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}
