/**
 * Kriya AI — Multilingual Profiles & Translations Relational Repository
 * Persistence for customer language preferences and translation caches (§14, §19 of CLAUDE.md).
 */

import { BaseRepository } from '../../storage/repositories/baseRepository.js';
import { DatabaseClient } from '../../storage/db.js';
import {
  LanguageProfileRecord,
  MultilingualTranslationRecord,
  SupportedLanguage,
  SupportedScript,
} from '../types/multilingualTypes.js';
import { CryptoUtils } from '../../core/utils/crypto.js';

export class MultilingualRepository extends BaseRepository<LanguageProfileRecord> {
  protected readonly tableName = 'language_profiles';

  constructor(client?: DatabaseClient) {
    super(client);
  }

  /**
   * Upserts a customer language profile.
   */
  public async upsertProfile(params: {
    customerId: string;
    primaryLanguage: SupportedLanguage;
    preferredScript?: SupportedScript;
    isCodeSwitched?: boolean;
    confidenceScore?: number;
    detectedLanguages?: Array<{ language: SupportedLanguage; confidence: number }>;
  }): Promise<LanguageProfileRecord> {
    const tenantId = this.getTenantId();
    const now = new Date().toISOString();
    const existing = await this.getProfileByCustomerId(params.customerId);

    const record: LanguageProfileRecord = {
      id: existing ? existing.id : CryptoUtils.generateId(),
      tenant_id: tenantId,
      organization_id: 'default',
      customer_id: params.customerId,
      primary_language: params.primaryLanguage,
      detected_languages_json: JSON.stringify(params.detectedLanguages || [{ language: params.primaryLanguage, confidence: 1.0 }]),
      preferred_script: params.preferredScript || 'Latin',
      is_code_switched: params.isCodeSwitched ? 1 : 0,
      confidence_score: params.confidenceScore ?? 1.0,
      created_at: existing ? existing.created_at : now,
      updated_at: now,
    };

    if (existing) {
      await this.client.execute(
        `UPDATE language_profiles SET
          primary_language = ?, detected_languages_json = ?, preferred_script = ?,
          is_code_switched = ?, confidence_score = ?, updated_at = ?
        WHERE id = ? AND tenant_id = ?;`,
        [
          record.primary_language,
          record.detected_languages_json,
          record.preferred_script,
          record.is_code_switched,
          record.confidence_score,
          record.updated_at,
          record.id,
          record.tenant_id,
        ]
      );
    } else {
      await this.client.execute(
        `INSERT INTO language_profiles (
          id, tenant_id, organization_id, customer_id, primary_language,
          detected_languages_json, preferred_script, is_code_switched,
          confidence_score, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        [
          record.id,
          record.tenant_id,
          record.organization_id,
          record.customer_id,
          record.primary_language,
          record.detected_languages_json,
          record.preferred_script,
          record.is_code_switched,
          record.confidence_score,
          record.created_at,
          record.updated_at,
        ]
      );
    }

    return record;
  }

  /**
   * Retrieves a customer language profile by customer ID.
   */
  public async getProfileByCustomerId(customerId: string): Promise<LanguageProfileRecord | null> {
    const tenantId = this.getTenantId();
    const rows = await this.client.query<LanguageProfileRecord>(
      'SELECT * FROM language_profiles WHERE tenant_id = ? AND customer_id = ? LIMIT 1;',
      [tenantId, customerId]
    );
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Caches a translation record in the database.
   */
  public async saveTranslation(params: {
    sourceText: string;
    sourceLanguage: string;
    targetLanguage: string;
    translatedText: string;
    qualityScore?: number;
    latencyMs?: number;
  }): Promise<MultilingualTranslationRecord> {
    const tenantId = this.getTenantId();
    const id = CryptoUtils.generateId();
    const now = new Date().toISOString();

    const record: MultilingualTranslationRecord = {
      id,
      tenant_id: tenantId,
      organization_id: 'default',
      source_text: params.sourceText,
      source_language: params.sourceLanguage,
      target_language: params.targetLanguage,
      translated_text: params.translatedText,
      quality_score: params.qualityScore ?? 1.0,
      latency_ms: params.latencyMs ?? 0,
      created_at: now,
      updated_at: now,
    };

    await this.client.execute(
      `INSERT INTO multilingual_translations (
        id, tenant_id, organization_id, source_text, source_language,
        target_language, translated_text, quality_score, latency_ms,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        record.id,
        record.tenant_id,
        record.organization_id,
        record.source_text,
        record.source_language,
        record.target_language,
        record.translated_text,
        record.quality_score,
        record.latency_ms,
        record.created_at,
        record.updated_at,
      ]
    );

    return record;
  }

  /**
   * Looks up cached translation.
   */
  public async findCachedTranslation(
    sourceText: string,
    sourceLang: string,
    targetLang: string
  ): Promise<MultilingualTranslationRecord | null> {
    const tenantId = this.getTenantId();
    const rows = await this.client.query<MultilingualTranslationRecord>(
      'SELECT * FROM multilingual_translations WHERE tenant_id = ? AND source_text = ? AND source_language = ? AND target_language = ? LIMIT 1;',
      [tenantId, sourceText, sourceLang, targetLang]
    );
    return rows.length > 0 ? rows[0] : null;
  }
}
