/**
 * Kriya AI — Customer Timeline Repository
 * Ingests and sequences chronological customer interaction and agent lifecycle events.
 */

import { BaseRepository, BaseEntity } from '../../storage/repositories/baseRepository.js';
import { DatabaseClient } from '../../storage/db.js';
import { CryptoUtils } from '../../core/utils/crypto.js';

export interface TimelineEventRecord extends BaseEntity {
  customer_id: string;
  channel: 'whatsapp' | 'voice' | 'email' | 'web' | 'crm' | 'system' | 'sms';
  event_type: string;
  summary: string;
  details_json: string;
  correlation_id?: string;
  actor_type: 'agent' | 'customer' | 'human_operator' | 'system';
  actor_id?: string;
}

export class TimelineRepository extends BaseRepository<TimelineEventRecord> {
  protected readonly tableName = 'customer_timeline_events';

  constructor(client?: DatabaseClient) {
    super(client);
  }

  public async appendEvent(params: {
    customerId: string;
    channel: 'whatsapp' | 'voice' | 'email' | 'web' | 'crm' | 'system' | 'sms';
    eventType: string;
    summary: string;
    details?: Record<string, unknown>;
    correlationId?: string;
    actorType?: 'agent' | 'customer' | 'human_operator' | 'system';
    actorId?: string;
  }): Promise<TimelineEventRecord> {
    const tenantId = this.getTenantId();
    const id = CryptoUtils.generateId();
    const now = new Date().toISOString();

    const record: TimelineEventRecord = {
      id,
      tenant_id: tenantId,
      customer_id: params.customerId,
      channel: params.channel,
      event_type: params.eventType,
      summary: params.summary,
      details_json: JSON.stringify(params.details || {}),
      correlation_id: params.correlationId,
      actor_type: params.actorType || 'system',
      actor_id: params.actorId,
      created_at: now,
      updated_at: now,
    };

    await this.client.execute(
      `INSERT INTO customer_timeline_events (
        id, tenant_id, customer_id, channel, event_type, summary,
        details_json, correlation_id, actor_type, actor_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        record.id,
        record.tenant_id,
        record.customer_id,
        record.channel,
        record.event_type,
        record.summary,
        record.details_json,
        record.correlation_id || null,
        record.actor_type,
        record.actor_id || null,
        record.created_at,
      ]
    );

    return record;
  }

  public async getTimeline(
    customerId: string,
    options: { limit?: number; offset?: number; channel?: string } = {}
  ): Promise<TimelineEventRecord[]> {
    const tenantId = this.getTenantId();
    const whereClauses = ['tenant_id = ?', 'customer_id = ?'];
    const params: unknown[] = [tenantId, customerId];

    if (options.channel) {
      whereClauses.push('channel = ?');
      params.push(options.channel);
    }

    const limit = Math.min(options.limit || 50, 100);
    const offset = options.offset || 0;

    const sql = `
      SELECT * FROM customer_timeline_events
      WHERE ${whereClauses.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset};
    `;

    return this.client.query<TimelineEventRecord>(sql, params);
  }

  public async createEvent(params: {
    customerId: string;
    eventType: string;
    channel: any;
    summary: string;
    details?: Record<string, unknown>;
  }): Promise<TimelineEventRecord> {
    return this.appendEvent({
      customerId: params.customerId,
      channel: params.channel,
      eventType: params.eventType,
      summary: params.summary,
      details: params.details,
    });
  }

  public async listByCustomer(customerId: string): Promise<TimelineEventRecord[]> {
    return this.getTimeline(customerId, { limit: 100 });
  }
}
