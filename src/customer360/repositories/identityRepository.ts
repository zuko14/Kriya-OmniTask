/**
 * Xylarc AI — Customer Identity Repository
 * Manages multi-identifier alias records for deterministic entity resolution.
 */

import { BaseRepository, BaseEntity } from '../../storage/repositories/baseRepository.js';
import { DatabaseClient } from '../../storage/db.js';
import { CryptoUtils } from '../../core/utils/crypto.js';

export interface CustomerIdentityRecord extends BaseEntity {
  customer_id: string;
  identity_type: string;
  identity_value: string;
  is_verified: number;
  confidence: number;
  source: string;
}

export class IdentityRepository extends BaseRepository<CustomerIdentityRecord> {
  protected readonly tableName = 'customer_identities';

  constructor(client?: DatabaseClient) {
    super(client);
  }

  public async findIdentity(type: string, value: string): Promise<CustomerIdentityRecord | null> {
    const tenantId = this.getTenantId();
    return this.client.queryOne<CustomerIdentityRecord>(
      'SELECT * FROM customer_identities WHERE identity_type = ? AND identity_value = ? AND tenant_id = ?;',
      [type, value, tenantId]
    );
  }

  public async listForCustomer(customerId: string): Promise<CustomerIdentityRecord[]> {
    const tenantId = this.getTenantId();
    return this.client.query<CustomerIdentityRecord>(
      'SELECT * FROM customer_identities WHERE customer_id = ? AND tenant_id = ? ORDER BY created_at DESC;',
      [customerId, tenantId]
    );
  }

  public async registerIdentity(params: {
    customerId: string;
    identityType: string;
    identityValue: string;
    isVerified?: boolean;
    confidence?: number;
    source: string;
  }): Promise<CustomerIdentityRecord> {
    const tenantId = this.getTenantId();
    const existing = await this.findIdentity(params.identityType, params.identityValue);
    const now = new Date().toISOString();

    if (existing) {
      if (existing.customer_id !== params.customerId) {
        // Updated pointer if higher verification
        await this.client.execute(
          `UPDATE customer_identities 
           SET customer_id = ?, is_verified = ?, confidence = ?, updated_at = ?
           WHERE id = ? AND tenant_id = ?;`,
          [
            params.customerId,
            params.isVerified ? 1 : existing.is_verified,
            params.confidence ?? existing.confidence,
            now,
            existing.id,
            tenantId,
          ]
        );
      }
      return (await this.findById(existing.id))!;
    }

    const id = CryptoUtils.generateId();
    const record: CustomerIdentityRecord = {
      id,
      tenant_id: tenantId,
      customer_id: params.customerId,
      identity_type: params.identityType,
      identity_value: params.identityValue,
      is_verified: params.isVerified ? 1 : 0,
      confidence: params.confidence ?? 1.0,
      source: params.source,
      created_at: now,
      updated_at: now,
    };

    await this.client.execute(
      `INSERT INTO customer_identities (id, tenant_id, customer_id, identity_type, identity_value, is_verified, confidence, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        record.id,
        record.tenant_id,
        record.customer_id,
        record.identity_type,
        record.identity_value,
        record.is_verified,
        record.confidence,
        record.source,
        record.created_at,
        record.updated_at,
      ]
    );

    return record;
  }
}
