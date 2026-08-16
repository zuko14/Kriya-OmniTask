/**
 * Xylarc AI — Webhook Signature Verifier
 * Cryptographic verification for Meta WhatsApp and partner webhooks with replay defense.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { UnauthorizedError } from '../../core/errors/errors.js';
import { CryptoUtils } from '../../core/utils/crypto.js';

export class WebhookVerifier {
  /**
   * Verifies Meta X-Hub-Signature-256 header against the app secret and raw payload body.
   */
  public static verifyMetaSignature(rawBody: string, signatureHeader?: string, appSecret?: string): boolean {
    if (!signatureHeader || !appSecret) {
      return false;
    }

    const parts = signatureHeader.split('=');
    if (parts.length !== 2 || parts[0] !== 'sha256') {
      return false;
    }

    const incomingHash = parts[1];
    const expectedHash = createHmac('sha256', appSecret).update(rawBody).digest('hex');

    const incomingBuffer = Buffer.from(incomingHash, 'hex');
    const expectedBuffer = Buffer.from(expectedHash, 'hex');

    if (incomingBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return timingSafeEqual(incomingBuffer, expectedBuffer);
  }

  /**
   * Computes SHA-256 hash of webhook payload for duplicate detection.
   */
  public static computePayloadHash(rawBody: string): string {
    return CryptoUtils.hashSha256(rawBody);
  }
}
