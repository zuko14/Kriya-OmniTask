/**
 * Kriya Omnitask — Payment Hold Repository (docs/kriya WP-4.4)
 * Persists and audits financial authorizations / holds under tenant isolation.
 */

import { DatabaseClient, db } from '../../storage/db.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import { CryptoUtils } from '../../core/utils/crypto.js';
import { NotFoundError, ConflictError } from '../../core/errors/errors.js';

export interface PaymentHoldRecord {
  id: string;
  tenant_id: string;
  customer_ref: string;
  amount: number;
  currency: string;
  purpose: string;
  appointment_id: string | null;
  status: 'held' | 'captured' | 'released' | 'expired';
  expires_at: string;
  captured_at: string | null;
  released_at: string | null;
  released_reason: string | null;
  mandate_id: string | null;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
}

export interface CreatePaymentHoldInput {
  customerRef: string;
  amount: number;
  currency?: string;
  purpose: string;
  appointmentId?: string;
  mandateId?: string;
  holdMinutes?: number;
  idempotencyKey: string;
}

export class PaymentHoldRepository {
  constructor(private readonly customClient?: DatabaseClient) {}

  private get client(): DatabaseClient {
    return this.customClient ?? db.getClient();
  }

  private tenant(): string {
    return TenantContextManager.getTenantId();
  }

  public async createHold(input: CreatePaymentHoldInput): Promise<PaymentHoldRecord> {
    const tenantId = this.tenant();
    const existing = await this.client.queryOne<PaymentHoldRecord>(
      'SELECT * FROM payment_holds WHERE tenant_id = ? AND idempotency_key = ?',
      [tenantId, input.idempotencyKey]
    );
    if (existing) return existing;

    const id = `phold_${CryptoUtils.generateId()}`;
    const now = new Date();
    const nowIso = now.toISOString();
    const holdDurationMinutes = input.holdMinutes ?? 30;
    const expiresAt = new Date(now.getTime() + holdDurationMinutes * 60 * 1000).toISOString();
    const currency = input.currency?.toUpperCase() ?? 'INR';

    await this.client.execute(
      `INSERT INTO payment_holds (
        id, tenant_id, customer_ref, amount, currency, purpose, appointment_id,
        status, expires_at, captured_at, released_at, released_reason, mandate_id,
        idempotency_key, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'held', ?, NULL, NULL, NULL, ?, ?, ?, ?)`,
      [
        id,
        tenantId,
        input.customerRef,
        input.amount,
        currency,
        input.purpose,
        input.appointmentId ?? null,
        expiresAt,
        input.mandateId ?? null,
        input.idempotencyKey,
        nowIso,
        nowIso,
      ]
    );

    return (await this.getHold(id))!;
  }

  public async getHold(id: string): Promise<PaymentHoldRecord | null> {
    return this.client.queryOne<PaymentHoldRecord>(
      'SELECT * FROM payment_holds WHERE id = ? AND tenant_id = ?',
      [id, this.tenant()]
    );
  }

  public async listForCustomer(customerRef: string): Promise<PaymentHoldRecord[]> {
    return this.client.query<PaymentHoldRecord>(
      'SELECT * FROM payment_holds WHERE tenant_id = ? AND customer_ref = ? ORDER BY created_at DESC',
      [this.tenant(), customerRef]
    );
  }

  public async captureHold(id: string): Promise<PaymentHoldRecord> {
    return this.client.transaction(async (tx) => {
      const existing = await tx.queryOne<PaymentHoldRecord>(
        'SELECT * FROM payment_holds WHERE id = ? AND tenant_id = ? FOR UPDATE',
        [id, this.tenant()]
      );
      if (!existing) throw new NotFoundError(`Payment hold '${id}' not found.`);
      if (existing.status === 'captured') return existing;
      if (existing.status === 'released' || existing.status === 'expired') {
        throw new ConflictError(`Cannot capture payment hold '${id}' in status '${existing.status}'.`);
      }

      const now = new Date().toISOString();
      await tx.execute(
        "UPDATE payment_holds SET status = 'captured', captured_at = ?, updated_at = ? WHERE id = ? AND tenant_id = ?",
        [now, now, id, this.tenant()]
      );

      return (await this.getHold(id))!;
    });
  }

  public async releaseHold(id: string, reason?: string): Promise<PaymentHoldRecord> {
    return this.client.transaction(async (tx) => {
      const existing = await tx.queryOne<PaymentHoldRecord>(
        'SELECT * FROM payment_holds WHERE id = ? AND tenant_id = ? FOR UPDATE',
        [id, this.tenant()]
      );
      if (!existing) throw new NotFoundError(`Payment hold '${id}' not found.`);
      if (existing.status === 'released') return existing;
      if (existing.status === 'captured') {
        throw new ConflictError(`Cannot release payment hold '${id}' because it has already been captured.`);
      }

      const now = new Date().toISOString();
      await tx.execute(
        "UPDATE payment_holds SET status = 'released', released_at = ?, released_reason = ?, updated_at = ? WHERE id = ? AND tenant_id = ?",
        [now, reason ?? 'released by agent or saga', now, id, this.tenant()]
      );

      return (await this.getHold(id))!;
    });
  }
}
