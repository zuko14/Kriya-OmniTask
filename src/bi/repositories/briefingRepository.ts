/**
 * Kriya AI — Executive Briefings Relational Repository
 * Manages daily executive briefing persistence and temporal queries (§13, §14 of CLAUDE.md).
 */

import { BaseRepository } from '../../storage/repositories/baseRepository.js';
import { DatabaseClient } from '../../storage/db.js';
import {
  ExecutiveBriefingRecord,
  BriefingType,
  MetricsSnapshot,
  KeyHighlight,
  AttentionItem,
  RoiMetrics,
} from '../types/biTypes.js';
import { CryptoUtils } from '../../core/utils/crypto.js';

export class BriefingRepository extends BaseRepository<ExecutiveBriefingRecord> {
  protected readonly tableName = 'executive_briefings';

  constructor(client?: DatabaseClient) {
    super(client);
  }

  /**
   * Persists a newly synthesized executive briefing.
   */
  public async createBriefing(data: {
    briefingDate: string;
    briefingType: BriefingType;
    title: string;
    summaryMarkdown: string;
    metricsSnapshot: MetricsSnapshot;
    keyHighlights: KeyHighlight[];
    attentionItems: AttentionItem[];
    roiMetrics: RoiMetrics;
    whatsappFormattedText: string;
  }): Promise<ExecutiveBriefingRecord> {
    const tenantId = this.getTenantId();
    const id = CryptoUtils.generateId();
    const now = new Date().toISOString();

    const record: ExecutiveBriefingRecord = {
      id,
      tenant_id: tenantId,
      organization_id: 'default',
      briefing_date: data.briefingDate,
      briefing_type: data.briefingType,
      title: data.title,
      summary_markdown: data.summaryMarkdown,
      metrics_snapshot_json: JSON.stringify(data.metricsSnapshot),
      key_highlights_json: JSON.stringify(data.keyHighlights),
      attention_items_json: JSON.stringify(data.attentionItems),
      roi_metrics_json: JSON.stringify(data.roiMetrics),
      whatsapp_formatted_text: data.whatsappFormattedText,
      status: 'generated',
      created_at: now,
      updated_at: now,
    };

    await this.client.execute(
      `INSERT INTO executive_briefings (
        id, tenant_id, organization_id, briefing_date, briefing_type, title,
        summary_markdown, metrics_snapshot_json, key_highlights_json,
        attention_items_json, roi_metrics_json, whatsapp_formatted_text,
        status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        record.id,
        record.tenant_id,
        record.organization_id,
        record.briefing_date,
        record.briefing_type,
        record.title,
        record.summary_markdown,
        record.metrics_snapshot_json,
        record.key_highlights_json,
        record.attention_items_json,
        record.roi_metrics_json,
        record.whatsapp_formatted_text,
        record.status,
        record.created_at,
        record.updated_at,
      ]
    );

    return record;
  }

  /**
   * Retrieves briefings for the tenant, optionally filtered by date.
   */
  public async listBriefings(startDate?: string, endDate?: string): Promise<ExecutiveBriefingRecord[]> {
    const tenantId = this.getTenantId();
    let sql = 'SELECT * FROM executive_briefings WHERE tenant_id = ?';
    const params: unknown[] = [tenantId];

    if (startDate && endDate) {
      sql += ' AND briefing_date BETWEEN ? AND ?';
      params.push(startDate, endDate);
    }

    sql += ' ORDER BY briefing_date DESC, created_at DESC;';
    return this.client.query<ExecutiveBriefingRecord>(sql, params);
  }

  /**
   * Marks a briefing as delivered.
   */
  public async markDelivered(id: string): Promise<void> {
    const tenantId = this.getTenantId();
    const now = new Date().toISOString();
    await this.client.execute(
      "UPDATE executive_briefings SET status = 'delivered', delivered_at = ?, updated_at = ? WHERE id = ? AND tenant_id = ?;",
      [now, now, id, tenantId]
    );
  }
}
