/**
 * Kriya Omnitask — Canonical JSON (sorted keys at every depth) + SHA-256.
 *
 * Use this for every hash that must be stable across key order: audit ledgers, idempotency payload
 * hashes, graph state hashes and Proof receipts. Do NOT use `JSON.stringify(obj, Object.keys(obj).sort())`:
 * an array replacer is a whitelist applied at EVERY depth, so nested fields are silently dropped
 * from the hash and tampering with them goes undetected (docs/kriya S32).
 */

import { createHash } from 'node:crypto';

export function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sha256Canonical(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}
