/**
 * Kriya AI — Parsed Documents Relational Repository
 * Persistence for extracted document structured data and verification hashes (docs/kriya WP-4.5).
 * Enforces Zero-Retention: raw document bytes/text are NEVER stored in this repository.
 */

import { BaseRepository } from '../../storage/repositories/baseRepository.js';
import { DatabaseClient } from '../../storage/db.js';
import {
  ParsedDocumentRecord,
  DocumentType,
  ExtractionMethod,
  DocumentStatus,
} from '../types/documentTypes.js';
import { CryptoUtils } from '../../core/utils/crypto.js';

export class DocumentRepository extends BaseRepository<ParsedDocumentRecord> {
  protected readonly tableName = 'parsed_documents';

  constructor(client?: DatabaseClient) {
    super(client);
  }

  /**
   * Persists extracted structured document metadata with zero-retention compliance.
   */
  public async saveParsedDocument(params: {
    correlationId: string;
    runId?: string | null;
    documentType: DocumentType;
    sha256Hash: string;
    extractionMethod: ExtractionMethod;
    confidence: number;
    isValid: boolean;
    structuredData: Record<string, unknown>;
    validationErrors?: string[];
    status: DocumentStatus;
  }): Promise<ParsedDocumentRecord> {
    const tenantId = this.getTenantId();
    const id = CryptoUtils.generateId();
    const now = new Date().toISOString();

    const record: ParsedDocumentRecord = {
      id,
      tenant_id: tenantId,
      correlation_id: params.correlationId,
      run_id: params.runId || null,
      document_type: params.documentType,
      sha256_hash: params.sha256Hash,
      extraction_method: params.extractionMethod,
      confidence: params.confidence,
      is_valid: params.isValid ? 1 : 0,
      structured_data_json: JSON.stringify(params.structuredData),
      validation_errors_json: params.validationErrors ? JSON.stringify(params.validationErrors) : null,
      status: params.status,
      created_at: now,
      updated_at: now,
    };

    await this.client.execute(
      `INSERT INTO parsed_documents (
        id, tenant_id, correlation_id, run_id, document_type, sha256_hash,
        extraction_method, confidence, is_valid, structured_data_json,
        validation_errors_json, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        record.id,
        record.tenant_id,
        record.correlation_id,
        record.run_id,
        record.document_type,
        record.sha256_hash,
        record.extraction_method,
        record.confidence,
        record.is_valid,
        record.structured_data_json,
        record.validation_errors_json,
        record.status,
        record.created_at,
        record.updated_at,
      ]
    );

    return record;
  }

  /**
   * Finds a previously parsed document by its raw content SHA-256 hash (deduplication / cache).
   */
  public async findByHash(sha256Hash: string): Promise<ParsedDocumentRecord | null> {
    const tenantId = this.getTenantId();
    return this.client.queryOne<ParsedDocumentRecord>(
      'SELECT * FROM parsed_documents WHERE tenant_id = ? AND sha256_hash = ? ORDER BY created_at DESC LIMIT 1;',
      [tenantId, sha256Hash]
    );
  }

  /**
   * Finds a parsed document by correlation ID.
   */
  public async findByCorrelationId(correlationId: string): Promise<ParsedDocumentRecord | null> {
    const tenantId = this.getTenantId();
    return this.client.queryOne<ParsedDocumentRecord>(
      'SELECT * FROM parsed_documents WHERE tenant_id = ? AND correlation_id = ? ORDER BY created_at DESC LIMIT 1;',
      [tenantId, correlationId]
    );
  }

  /**
   * Lists recently parsed documents for the tenant.
   */
  public async listRecent(limit = 50): Promise<ParsedDocumentRecord[]> {
    const tenantId = this.getTenantId();
    return this.client.query<ParsedDocumentRecord>(
      'SELECT * FROM parsed_documents WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?;',
      [tenantId, limit]
    );
  }
}
