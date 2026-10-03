/**
 * Kriya AI — Webhook Signature Verifier Unit Tests
 */

import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { WebhookVerifier } from '../../src/channels/security/webhookVerifier.js';

describe('Webhook Verifier Unit Tests', () => {
  const appSecret = 'super_secret_whatsapp_app_key_123';
  const rawBody = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ id: '123456', changes: [] }],
  });

  it('should verify valid Meta X-Hub-Signature-256 header', () => {
    const hash = createHmac('sha256', appSecret).update(rawBody).digest('hex');
    const signatureHeader = `sha256=${hash}`;

    const isValid = WebhookVerifier.verifyMetaSignature(rawBody, signatureHeader, appSecret);
    expect(isValid).toBe(true);
  });

  it('should reject tampered or modified payloads', () => {
    const hash = createHmac('sha256', appSecret).update(rawBody).digest('hex');
    const signatureHeader = `sha256=${hash}`;

    const tamperedBody = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{ id: '999999', changes: [] }],
    });

    const isValid = WebhookVerifier.verifyMetaSignature(tamperedBody, signatureHeader, appSecret);
    expect(isValid).toBe(false);
  });

  it('should reject incorrect app secret or missing signature', () => {
    const hash = createHmac('sha256', appSecret).update(rawBody).digest('hex');
    const signatureHeader = `sha256=${hash}`;

    expect(WebhookVerifier.verifyMetaSignature(rawBody, signatureHeader, 'wrong_secret')).toBe(false);
    expect(WebhookVerifier.verifyMetaSignature(rawBody, undefined, appSecret)).toBe(false);
    expect(WebhookVerifier.verifyMetaSignature(rawBody, 'invalid_format', appSecret)).toBe(false);
  });

  it('should compute consistent SHA-256 payload hash for deduplication', () => {
    const hash1 = WebhookVerifier.computePayloadHash(rawBody);
    const hash2 = WebhookVerifier.computePayloadHash(rawBody);
    expect(hash1).toBe(hash2);
    expect(hash1.length).toBe(64);
  });
});
