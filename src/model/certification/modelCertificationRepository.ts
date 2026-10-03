import { db, DatabaseClient } from '../../storage/db.js';
import { CapabilityTier, CertificationStatus, ModelCertificationRecord } from './certificationTypes.js';
import { logger } from '../../core/logger/logger.js';

export class ModelCertificationRepository {
  private dbClient: DatabaseClient;

  constructor(dbClient?: DatabaseClient) {
    this.dbClient = dbClient || db.getClient();
  }

  /**
   * Records a certification result for a specific tier × language matrix cell.
   * §9.2: Stored per tier × per language — no single aggregate score exists anywhere.
   */
  public async saveCertification(record: Omit<ModelCertificationRecord, 'created_at' | 'updated_at'>): Promise<ModelCertificationRecord> {
    const now = new Date().toISOString();
    const existing = await this.dbClient.queryOne<ModelCertificationRecord>(
      'SELECT * FROM model_certifications WHERE model_id = ? AND tier = ? AND language = ?',
      [record.model_id, record.tier, record.language]
    );

    if (existing) {
      await this.dbClient.execute(
        `UPDATE model_certifications SET
          model_version = ?,
          provider = ?,
          upstream_provider = ?,
          eval_suite_version = ?,
          status = ?,
          pass_rate = ?,
          latency_p95_ms = ?,
          cost_per_task_usd = ?,
          stage_results_json = ?,
          certified_at = ?,
          expires_at = ?,
          certified_by = ?,
          updated_at = ?
        WHERE id = ?`,
        [
          record.model_version,
          record.provider,
          record.upstream_provider || 'direct',
          record.eval_suite_version || 'v1.0.0',
          record.status,
          record.pass_rate,
          record.latency_p95_ms,
          record.cost_per_task_usd,
          record.stage_results_json || '{}',
          record.certified_at || null,
          record.expires_at || null,
          record.certified_by || 'system_harness',
          now,
          existing.id,
        ]
      );
      return (await this.dbClient.queryOne<ModelCertificationRecord>(
        'SELECT * FROM model_certifications WHERE id = ?',
        [existing.id]
      ))!;
    } else {
      const id = record.id || `cert_${record.model_id}_${record.tier}_${record.language}_${Date.now()}`;
      await this.dbClient.execute(
        `INSERT INTO model_certifications (
          id, model_id, model_version, provider, upstream_provider, tier,
          language, eval_suite_version, status, pass_rate, latency_p95_ms,
          cost_per_task_usd, stage_results_json, certified_at, expires_at,
          certified_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          record.model_id,
          record.model_version,
          record.provider,
          record.upstream_provider || 'direct',
          record.tier,
          record.language,
          record.eval_suite_version || 'v1.0.0',
          record.status,
          record.pass_rate,
          record.latency_p95_ms,
          record.cost_per_task_usd,
          record.stage_results_json || '{}',
          record.certified_at || null,
          record.expires_at || null,
          record.certified_by || 'system_harness',
          now,
          now,
        ]
      );
      return (await this.dbClient.queryOne<ModelCertificationRecord>(
        'SELECT * FROM model_certifications WHERE id = ?',
        [id]
      ))!;
    }
  }

  /**
   * Finds active certified models for a specific capability tier and language.
   */
  public async findCertifiedModels(tier: CapabilityTier, language: string): Promise<ModelCertificationRecord[]> {
    return this.dbClient.query<ModelCertificationRecord>(
      `SELECT * FROM model_certifications 
       WHERE tier = ? AND language = ? AND status = 'certified'
         AND (expires_at IS NULL OR expires_at > ?)
       ORDER BY pass_rate DESC, latency_p95_ms ASC`,
      [tier, language, new Date().toISOString()]
    );
  }

  /**
   * Retrieves all certification records for a specific model (the tier × language matrix).
   */
  public async getCertificationMatrix(modelId: string): Promise<ModelCertificationRecord[]> {
    return this.dbClient.query<ModelCertificationRecord>(
      'SELECT * FROM model_certifications WHERE model_id = ? ORDER BY tier ASC, language ASC',
      [modelId]
    );
  }

  /**
   * Automatically invalidates certifications on model version change or upstream provider change.
   * §9.2, §9.9, §23: "Certification invalidates automatically on model version change and on detected upstream/router change"
   */
  public async invalidateOnVersionOrUpstreamChange(
    modelId: string,
    newVersion: string,
    newUpstreamProvider?: string
  ): Promise<number> {
    const now = new Date().toISOString();
    const existingRecords = await this.getCertificationMatrix(modelId);
    let invalidatedCount = 0;

    for (const record of existingRecords) {
      const versionChanged = record.model_version !== newVersion;
      const upstreamChanged = newUpstreamProvider && record.upstream_provider !== newUpstreamProvider;

      if (versionChanged || upstreamChanged) {
        await this.dbClient.execute(
          `UPDATE model_certifications SET
            status = 'expired',
            updated_at = ?
           WHERE id = ?`,
          [now, record.id]
        );
        invalidatedCount++;
      }
    }

    if (invalidatedCount > 0) {
      logger.warn(`Invalidated ${invalidatedCount} certifications for model '${modelId}' due to version/upstream change.`, {
        modelId,
        newVersion,
        newUpstreamProvider,
      });
    }

    return invalidatedCount;
  }

  /**
   * Lists all model certifications across the platform.
   */
  public async listAllCertifications(filter?: {
    status?: CertificationStatus;
    tier?: CapabilityTier;
    language?: string;
  }): Promise<ModelCertificationRecord[]> {
    let sql = 'SELECT * FROM model_certifications WHERE 1=1';
    const params: unknown[] = [];

    if (filter?.status) {
      sql += ' AND status = ?';
      params.push(filter.status);
    }
    if (filter?.tier) {
      sql += ' AND tier = ?';
      params.push(filter.tier);
    }
    if (filter?.language) {
      sql += ' AND language = ?';
      params.push(filter.language);
    }

    sql += ' ORDER BY model_id ASC, tier ASC, language ASC';
    return this.dbClient.query<ModelCertificationRecord>(sql, params);
  }
}
