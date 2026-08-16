/**
 * Xylarc AI — JWT Authentication Engine
 * Cryptographically signed JWT tokens (HMAC-SHA256) with strict claims validation.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../../core/config/config.js';
import { UnauthorizedError } from '../../core/errors/errors.js';

export interface JwtPayload {
  userId: string;
  tenantId: string;
  organizationId?: string;
  roles: string[];
  email: string;
  iat?: number;
  exp?: number;
}

export class JwtService {
  private static base64UrlEncode(str: string): string {
    return Buffer.from(str)
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  }

  private static base64UrlDecode(str: string): string {
    let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) {
      base64 += '=';
    }
    return Buffer.from(base64, 'base64').toString('utf8');
  }

  /**
   * Signs a JWT token with the configured JWT_SECRET.
   */
  public static sign(payload: Omit<JwtPayload, 'iat' | 'exp'>, expiresInSeconds = 3600): string {
    const header = { alg: 'HS256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const fullPayload: JwtPayload = {
      ...payload,
      iat: now,
      exp: now + expiresInSeconds,
    };

    const encodedHeader = this.base64UrlEncode(JSON.stringify(header));
    const encodedPayload = this.base64UrlEncode(JSON.stringify(fullPayload));
    const dataToSign = `${encodedHeader}.${encodedPayload}`;

    const secret = config.get('JWT_SECRET');
    const signature = createHmac('sha256', secret).update(dataToSign).digest('base64url');

    return `${dataToSign}.${signature}`;
  }

  /**
   * Alias for sign
   */
  public static signToken(payload: Omit<JwtPayload, 'iat' | 'exp'>, expiresInSeconds = 3600): string {
    return this.sign(payload, expiresInSeconds);
  }

  /**
   * Verifies and decodes a JWT token. Throws UnauthorizedError if invalid or expired.
   */
  public static verify(token: string): JwtPayload {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new UnauthorizedError('Malformed JWT token structure');
    }

    const [encodedHeader, encodedPayload, signature] = parts;
    const dataToSign = `${encodedHeader}.${encodedPayload}`;
    const secret = config.get('JWT_SECRET');

    const expectedSignature = createHmac('sha256', secret).update(dataToSign).digest('base64url');

    const sigBuffer = Buffer.from(signature);
    const expBuffer = Buffer.from(expectedSignature);

    if (sigBuffer.length !== expBuffer.length || !timingSafeEqual(sigBuffer, expBuffer)) {
      throw new UnauthorizedError('Invalid JWT token signature');
    }

    try {
      const payload: JwtPayload = JSON.parse(this.base64UrlDecode(encodedPayload));
      const now = Math.floor(Date.now() / 1000);

      if (payload.exp && payload.exp < now) {
        throw new UnauthorizedError('JWT token has expired');
      }

      return payload;
    } catch (err) {
      if (err instanceof UnauthorizedError) throw err;
      throw new UnauthorizedError('Failed to parse JWT token payload');
    }
  }
}
