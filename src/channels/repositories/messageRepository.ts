/**
 * Xylarc AI — Outbound Message Repository
 * Manages outbound message queue state, idempotency keys, and delivery receipts.
 */

import { BaseRepository, BaseEntity } from '../../storage/repositories/baseRepository.js';
import { DatabaseClient } from '../../storage/db.js';

export type OutboundStatus =
  | 'queued'
  | 'sending'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed'
  | 'throttled_quiet_hours'
  | 'throttled_frequency_limit';

export interface OutboundMessageRecord extends BaseEntity {
  customer_id?: string;
  channel: 'whatsapp' | 'voice' | 'email' | 'sms';
  idempotency_key: string;
  recipient: string;
  message_type: 'text' | 'template' | 'interactive_button' | 'interactive_list' | 'media' | 'voice_call';
  payload_json: string;
  status: OutboundStatus;
  external_message_id?: string;
  error_message?: string;
  retry_count: number;
  scheduled_at?: string;
  sent_at?: string;
}

export class MessageRepository extends BaseRepository<OutboundMessageRecord> {
  protected readonly tableName = 'outbound_messages';

  constructor(client?: DatabaseClient) {
    super(client);
  }

  public async findByIdempotencyKey(key: string): Promise<OutboundMessageRecord | null> {
    const tenantId = this.getTenantId();
    return this.client.queryOne<OutboundMessageRecord>(
      'SELECT * FROM outbound_messages WHERE idempotency_key = ? AND tenant_id = ?;',
      [key, tenantId]
    );
  }

  public async countRecentOutboundForCustomer(customerId: string, sinceIsoTime: string): Promise<number> {
    const tenantId = this.getTenantId();
    const res = await this.client.queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM outbound_messages 
       WHERE customer_id = ? AND tenant_id = ? AND created_at >= ? AND status NOT IN ('failed', 'throttled_quiet_hours', 'throttled_frequency_limit');`,
      [customerId, tenantId, sinceIsoTime]
    );
    return res ? Number(res.count) : 0;
  }

  public async updateDeliveryStatus(
    externalMessageId: string,
    status: OutboundStatus,
    timestamp = new Date().toISOString()
  ): Promise<void> {
    const tenantId = this.getTenantId();
    const sets: string[] = ['status = ?', 'updated_at = ?'];
    const params: unknown[] = [status, timestamp];

    if (status === 'sent') {
      sets.push('sent_at = ?');
      params.push(timestamp);
    }

    params.push(externalMessageId, tenantId);
    await this.client.execute(
      `UPDATE outbound_messages SET ${sets.join(', ')} WHERE external_message_id = ? AND tenant_id = ?;`,
      params
    );
  }
}
