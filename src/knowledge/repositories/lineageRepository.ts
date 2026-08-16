/**
 * Xylarc AI — Knowledge Lineage & Provenance Ledger Repository
 * Records immutable provenance events, version transitions, and agent retrieval traces (§10, §12 of CLAUDE.md).
 */

import { BaseRepository } from '../../storage/repositories/baseRepository.js';
import { DatabaseClient } from '../../storage/db.js';
import { KnowledgeLineageEventRecord } from '../types/knowledgeTypes.js';
import { CryptoUtils } from '../../core/utils/crypto.js';

export class LineageRepository extends BaseRepository<KnowledgeLineageEventRecord> {
  protected readonly tableName = 'knowledge_lineage_events';

  constructor(client?: DatabaseClient) {
    super(client);
  }

  /**
   * Appends an immutable lineage event.
   */
  public async recordEvent(params: {
    documentId: string;
    eventType: 'ingested' | 'chunked' | 'embedded' | 'updated' | 'verified' | 'invalidated' | 'retrieved';
    actorType: 'user' | 'agent' | 'system';
    actorId: string;
    agentId?: string;
    queryText?: string;
    details?: Record<string, unknown>;
  }): Promise<KnowledgeLineageEventRecord> {
    const tenantId = this.getTenantId();
    const id = CryptoUtils.generateId();
    const now = new Date().toISOString();

    const record: KnowledgeLineageEventRecord = {
      id,
      tenant_id: tenantId,
      document_id: params.documentId,
      event_type: params.eventType,
      actor_type: params.actorType,
      actor_id: params.actorId,
      agent_id: params.agentId,
      query_text: params.queryText,
      details_json: JSON.stringify(params.details || {}),
      created_at: now,
      updated_at: now,
    };

    await this.client.execute(
      `INSERT INTO knowledge_lineage_events (
        id, tenant_id, document_id, event_type, actor_type, actor_id, agent_id, query_text, details_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        record.id,
        record.tenant_id,
        record.document_id,
        record.event_type,
        record.actor_type,
        record.actor_id,
        record.agent_id || null,
        record.query_text || null,
        record.details_json,
        record.created_at,
      ]
    );

    return record;
  }

  /**
   * Lists lineage events for a given document.
   */
  public async getLineageForDocument(documentId: string): Promise<KnowledgeLineageEventRecord[]> {
    const tenantId = this.getTenantId();
    return this.client.query<KnowledgeLineageEventRecord>(
      'SELECT * FROM knowledge_lineage_events WHERE tenant_id = ? AND document_id = ? ORDER BY created_at DESC;',
      [tenantId, documentId]
    );
  }
}
