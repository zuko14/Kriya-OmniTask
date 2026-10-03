/**
 * Kriya AI — Inbound Webhook Ledger Repository
 * Prevents replay attacks and retains raw payload traceability.
 */

import { BaseRepository, BaseEntity } from '../../storage/repositories/baseRepository.js';
import { DatabaseClient } from '../../storage/db.js';
import { CryptoUtils } from '../../core/utils/crypto.js';

export interface InboundWebhookRecord extends BaseEntity {
  channel: string;
  payload_hash: string;
  raw_payload_json: string;
  processed_status: 'received' | 'processed' | 'failed' | 'ignored';
}

export class WebhookRepository extends BaseRepository<InboundWebhookRecord> {
  protected readonly tableName = 'inbound_webhooks';

  constructor(client?: DatabaseClient) {
    super(client);
  }

  public async recordInbound(params: {
    channel: string;
    payloadHash: string;
    rawPayload: unknown;
  }): Promise<{ isDuplicate: boolean; record: InboundWebhookRecord }> {
    const tenantId = this.getTenantId();
    const existing = await this.client.queryOne<InboundWebhookRecord>(
      'SELECT * FROM inbound_webhooks WHERE payload_hash = ? AND tenant_id = ?;',
      [params.payloadHash, tenantId]
    );

    if (existing) {
      return { isDuplicate: true, record: existing };
    }

    const id = CryptoUtils.generateId();
    const now = new Date().toISOString();
    const raw_payload_json = JSON.stringify(params.rawPayload);

    await this.client.execute(
      `INSERT INTO inbound_webhooks (id, tenant_id, channel, payload_hash, raw_payload_json, processed_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
      [id, tenantId, params.channel, params.payloadHash, raw_payload_json, 'received', now, now]
    );

    const record: InboundWebhookRecord = {
      id,
      tenant_id: tenantId,
      channel: params.channel,
      payload_hash: params.payloadHash,
      raw_payload_json,
      processed_status: 'received',
      created_at: now,
      updated_at: now,
    };

    return { isDuplicate: false, record };
  }
}
