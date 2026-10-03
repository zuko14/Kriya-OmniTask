/**
 * Kriya Omnitask — Payment Link Repository (docs/kriya WP-4.4)
 * Persists and audits payment collection links under tenant isolation with idempotency.
 */

import { DatabaseClient, db } from '../../storage/db.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import { CryptoUtils } from '../../core/utils/crypto.js';
import { NotFoundError, ConflictError } from '../../core/errors/errors.js';

export interface PaymentLinkRecord {
  id: string;
  tenant_id: string;
  customer_ref: string;
  customer_name: string | null;
  amount: number;
  currency: string;
  description: string;
  appointment_id: string | null;
  hold_id: string | null;
  status: 'created' | 'paid' | 'expired' | 'cancelled';
  payment_url: string;
  mandate_id: string | null;
  expires_at: string;
  paid_at: string | null;
  cancelled_at: string | null;
  cancelled_reason: string | null;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
}

export interface CreatePaymentLinkInput {
  customerRef: string;
  customerName?: string;
  amount: number;
  currency?: string;
  description: string;
  appointmentId?: string;
  holdId?: string;
  mandateId?: string;
  expiresInMinutes?: number;
  idempotencyKey: string;
}

export class PaymentLinkRepository {
  constructor(private readonly customClient?: DatabaseClient) {}

  private get client(): DatabaseClient {
    return this.customClient ?? db.getClient();
  }

  private tenant(): string {
    return TenantContextManager.getTenantId();
  }

  public async createLink(input: CreatePaymentLinkInput): Promise<PaymentLinkRecord> {
    const tenantId = this.tenant();
    const existing = await this.client.queryOne<PaymentLinkRecord>(
      'SELECT * FROM payment_links WHERE tenant_id = ? AND idempotency_key = ?',
      [tenantId, input.idempotencyKey]
    );
    if (existing) return existing;

    const id = `plink_${CryptoUtils.generateId()}`;
    const now = new Date();
    const nowIso = now.toISOString();
    const expiryMinutes = input.expiresInMinutes ?? 60;
    const expiresAt = new Date(now.getTime() + expiryMinutes * 60 * 1000).toISOString();
    const currency = input.currency?.toUpperCase() ?? 'INR';
    const paymentUrl = `https://pay.kriya.ai/l/${id}`;

    await this.client.execute(
      `INSERT INTO payment_links (
        id, tenant_id, customer_ref, customer_name, amount, currency, description,
        appointment_id, hold_id, status, payment_url, mandate_id, expires_at,
        paid_at, cancelled_at, cancelled_reason, idempotency_key, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'created', ?, ?, ?, NULL, NULL, NULL, ?, ?, ?)`,
      [
        id,
        tenantId,
        input.customerRef,
        input.customerName ?? null,
        input.amount,
        currency,
        input.description,
        input.appointmentId ?? null,
        input.holdId ?? null,
        paymentUrl,
        input.mandateId ?? null,
        expiresAt,
        input.idempotencyKey,
        nowIso,
        nowIso,
      ]
    );

    return (await this.getLink(id))!;
  }

  public async getLink(id: string): Promise<PaymentLinkRecord | null> {
    return this.client.queryOne<PaymentLinkRecord>(
      'SELECT * FROM payment_links WHERE id = ? AND tenant_id = ?',
      [id, this.tenant()]
    );
  }

  public async listForCustomer(customerRef: string): Promise<PaymentLinkRecord[]> {
    return this.client.query<PaymentLinkRecord>(
      'SELECT * FROM payment_links WHERE tenant_id = ? AND customer_ref = ? ORDER BY created_at DESC',
      [this.tenant(), customerRef]
    );
  }

  public async getByAppointmentId(appointmentId: string): Promise<PaymentLinkRecord[]> {
    return this.client.query<PaymentLinkRecord>(
      'SELECT * FROM payment_links WHERE tenant_id = ? AND appointment_id = ? ORDER BY created_at DESC',
      [this.tenant(), appointmentId]
    );
  }

  public async markPaid(id: string, paidAt?: string): Promise<PaymentLinkRecord> {
    return this.client.transaction(async (tx) => {
      const existing = await tx.queryOne<PaymentLinkRecord>(
        'SELECT * FROM payment_links WHERE id = ? AND tenant_id = ? FOR UPDATE',
        [id, this.tenant()]
      );
      if (!existing) throw new NotFoundError(`Payment link '${id}' not found.`);
      if (existing.status === 'paid') return existing;
      if (existing.status === 'cancelled' || existing.status === 'expired') {
        throw new ConflictError(`Cannot pay payment link '${id}' in status '${existing.status}'.`);
      }

      const now = paidAt ?? new Date().toISOString();
      await tx.execute(
        "UPDATE payment_links SET status = 'paid', paid_at = ?, updated_at = ? WHERE id = ? AND tenant_id = ?",
        [now, now, id, this.tenant()]
      );

      return (await this.getLink(id))!;
    });
  }

  public async cancelLink(id: string, reason?: string): Promise<PaymentLinkRecord> {
    return this.client.transaction(async (tx) => {
      const existing = await tx.queryOne<PaymentLinkRecord>(
        'SELECT * FROM payment_links WHERE id = ? AND tenant_id = ? FOR UPDATE',
        [id, this.tenant()]
      );
      if (!existing) throw new NotFoundError(`Payment link '${id}' not found.`);
      if (existing.status === 'cancelled') return existing;
      if (existing.status === 'paid') {
        throw new ConflictError(`Cannot cancel payment link '${id}' because it has already been paid.`);
      }

      const now = new Date().toISOString();
      await tx.execute(
        "UPDATE payment_links SET status = 'cancelled', cancelled_at = ?, cancelled_reason = ?, updated_at = ? WHERE id = ? AND tenant_id = ?",
        [now, reason ?? 'cancelled by agent or saga', now, id, this.tenant()]
      );

      return (await this.getLink(id))!;
    });
  }
}
