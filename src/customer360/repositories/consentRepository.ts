/**
 * Xylarc AI — Customer Consent Repository
 * Manages privacy consent records and channel opt-in/opt-out preferences.
 */

import { BaseRepository, BaseEntity } from '../../storage/repositories/baseRepository.js';
import { DatabaseClient } from '../../storage/db.js';
import { CryptoUtils } from '../../core/utils/crypto.js';

export type ConsentType =
  | 'whatsapp_marketing'
  | 'voice_calls'
  | 'email_newsletter'
  | 'data_processing';

export interface CustomerConsentRecord extends BaseEntity {
  customer_id: string;
  consent_type: ConsentType;
  status: 'granted' | 'revoked' | 'pending';
  granted_at: string;
  revoked_at?: string;
  ip_address?: string;
  source: string;
}

export class ConsentRepository extends BaseRepository<CustomerConsentRecord> {
  protected readonly tableName = 'customer_consents';

  constructor(client?: DatabaseClient) {
    super(client);
  }

  public async getConsent(customerId: string, type: ConsentType): Promise<CustomerConsentRecord | null> {
    const tenantId = this.getTenantId();
    return this.client.queryOne<CustomerConsentRecord>(
      'SELECT * FROM customer_consents WHERE customer_id = ? AND consent_type = ? AND tenant_id = ?;',
      [customerId, type, tenantId]
    );
  }

  public async listForCustomer(customerId: string): Promise<CustomerConsentRecord[]> {
    const tenantId = this.getTenantId();
    return this.client.query<CustomerConsentRecord>(
      'SELECT * FROM customer_consents WHERE customer_id = ? AND tenant_id = ?;',
      [customerId, tenantId]
    );
  }

  public async setConsent(params: {
    customerId: string;
    consentType: ConsentType;
    status: 'granted' | 'revoked' | 'pending';
    source: string;
    ipAddress?: string;
  }): Promise<CustomerConsentRecord> {
    const tenantId = this.getTenantId();
    const existing = await this.getConsent(params.customerId, params.consentType);
    const now = new Date().toISOString();

    if (existing) {
      const grantedAt = params.status === 'granted' ? now : existing.granted_at;
      const revokedAt = params.status === 'revoked' ? now : undefined;

      await this.client.execute(
        `UPDATE customer_consents 
         SET status = ?, granted_at = ?, revoked_at = ?, source = ?, ip_address = ?, updated_at = ?
         WHERE id = ? AND tenant_id = ?;`,
        [
          params.status,
          grantedAt,
          revokedAt || null,
          params.source,
          params.ipAddress || null,
          now,
          existing.id,
          tenantId,
        ]
      );

      return (await this.findById(existing.id))!;
    }

    const id = CryptoUtils.generateId();
    const record: CustomerConsentRecord = {
      id,
      tenant_id: tenantId,
      customer_id: params.customerId,
      consent_type: params.consentType,
      status: params.status,
      granted_at: params.status === 'granted' ? now : now,
      revoked_at: params.status === 'revoked' ? now : undefined,
      ip_address: params.ipAddress,
      source: params.source,
      created_at: now,
      updated_at: now,
    };

    await this.client.execute(
      `INSERT INTO customer_consents (
        id, tenant_id, customer_id, consent_type, status, granted_at,
        revoked_at, ip_address, source, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        record.id,
        record.tenant_id,
        record.customer_id,
        record.consent_type,
        record.status,
        record.granted_at,
        record.revoked_at || null,
        record.ip_address || null,
        record.source,
        record.created_at,
        record.updated_at,
      ]
    );

    return record;
  }

  public async hasActiveConsent(customerId: string, channel: string, purpose?: string): Promise<boolean> {
    let consentType: ConsentType = 'whatsapp_marketing';
    if (channel === 'email') consentType = 'email_newsletter';
    else if (channel === 'voice') consentType = 'voice_calls';

    const consent = await this.getConsent(customerId, consentType);
    return consent !== null && consent.status === 'granted';
  }

  public async recordConsent(params: {
    customerId: string;
    channel: string;
    purpose?: string;
    status: 'granted' | 'revoked';
  }): Promise<CustomerConsentRecord> {
    let consentType: ConsentType = 'whatsapp_marketing';
    if (params.channel === 'email') consentType = 'email_newsletter';
    else if (params.channel === 'voice') consentType = 'voice_calls';

    return this.setConsent({
      customerId: params.customerId,
      consentType,
      status: params.status,
      source: 'api_consent_flow',
    });
  }
}
