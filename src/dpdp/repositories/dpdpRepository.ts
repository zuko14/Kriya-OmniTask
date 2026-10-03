/**
 * Kriya AI — India DPDP Operations Repository
 * Manages database persistence for Consent Ledger, Rights Requests,
 * Retention Purge Jobs, and Breach Incidents under strict tenant isolation.
 */

import { DatabaseClient, db } from '../../storage/db.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import { TenantIsolationError, NotFoundError } from '../../core/errors/errors.js';
import {
  DpdpConsentRecord,
  DpdpConsentStatus,
  DpdpRightsRequestRecord,
  DpdpRequestStatus,
  DpdpRequestType,
  DpdpRetentionJobRecord,
  DpdpRetentionJobStatus,
  DpdpBreachIncidentRecord,
} from '../types/dpdpTypes.js';

export class DpdpRepository {
  private customClient?: DatabaseClient;

  constructor(client?: DatabaseClient) {
    this.customClient = client;
  }

  private get client(): DatabaseClient {
    return this.customClient || db.getClient();
  }

  private getTenantId(): string {
    const tenantId = TenantContextManager.getTenantId();
    if (!tenantId) {
      throw new TenantIsolationError('Tenant context missing for DPDP operations');
    }
    return tenantId;
  }

  // ==========================================
  // 1. Consent Ledger (§6, §7 DPDP Act 2023)
  // ==========================================

  public async createConsent(record: DpdpConsentRecord): Promise<DpdpConsentRecord> {
    const sql = `
      INSERT INTO dpdp_consent_ledger (
        id, tenant_id, customer_id, purpose, status, notice_version,
        notice_hash, language, valid_until, proof_receipt_id,
        withdrawn_at, withdrawn_reason, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `;

    await this.client.execute(sql, [
      record.id,
      record.tenant_id,
      record.customer_id,
      record.purpose,
      record.status,
      record.notice_version,
      record.notice_hash,
      record.language,
      record.valid_until,
      record.proof_receipt_id,
      record.withdrawn_at,
      record.withdrawn_reason,
      record.created_at,
      record.updated_at,
    ]);

    return record;
  }

  public async getConsentById(id: string): Promise<DpdpConsentRecord | null> {
    const tenantId = this.getTenantId();
    return this.client.queryOne<DpdpConsentRecord>(
      'SELECT * FROM dpdp_consent_ledger WHERE id = ? AND tenant_id = ?;',
      [id, tenantId]
    );
  }

  public async getActiveConsent(customerId: string, purpose: string): Promise<DpdpConsentRecord | null> {
    const tenantId = this.getTenantId();
    const now = new Date().toISOString();
    return this.client.queryOne<DpdpConsentRecord>(
      `SELECT * FROM dpdp_consent_ledger 
       WHERE tenant_id = ? AND customer_id = ? AND purpose = ? AND status = 'granted'
         AND (valid_until IS NULL OR valid_until > ?)
       ORDER BY created_at DESC LIMIT 1;`,
      [tenantId, customerId, purpose, now]
    );
  }

  public async listConsentsForCustomer(customerId: string): Promise<DpdpConsentRecord[]> {
    const tenantId = this.getTenantId();
    return this.client.query<DpdpConsentRecord>(
      'SELECT * FROM dpdp_consent_ledger WHERE tenant_id = ? AND customer_id = ? ORDER BY created_at DESC;',
      [tenantId, customerId]
    );
  }

  public async supersedePriorConsents(customerId: string, purpose: string): Promise<void> {
    const tenantId = this.getTenantId();
    const now = new Date().toISOString();
    await this.client.execute(
      `UPDATE dpdp_consent_ledger 
       SET status = 'superseded', updated_at = ?
       WHERE tenant_id = ? AND customer_id = ? AND purpose = ? AND status = 'granted';`,
      [now, tenantId, customerId, purpose]
    );
  }

  public async updateConsentStatus(
    id: string,
    status: DpdpConsentStatus,
    withdrawnReason?: string,
    proofReceiptId?: string
  ): Promise<void> {
    const tenantId = this.getTenantId();
    const now = new Date().toISOString();
    const withdrawnAt = status === 'withdrawn' ? now : null;

    await this.client.execute(
      `UPDATE dpdp_consent_ledger 
       SET status = ?, withdrawn_at = COALESCE(?, withdrawn_at), 
           withdrawn_reason = COALESCE(?, withdrawn_reason),
           proof_receipt_id = COALESCE(?, proof_receipt_id),
           updated_at = ?
       WHERE id = ? AND tenant_id = ?;`,
      [status, withdrawnAt, withdrawnReason ?? null, proofReceiptId ?? null, now, id, tenantId]
    );
  }

  // ==========================================
  // 2. Data Principal Rights Requests (SAR §11 - §14)
  // ==========================================

  public async createRightsRequest(record: DpdpRightsRequestRecord): Promise<DpdpRightsRequestRecord> {
    const sql = `
      INSERT INTO dpdp_rights_requests (
        id, tenant_id, customer_id, request_type, status,
        payload_json, resolution_notes, erasure_tombstone_hash,
        proof_receipt_id, sla_expires_at, completed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `;

    await this.client.execute(sql, [
      record.id,
      record.tenant_id,
      record.customer_id,
      record.request_type,
      record.status,
      record.payload_json,
      record.resolution_notes,
      record.erasure_tombstone_hash,
      record.proof_receipt_id,
      record.sla_expires_at,
      record.completed_at,
      record.created_at,
      record.updated_at,
    ]);

    return record;
  }

  public async getRightsRequestById(id: string): Promise<DpdpRightsRequestRecord | null> {
    const tenantId = this.getTenantId();
    return this.client.queryOne<DpdpRightsRequestRecord>(
      'SELECT * FROM dpdp_rights_requests WHERE id = ? AND tenant_id = ?;',
      [id, tenantId]
    );
  }

  public async listRightsRequests(filters?: {
    customerId?: string;
    status?: DpdpRequestStatus;
    requestType?: DpdpRequestType;
  }): Promise<DpdpRightsRequestRecord[]> {
    const tenantId = this.getTenantId();
    const whereClauses = ['tenant_id = ?'];
    const params: unknown[] = [tenantId];

    if (filters?.customerId) {
      whereClauses.push('customer_id = ?');
      params.push(filters.customerId);
    }
    if (filters?.status) {
      whereClauses.push('status = ?');
      params.push(filters.status);
    }
    if (filters?.requestType) {
      whereClauses.push('request_type = ?');
      params.push(filters.requestType);
    }

    const sql = `SELECT * FROM dpdp_rights_requests WHERE ${whereClauses.join(' AND ')} ORDER BY created_at DESC;`;
    return this.client.query<DpdpRightsRequestRecord>(sql, params);
  }

  public async updateRightsRequest(
    id: string,
    updates: {
      status?: DpdpRequestStatus;
      resolutionNotes?: string;
      erasureTombstoneHash?: string;
      proofReceiptId?: string;
      completedAt?: string;
    }
  ): Promise<void> {
    const tenantId = this.getTenantId();
    const now = new Date().toISOString();
    const existing = await this.getRightsRequestById(id);
    if (!existing) {
      throw new NotFoundError(`Rights request ${id} not found`);
    }

    const status = updates.status ?? existing.status;
    const resolutionNotes = updates.resolutionNotes ?? existing.resolution_notes;
    const erasureTombstoneHash = updates.erasureTombstoneHash ?? existing.erasure_tombstone_hash;
    const proofReceiptId = updates.proofReceiptId ?? existing.proof_receipt_id;
    const completedAt = updates.completedAt ?? (status === 'completed' || status === 'rejected' ? now : existing.completed_at);

    await this.client.execute(
      `UPDATE dpdp_rights_requests
       SET status = ?, resolution_notes = ?, erasure_tombstone_hash = ?,
           proof_receipt_id = ?, completed_at = ?, updated_at = ?
       WHERE id = ? AND tenant_id = ?;`,
      [status, resolutionNotes, erasureTombstoneHash, proofReceiptId, completedAt, now, id, tenantId]
    );
  }

  // ==========================================
  // 3. Automated Data Retention & Purge (§8(7))
  // ==========================================

  public async createRetentionJob(record: DpdpRetentionJobRecord): Promise<DpdpRetentionJobRecord> {
    const sql = `
      INSERT INTO dpdp_retention_jobs (
        id, tenant_id, policy_id, target_resource_type, retention_days,
        cutoff_timestamp, records_scanned, records_purged, purge_action,
        status, proof_receipt_id, executed_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `;

    await this.client.execute(sql, [
      record.id,
      record.tenant_id,
      record.policy_id,
      record.target_resource_type,
      record.retention_days,
      record.cutoff_timestamp,
      record.records_scanned,
      record.records_purged,
      record.purge_action,
      record.status,
      record.proof_receipt_id,
      record.executed_at,
      record.created_at,
    ]);

    return record;
  }

  public async getRetentionJobById(id: string): Promise<DpdpRetentionJobRecord | null> {
    const tenantId = this.getTenantId();
    return this.client.queryOne<DpdpRetentionJobRecord>(
      'SELECT * FROM dpdp_retention_jobs WHERE id = ? AND tenant_id = ?;',
      [id, tenantId]
    );
  }

  public async listRetentionJobs(limit = 50): Promise<DpdpRetentionJobRecord[]> {
    const tenantId = this.getTenantId();
    return this.client.query<DpdpRetentionJobRecord>(
      'SELECT * FROM dpdp_retention_jobs WHERE tenant_id = ? ORDER BY executed_at DESC LIMIT ?;',
      [tenantId, limit]
    );
  }

  public async updateRetentionJob(
    id: string,
    updates: {
      status: DpdpRetentionJobStatus;
      recordsScanned?: number;
      recordsPurged?: number;
      proofReceiptId?: string;
    }
  ): Promise<void> {
    const tenantId = this.getTenantId();
    await this.client.execute(
      `UPDATE dpdp_retention_jobs
       SET status = ?,
           records_scanned = COALESCE(?, records_scanned),
           records_purged = COALESCE(?, records_purged),
           proof_receipt_id = COALESCE(?, proof_receipt_id)
       WHERE id = ? AND tenant_id = ?;`,
      [
        updates.status,
        updates.recordsScanned ?? null,
        updates.recordsPurged ?? null,
        updates.proofReceiptId ?? null,
        id,
        tenantId,
      ]
    );
  }

  // ==========================================
  // 4. Breach Incident Governance (§8(6))
  // ==========================================

  public async createBreachIncident(record: DpdpBreachIncidentRecord): Promise<DpdpBreachIncidentRecord> {
    const sql = `
      INSERT INTO dpdp_breach_incidents (
        id, tenant_id, incident_name, severity, breach_type, status,
        affected_principals_count, incident_summary, root_cause,
        remediation_steps, dpbi_notified_at, dpbi_reference_number,
        principals_notified_at, dpo_contact, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `;

    await this.client.execute(sql, [
      record.id,
      record.tenant_id,
      record.incident_name,
      record.severity,
      record.breach_type,
      record.status,
      record.affected_principals_count,
      record.incident_summary,
      record.root_cause,
      record.remediation_steps,
      record.dpbi_notified_at,
      record.dpbi_reference_number,
      record.principals_notified_at,
      record.dpo_contact,
      record.created_at,
      record.updated_at,
    ]);

    return record;
  }

  public async getBreachIncidentById(id: string): Promise<DpdpBreachIncidentRecord | null> {
    const tenantId = this.getTenantId();
    return this.client.queryOne<DpdpBreachIncidentRecord>(
      'SELECT * FROM dpdp_breach_incidents WHERE id = ? AND tenant_id = ?;',
      [id, tenantId]
    );
  }

  public async listBreachIncidents(): Promise<DpdpBreachIncidentRecord[]> {
    const tenantId = this.getTenantId();
    return this.client.query<DpdpBreachIncidentRecord>(
      'SELECT * FROM dpdp_breach_incidents WHERE tenant_id = ? ORDER BY created_at DESC;',
      [tenantId]
    );
  }

  public async updateBreachIncident(id: string, updates: Partial<DpdpBreachIncidentRecord>): Promise<void> {
    const tenantId = this.getTenantId();
    const existing = await this.getBreachIncidentById(id);
    if (!existing) {
      throw new NotFoundError(`Breach incident ${id} not found`);
    }

    const now = new Date().toISOString();
    const merged = { ...existing, ...updates, updated_at: now };

    await this.client.execute(
      `UPDATE dpdp_breach_incidents
       SET incident_name = ?, severity = ?, breach_type = ?, status = ?,
           affected_principals_count = ?, incident_summary = ?, root_cause = ?,
           remediation_steps = ?, dpbi_notified_at = ?, dpbi_reference_number = ?,
           principals_notified_at = ?, dpo_contact = ?, updated_at = ?
       WHERE id = ? AND tenant_id = ?;`,
      [
        merged.incident_name,
        merged.severity,
        merged.breach_type,
        merged.status,
        merged.affected_principals_count,
        merged.incident_summary,
        merged.root_cause,
        merged.remediation_steps,
        merged.dpbi_notified_at,
        merged.dpbi_reference_number,
        merged.principals_notified_at,
        merged.dpo_contact,
        merged.updated_at,
        id,
        tenantId,
      ]
    );
  }
}
