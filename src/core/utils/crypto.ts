/**
 * Xylarc AI — Cryptography & Security Utilities
 * Zero-trust encryption, secure hashing, deterministic token generation,
 * and AES-256-GCM authenticated encryption for sensitive data.
 */

import { randomBytes, createCipheriv, createDecipheriv, pbkdf2Sync, createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { config } from '../config/config.js';

export interface EncryptedPayload {
  iv: string;
  tag: string;
  data: string;
}

export class CryptoUtils {
  private static readonly ALGORITHM = 'aes-256-gcm';
  private static readonly IV_LENGTH = 12; // Standard 96 bits for GCM
  private static readonly PBKDF2_ITERATIONS = 100_000;
  private static readonly KEY_LENGTH = 32; // 256 bits

  /**
   * Generates a cryptographically strong UUID v4 string.
   */
  public static generateId(): string {
    const bytes = randomBytes(16);
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // Version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // Variant 10xx
    const hex = bytes.toString('hex');
    return `${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20, 32)}`;
  }

  public static generateCorrelationId(): string {
    return this.generateId();
  }

  /**
   * Generates a random secure hexadecimal token.
   */
  public static generateSecureToken(byteLength = 32): string {
    return randomBytes(byteLength).toString('hex');
  }

  /**
   * Computes SHA-256 hash of a string.
   */
  public static hashSha256(data: string): string {
    return createHash('sha256').update(data).digest('hex');
  }

  /**
   * Hashes a password using PBKDF2 with HMAC-SHA512.
   * Returns "salt:hash" formatted string.
   */
  public static hashPassword(password: string, customSalt?: string): string {
    const salt = customSalt || randomBytes(16).toString('hex');
    const hash = pbkdf2Sync(
      password,
      salt,
      this.PBKDF2_ITERATIONS,
      64,
      'sha512'
    ).toString('hex');
    return `${salt}:${hash}`;
  }

  /**
   * Verifies a password against a stored "salt:hash" string using constant-time comparison.
   */
  public static verifyPassword(password: string, storedHash: string): boolean {
    const parts = storedHash.split(':');
    if (parts.length !== 2) return false;
    const [salt, expectedHash] = parts;
    const computedHash = pbkdf2Sync(
      password,
      salt,
      this.PBKDF2_ITERATIONS,
      64,
      'sha512'
    ).toString('hex');

    const expectedBuffer = Buffer.from(expectedHash, 'hex');
    const computedBuffer = Buffer.from(computedHash, 'hex');

    if (expectedBuffer.length !== computedBuffer.length) {
      return false;
    }

    return timingSafeEqual(expectedBuffer, computedBuffer);
  }

  /**
   * Encrypts plaintext using AES-256-GCM.
   */
  public static encrypt(plainText: string, secretKey?: string): EncryptedPayload {
    const keyStr = secretKey || config.get('ENCRYPTION_KEY');
    const key = this.deriveKey(keyStr);
    const iv = randomBytes(this.IV_LENGTH);
    const cipher = createCipheriv(this.ALGORITHM, key, iv);

    let encrypted = cipher.update(plainText, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag().toString('hex');

    return {
      iv: iv.toString('hex'),
      tag,
      data: encrypted,
    };
  }

  /**
   * Decrypts an AES-256-GCM encrypted payload with authentication verification.
   */
  public static decrypt(payload: EncryptedPayload | string, secretKey?: string): string {
    const parsedPayload: EncryptedPayload = typeof payload === 'string' ? JSON.parse(payload) : payload;
    const keyStr = secretKey || config.get('ENCRYPTION_KEY');
    const key = this.deriveKey(keyStr);
    const iv = Buffer.from(parsedPayload.iv, 'hex');
    const tag = Buffer.from(parsedPayload.tag, 'hex');
    const decipher = createDecipheriv(this.ALGORITHM, key, iv);

    decipher.setAuthTag(tag);
    let decrypted = decipher.update(parsedPayload.data, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  /**
   * Creates an HMAC-SHA256 signature for payload verification (webhooks, audit chains).
   */
  public static createHmacSignature(data: string, secretKey: string): string {
    return createHmac('sha256', secretKey).update(data).digest('hex');
  }

  /**
   * Verifies an HMAC-SHA256 signature in constant time.
   */
  public static verifyHmacSignature(data: string, signature: string, secretKey: string): boolean {
    const expected = this.createHmacSignature(data, secretKey);
    const sigBuffer = Buffer.from(signature, 'hex');
    const expBuffer = Buffer.from(expected, 'hex');

    if (sigBuffer.length !== expBuffer.length) {
      return false;
    }

    return timingSafeEqual(sigBuffer, expBuffer);
  }

  private static deriveKey(secret: string): Buffer {
    return pbkdf2Sync(secret, 'xylarc_salt_domain_v1', 10_000, this.KEY_LENGTH, 'sha256');
  }
}
