/**
 * Kriya Omnitask — Kriya Proof: signed, hash-chained receipts (docs/kriya WP-3.3, 02 §7)
 *
 * Every consequential action gets a receipt BEFORE anyone is told "done":
 *   body  = canonical JSON of {receiptId, tenantId, sequence, run/node, action, tier, actor, mandate,
 *           policy, inputHash, outputHash, target, verification, prevHash, issuedAt}
 *   hash  = SHA-256(canonical body)            → chained per tenant via prevHash
 *   sig   = Ed25519(hash) with the platform signing key (key id recorded)
 * Anyone holding the receipt and the public key can verify it offline (`verifyReceiptOffline`).
 * Raw inputs/outputs are NOT stored — only their hashes (zero-retention friendly).
 */

import { generateKeyPairSync, createPrivateKey, createPublicKey, sign, verify, KeyObject } from 'node:crypto';
import { DatabaseClient, db } from '../../storage/db.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import { CryptoUtils } from '../../core/utils/crypto.js';
import { canonicalJson, sha256Canonical } from '../../core/utils/canonicalJson.js';
import { config } from '../../core/config/config.js';
import { isSandboxMode, NotConfiguredError } from '../../core/config/runtimeMode.js';

export const GENESIS_HASH = '0'.repeat(64);

export interface ReceiptInput {
  runId?: string;
  nodeId?: string;
  actionType: string;
  riskTier: string;
  actor: { agentSlug?: string; agentVersion?: string; modelId?: string; humanApproverId?: string };
  mandate?: { id?: string; version?: number; decision: string };
  policy?: { decision: string; ruleIds?: string[] };
  input?: unknown;
  output?: unknown;
  target: { system: string; externalRef?: string };
  verification: { method: string; state: string; observed?: unknown; verifiedAt?: string };
}

export interface ReceiptBody {
  receiptId: string;
  tenantId: string;
  sequence: number;
  runId: string | null;
  nodeId: string | null;
  actionType: string;
  riskTier: string;
  actor: ReceiptInput['actor'];
  mandate: ReceiptInput['mandate'] | null;
  policy: ReceiptInput['policy'] | null;
  inputHash: string | null;
  outputHash: string | null;
  target: ReceiptInput['target'];
  verification: ReceiptInput['verification'];
  prevHash: string;
  issuedAt: string;
}

export interface SignedReceipt {
  body: ReceiptBody;
  hash: string;
  keyId: string;
  signature: string; // base64
}

interface ProofReceiptRow {
  id: string;
  tenant_id: string;
  sequence: number;
  body_json: string;
  prev_hash: string;
  hash: string;
  key_id: string;
  signature: string;
}

interface SigningKey {
  keyId: string;
  privateKey: KeyObject;
  publicKeyPem: string;
}

let ephemeralKey: SigningKey | null = null;

/** Loads the platform signing key. Production/staging require PROOF_SIGNING_PRIVATE_KEY; sandbox uses an ephemeral key. */
export function loadSigningKey(): SigningKey {
  const configured = config.get('PROOF_SIGNING_PRIVATE_KEY');
  if (configured) {
    const pem = configured.trim().startsWith('-----BEGIN') ? configured : Buffer.from(configured, 'base64').toString('utf8');
    const privateKey = createPrivateKey(pem);
    const publicKeyPem = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString();
    return { keyId: keyIdFor(publicKeyPem), privateKey, publicKeyPem };
  }
  if (!isSandboxMode()) {
    throw new NotConfiguredError('Proof signing key', 'set PROOF_SIGNING_PRIVATE_KEY (Ed25519 PKCS#8 PEM, raw or base64).');
  }
  if (!ephemeralKey) {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    ephemeralKey = { keyId: keyIdFor(publicKeyPem), privateKey, publicKeyPem };
  }
  return ephemeralKey;
}

function keyIdFor(publicKeyPem: string): string {
  return `ed25519:${CryptoUtils.hashSha256(publicKeyPem).slice(0, 16)}`;
}

/** Offline verification: needs only the receipt and the signer's public key. */
export function verifyReceiptOffline(receipt: SignedReceipt, publicKeyPem: string): { valid: boolean; reason?: string } {
  const recomputed = sha256Canonical(receipt.body);
  if (recomputed !== receipt.hash) return { valid: false, reason: 'hash does not match body (receipt altered)' };
  const ok = verify(null, Buffer.from(receipt.hash, 'hex'), createPublicKey(publicKeyPem), Buffer.from(receipt.signature, 'base64'));
  return ok ? { valid: true } : { valid: false, reason: 'signature invalid' };
}

export class ProofService {
  constructor(private readonly customClient?: DatabaseClient) {}

  private get client(): DatabaseClient {
    return this.customClient ?? db.getClient();
  }

  public async issue(input: ReceiptInput): Promise<SignedReceipt> {
    const tenantId = TenantContextManager.getTenantId();
    const key = loadSigningKey();
    await this.client.execute(
      `INSERT OR IGNORE INTO proof_signing_keys (key_id, algorithm, public_key_pem, status, created_at) VALUES (?, 'ed25519', ?, 'active', ?)`,
      [key.keyId, key.publicKeyPem, new Date().toISOString()]
    );

    return this.client.transaction(async (tx) => {
      const last = await tx.queryOne<{ sequence: number; hash: string }>(
        'SELECT sequence, hash FROM proof_receipts WHERE tenant_id = ? ORDER BY sequence DESC LIMIT 1',
        [tenantId]
      );
      const body: ReceiptBody = {
        receiptId: `rcpt_${CryptoUtils.generateId()}`,
        tenantId,
        sequence: (last?.sequence ?? 0) + 1,
        runId: input.runId ?? null,
        nodeId: input.nodeId ?? null,
        actionType: input.actionType,
        riskTier: input.riskTier,
        actor: input.actor,
        mandate: input.mandate ?? null,
        policy: input.policy ?? null,
        inputHash: input.input === undefined ? null : sha256Canonical(input.input),
        outputHash: input.output === undefined ? null : sha256Canonical(input.output),
        target: input.target,
        verification: input.verification,
        prevHash: last?.hash ?? GENESIS_HASH,
        issuedAt: new Date().toISOString(),
      };
      // Normalise through canonical JSON so the stored body is exactly what was hashed.
      const normalised = JSON.parse(canonicalJson(body)) as ReceiptBody;
      const hash = sha256Canonical(normalised);
      const signature = sign(null, Buffer.from(hash, 'hex'), key.privateKey).toString('base64');

      await tx.execute(
        `INSERT INTO proof_receipts (id, tenant_id, sequence, run_id, node_id, action_type, risk_tier, body_json, prev_hash, hash, key_id, signature, issued_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [normalised.receiptId, tenantId, normalised.sequence, normalised.runId, normalised.nodeId, normalised.actionType, normalised.riskTier,
          canonicalJson(normalised), normalised.prevHash, hash, key.keyId, signature, normalised.issuedAt]
      );
      return { body: normalised, hash, keyId: key.keyId, signature };
    });
  }

  public async get(receiptId: string): Promise<SignedReceipt | null> {
    const row = await this.client.queryOne<ProofReceiptRow>('SELECT * FROM proof_receipts WHERE id = ? AND tenant_id = ?', [receiptId, TenantContextManager.getTenantId()]);
    return row ? toSigned(row) : null;
  }

  public async publicKey(keyId: string): Promise<string | null> {
    const row = await this.client.queryOne<{ public_key_pem: string }>('SELECT public_key_pem FROM proof_signing_keys WHERE key_id = ?', [keyId]);
    return row?.public_key_pem ?? null;
  }

  /** Verifies one receipt's hash and signature, and its link to the previous receipt. */
  public async verify(receiptId: string): Promise<{ valid: boolean; reason?: string }> {
    const receipt = await this.get(receiptId);
    if (!receipt) return { valid: false, reason: 'receipt not found' };
    const pem = await this.publicKey(receipt.keyId);
    if (!pem) return { valid: false, reason: `unknown signing key ${receipt.keyId}` };
    const own = verifyReceiptOffline(receipt, pem);
    if (!own.valid) return own;
    if (receipt.body.sequence > 1) {
      const prev = await this.client.queryOne<{ hash: string }>('SELECT hash FROM proof_receipts WHERE tenant_id = ? AND sequence = ?', [receipt.body.tenantId, receipt.body.sequence - 1]);
      if (!prev || prev.hash !== receipt.body.prevHash) return { valid: false, reason: 'chain broken: previous receipt missing or altered' };
    } else if (receipt.body.prevHash !== GENESIS_HASH) {
      return { valid: false, reason: 'first receipt does not start from genesis' };
    }
    return { valid: true };
  }

  /** Walks the whole tenant chain: every hash, signature, link and sequence number. */
  public async verifyChain(): Promise<{ valid: boolean; checked: number; brokenAt?: number; reason?: string }> {
    const rows = await this.client.query<ProofReceiptRow>('SELECT * FROM proof_receipts WHERE tenant_id = ? ORDER BY sequence ASC', [TenantContextManager.getTenantId()]);
    let prevHash = GENESIS_HASH;
    const keys = new Map<string, string | null>();
    for (let i = 0; i < rows.length; i++) {
      const r = toSigned(rows[i]);
      if (r.body.sequence !== i + 1) return { valid: false, checked: i, brokenAt: i + 1, reason: 'sequence gap (receipt deleted or reordered)' };
      if (r.body.prevHash !== prevHash) return { valid: false, checked: i, brokenAt: r.body.sequence, reason: 'chain link broken' };
      if (!keys.has(r.keyId)) keys.set(r.keyId, await this.publicKey(r.keyId));
      const pem = keys.get(r.keyId);
      const check = pem ? verifyReceiptOffline(r, pem) : { valid: false, reason: 'unknown key' };
      if (!check.valid) return { valid: false, checked: i, brokenAt: r.body.sequence, reason: check.reason };
      prevHash = r.hash;
    }
    return { valid: true, checked: rows.length };
  }

  /** Auditor bundle: every receipt plus the public keys needed to verify them offline. */
  public async exportBundle(): Promise<{ tenantId: string; receipts: SignedReceipt[]; publicKeys: Record<string, string> }> {
    const tenantId = TenantContextManager.getTenantId();
    const rows = await this.client.query<ProofReceiptRow>('SELECT * FROM proof_receipts WHERE tenant_id = ? ORDER BY sequence ASC', [tenantId]);
    const receipts = rows.map(toSigned);
    const publicKeys: Record<string, string> = {};
    for (const keyId of new Set(receipts.map((r) => r.keyId))) {
      const pem = await this.publicKey(keyId);
      if (pem) publicKeys[keyId] = pem;
    }
    return { tenantId, receipts, publicKeys };
  }

  /** Paginated list of signed receipts for the active tenant. */
  public async listReceipts(options?: {
    limit?: number;
    offset?: number;
    runId?: string;
  }): Promise<{ receipts: SignedReceipt[]; total: number; limit: number; offset: number; count: number }> {
    const tenantId = TenantContextManager.getTenantId();
    const limit = Math.max(1, Math.min(options?.limit ?? 50, 200));
    const offset = Math.max(0, options?.offset ?? 0);
    const runId = options?.runId;

    let whereClause = 'WHERE tenant_id = ?';
    const params: unknown[] = [tenantId];
    if (runId) {
      whereClause += ' AND run_id = ?';
      params.push(runId);
    }

    const countRow = await this.client.queryOne<{ cnt: number | string }>(
      `SELECT COUNT(*) as cnt FROM proof_receipts ${whereClause}`,
      params
    );
    const total = countRow ? Number(countRow.cnt) : 0;

    const rows = await this.client.query<ProofReceiptRow>(
      `SELECT * FROM proof_receipts ${whereClause} ORDER BY sequence DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const receipts = rows.map(toSigned);
    return {
      receipts,
      total,
      limit,
      offset,
      count: receipts.length,
    };
  }
}

function toSigned(row: ProofReceiptRow): SignedReceipt {
  return { body: JSON.parse(row.body_json) as ReceiptBody, hash: row.hash, keyId: row.key_id, signature: row.signature };
}
