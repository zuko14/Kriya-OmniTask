/**
 * Kriya AI — Customer Repository
 * Manages customer 360 profile state, lifecycle transitions, and GDPR anonymization.
 */

import { BaseRepository, BaseEntity } from '../../storage/repositories/baseRepository.js';
import { DatabaseClient } from '../../storage/db.js';

export type LifecycleStage =
  | 'lead'
  | 'prospect'
  | 'qualified'
  | 'opportunity'
  | 'customer'
  | 'active'
  | 'at_risk'
  | 'churn_risk'
  | 'churned'
  | 'dormant'
  | 'reactivated'
  | 'win_back';

export interface CustomerRecord extends BaseEntity {
  organization_id?: string;
  primary_email?: string;
  primary_phone?: string;
  external_crm_id?: string;
  full_name: string;
  lifecycle_stage: LifecycleStage;
  sentiment_score: number;
  churn_risk_score: number;
  preferred_language: string;
  preferred_channel: 'whatsapp' | 'voice' | 'email' | 'web';
  attributes_json: string;
  status: 'active' | 'merged' | 'archived';
  merged_into_id?: string;
}

export class CustomerRepository extends BaseRepository<CustomerRecord> {
  protected readonly tableName = 'customers';

  constructor(client?: DatabaseClient) {
    super(client);
  }

  public async findByEmail(email: string): Promise<CustomerRecord | null> {
    const tenantId = this.getTenantId();
    const normalized = email.toLowerCase().trim();
    return this.client.queryOne<CustomerRecord>(
      "SELECT * FROM customers WHERE primary_email = ? AND tenant_id = ? AND status = 'active';",
      [normalized, tenantId]
    );
  }

  public async findByPhone(phone: string): Promise<CustomerRecord | null> {
    const tenantId = this.getTenantId();
    const normalized = phone.replace(/[^0-9+]/g, '');
    return this.client.queryOne<CustomerRecord>(
      "SELECT * FROM customers WHERE primary_phone = ? AND tenant_id = ? AND status = 'active';",
      [normalized, tenantId]
    );
  }

  public async findByCrmId(crmId: string): Promise<CustomerRecord | null> {
    const tenantId = this.getTenantId();
    return this.client.queryOne<CustomerRecord>(
      "SELECT * FROM customers WHERE external_crm_id = ? AND tenant_id = ? AND status = 'active';",
      [crmId.trim(), tenantId]
    );
  }

  public async search(params: {
    query?: string;
    lifecycleStage?: LifecycleStage;
    limit?: number;
    offset?: number;
  }): Promise<{ customers: CustomerRecord[]; total: number }> {
    const tenantId = this.getTenantId();
    const whereClauses = ['tenant_id = ?', "status = 'active'"];
    const sqlParams: unknown[] = [tenantId];

    if (params.lifecycleStage) {
      whereClauses.push('lifecycle_stage = ?');
      sqlParams.push(params.lifecycleStage);
    }

    if (params.query) {
      whereClauses.push('(full_name LIKE ? OR primary_email LIKE ? OR primary_phone LIKE ?)');
      const q = `%${params.query}%`;
      sqlParams.push(q, q, q);
    }

    const whereStr = whereClauses.join(' AND ');
    const countRes = await this.client.queryOne<{ total: number }>(
      `SELECT COUNT(*) as total FROM customers WHERE ${whereStr};`,
      sqlParams
    );
    const total = countRes ? Number(countRes.total) : 0;

    const limit = Math.min(params.limit || 50, 100);
    const offset = params.offset || 0;

    const customers = await this.client.query<CustomerRecord>(
      `SELECT * FROM customers WHERE ${whereStr} ORDER BY updated_at DESC LIMIT ${limit} OFFSET ${offset};`,
      sqlParams
    );

    return { customers, total };
  }

  public async updateSignals(
    customerId: string,
    signals: {
      sentimentScore?: number;
      churnRiskScore?: number;
      lifecycleStage?: LifecycleStage;
    }
  ): Promise<void> {
    const tenantId = this.getTenantId();
    const sets: string[] = ['updated_at = ?'];
    const params: unknown[] = [new Date().toISOString()];

    if (signals.sentimentScore !== undefined) {
      sets.push('sentiment_score = ?');
      params.push(signals.sentimentScore);
    }
    if (signals.churnRiskScore !== undefined) {
      sets.push('churn_risk_score = ?');
      params.push(signals.churnRiskScore);
    }
    if (signals.lifecycleStage !== undefined) {
      sets.push('lifecycle_stage = ?');
      params.push(signals.lifecycleStage);
    }

    params.push(customerId, tenantId);
    await this.client.execute(
      `UPDATE customers SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?;`,
      params
    );
  }

  public async anonymize(customerId: string): Promise<void> {
    const tenantId = this.getTenantId();
    const now = new Date().toISOString();
    await this.client.execute(
      `UPDATE customers SET
        full_name = 'Anonymized Customer',
        primary_email = NULL,
        primary_phone = NULL,
        external_crm_id = NULL,
        attributes_json = '{}',
        status = 'archived',
        updated_at = ?
       WHERE id = ? AND tenant_id = ?;`,
      [now, customerId, tenantId]
    );
  }

  public async createCustomer(params: {
    name?: string;
    phone?: string;
    email?: string;
    lifecycle_stage?: LifecycleStage;
    sentiment_score?: number;
    churn_risk_score?: number;
  }): Promise<CustomerRecord> {
    return this.create({
      full_name: params.name || 'Anonymous Customer',
      primary_phone: params.phone,
      primary_email: params.email,
      lifecycle_stage: params.lifecycle_stage || 'lead',
      sentiment_score: params.sentiment_score ?? 0.5,
      churn_risk_score: params.churn_risk_score ?? 0.2,
      preferred_language: 'en',
      preferred_channel: 'whatsapp',
      attributes_json: '{}',
      status: 'active',
    });
  }

  public async updateCustomer(customerId: string, data: Partial<CustomerRecord>): Promise<CustomerRecord | null> {
    return this.update(customerId, data);
  }
}
