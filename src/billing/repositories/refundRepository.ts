/**
 * Kriya Omnitask — Payment Refund Repository (docs/kriya WP-4.7)
 * Persists and audits financial refunds with tenant isolation and idempotency.
 */

import { DatabaseClient, db } from '../../storage/db.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import { CryptoUtils } from '../../core/utils/crypto.js';
import { NotFoundError } from '../../core/errors/errors.js';

export interface PaymentRefundRecord {
  id: string;
  tenant_id: string;
  customer_ref: string;
  appointment_id: string | null;
  amount: number;
  currency: string;
  reason: string;
  status: 'processed' | 'voided' | 'failed';
  mandate_id: string | null;
  human_approver_id: string | null;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
}

export interface CreateRefundInput {
  customerRef: string;
  appointmentId?: string;
  amount: number;
  currency?: string;
  reason: string;
  mandateId?: string;
  humanApproverId?: string;
  idempotencyKey: string;
}

export class RefundRepository {
  constructor(private readonly customClient?: DatabaseClient) {}

  private get client(): DatabaseClient {
    return this.customClient ?? db.getClient();
  }

  private tenant(): string {
    return TenantContextManager.getTenantId();
  }

  public async createRefund(input: CreateRefundInput): Promise<PaymentRefundRecord> {
    const tenantId = this.tenant();
    const existing = await this.client.queryOne<PaymentRefundRecord>(
      'SELECT * FROM payment_refunds WHERE tenant_id = ? AND idempotency_key = ?',
      [tenantId, input.idempotencyKey]
    );
    if (existing) return existing;

    const id = `rfnd_${CryptoUtils.generateId()}`;
    const now = new Date().toISOString();
    await this.client.execute(
      `INSERT INTO payment_refunds (id, tenant_id, customer_ref, appointment_id, amount, currency, reason, status, mandate_id, human_approver_id, idempotency_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'processed', ?, ?, ?, ?, ?)`,
      [
        id,
        tenantId,
        input.customerRef,
        input.appointmentId ?? null,
        input.amount,
        input.currency?.toUpperCase() ?? 'INR',
        input.reason,
        input.mandateId ?? null,
        input.humanApproverId ?? null,
        input.idempotencyKey,
        now,
        now,
      ]
    );
    return (await this.getRefund(id))!;
  }

  public async getRefund(id: string): Promise<PaymentRefundRecord | null> {
    return this.client.queryOne<PaymentRefundRecord>(
      'SELECT * FROM payment_refunds WHERE id = ? AND tenant_id = ?',
      [id, this.tenant()]
    );
  }

  public async getByAppointmentId(appointmentId: string): Promise<PaymentRefundRecord[]> {
    return this.client.query<PaymentRefundRecord>(
      'SELECT * FROM payment_refunds WHERE tenant_id = ? AND appointment_id = ? ORDER BY created_at DESC',
      [this.tenant(), appointmentId]
    );
  }

  public async listForCustomer(customerRef: string): Promise<PaymentRefundRecord[]> {
    return this.client.query<PaymentRefundRecord>(
      'SELECT * FROM payment_refunds WHERE tenant_id = ? AND customer_ref = ? ORDER BY created_at DESC',
      [this.tenant(), customerRef]
    );
  }

  public async voidRefund(id: string, reason?: string): Promise<PaymentRefundRecord> {
    return this.client.transaction(async (tx) => {
      const existing = await tx.queryOne<PaymentRefundRecord>(
        'SELECT * FROM payment_refunds WHERE id = ? AND tenant_id = ? FOR UPDATE',
        [id, this.tenant()]
      );
      if (!existing) throw new NotFoundError(`Refund '${id}' not found.`);
      if (existing.status === 'voided') return existing;
      const now = new Date().toISOString();
      await tx.execute(
        "UPDATE payment_refunds SET status = 'voided', reason = reason || ' (voided: ' || ? || ')', updated_at = ? WHERE id = ? AND tenant_id = ?",
        [reason ?? 'compensation', now, id, this.tenant()]
      );
      return (await this.getRefund(id))!;
    });
  }
}
