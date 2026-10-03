/**
 * Kriya AI — Security Audit Ledger & Secret Rotation Relational Repository
 * Persistence for chained audit events and encrypted secret records (§14, §20 of CLAUDE.md).
 */

import { BaseRepository } from '../../../storage/repositories/baseRepository.js';
import { DatabaseClient } from '../../../storage/db.js';
import {
  SecurityAuditLedgerRecord,
  SecretRotationRecord,
  LogSecurityEventRequest,
  SecretStatus,
} from '../types/securityHardeningTypes.js';
import { CryptoAuditLedger } from '../ledger/cryptoAuditLedger.js';
import { CryptoUtils } from '../../../core/utils/crypto.js';

export class SecurityHardeningRepository extends BaseRepository<SecurityAuditLedgerRecord> {
  protected readonly tableName = 'security_audit_ledger';

  constructor(client?: DatabaseClient) {
    super(client);
  }

  /**
   * Appends an audit event to the cryptographically chained ledger.
   */
  public async appendAuditEvent(request: LogSecurityEventRequest): Promise<SecurityAuditLedgerRecord> {
    const tenantId = this.getTenantId();
    const id = CryptoUtils.generateId();
    const now = new Date().toISOString();

    // 1. Fetch latest event to get previous hash and sequence number
    const latestRows = await this.client.query<SecurityAuditLedgerRecord>(
      'SELECT * FROM security_audit_ledger WHERE tenant_id = ? ORDER BY sequence_number DESC LIMIT 1;',
      [tenantId]
    );

    const sequenceNumber = latestRows.length > 0 ? latestRows[0].sequence_number + 1 : 1;
    const previousHash = latestRows.length > 0 ? latestRows[0].current_hash : CryptoAuditLedger.GENESIS_HASH;

    // 2. Compute payload and current hash
    const payloadHash = CryptoAuditLedger.computePayloadHash(request.payload || {});
    const currentHash = CryptoAuditLedger.computeCurrentHash({
      sequenceNumber,
      eventType: request.eventType,
      actorId: request.actorId,
      actorRole: request.actorRole,
      targetResource: request.targetResource,
      action: request.action,
      payloadHash,
      previousHash,
    });

    const record: SecurityAuditLedgerRecord = {
      id,
      tenant_id: tenantId,
      organization_id: 'default',
      sequence_number: sequenceNumber,
      event_type: request.eventType,
      actor_id: request.actorId,
      actor_role: request.actorRole,
      target_resource: request.targetResource,
      action: request.action,
      payload_hash: payloadHash,
      previous_hash: previousHash,
      current_hash: currentHash,
      created_at: now,
      updated_at: now,
    };

    await this.client.execute(
      `INSERT INTO security_audit_ledger (
        id, tenant_id, organization_id, sequence_number, event_type,
        actor_id, actor_role, target_resource, action, payload_hash,
        previous_hash, current_hash, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        record.id,
        record.tenant_id,
        record.organization_id,
        record.sequence_number,
        record.event_type,
        record.actor_id,
        record.actor_role,
        record.target_resource,
        record.action,
        record.payload_hash,
        record.previous_hash,
        record.current_hash,
        record.created_at,
      ]
    );

    return record;
  }

  /**
   * Retrieves all audit ledger records in sequential order.
   */
  public async listAuditRecords(limit: number = 1000): Promise<SecurityAuditLedgerRecord[]> {
    const tenantId = this.getTenantId();
    return this.client.query<SecurityAuditLedgerRecord>(
      'SELECT * FROM security_audit_ledger WHERE tenant_id = ? ORDER BY sequence_number ASC LIMIT ?;',
      [tenantId, limit]
    );
  }

  /**
   * Gets the active secret for a secret name.
   */
  public async getActiveSecret(secretName: string): Promise<SecretRotationRecord | null> {
    const tenantId = this.getTenantId();
    const rows = await this.client.query<SecretRotationRecord>(
      "SELECT * FROM secret_rotations WHERE tenant_id = ? AND secret_name = ? AND status = 'active' ORDER BY secret_version DESC LIMIT 1;",
      [tenantId, secretName]
    );
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Lists all secret versions for the tenant.
   */
  public async listSecrets(secretName?: string): Promise<SecretRotationRecord[]> {
    const tenantId = this.getTenantId();
    let sql = 'SELECT * FROM secret_rotations WHERE tenant_id = ?';
    const params: unknown[] = [tenantId];

    if (secretName) {
      sql += ' AND secret_name = ?';
      params.push(secretName);
    }

    sql += ' ORDER BY created_at DESC;';
    return this.client.query<SecretRotationRecord>(sql, params);
  }

  /**
   * Saves a new secret version and updates previous version status.
   */
  public async saveSecretRotation(params: {
    newRecord: {
      secretName: string;
      secretVersion: number;
      status: SecretStatus;
      encryptedSecretValue: string;
      rotatedAt: string;
    };
    updatedPreviousRecord?: {
      id: string;
      status: SecretStatus;
      expiresAt: string;
    };
  }): Promise<SecretRotationRecord> {
    const tenantId = this.getTenantId();
    const id = CryptoUtils.generateId();
    const now = new Date().toISOString();

    if (params.updatedPreviousRecord) {
      await this.client.execute(
        'UPDATE secret_rotations SET status = ?, expires_at = ?, updated_at = ? WHERE id = ? AND tenant_id = ?;',
        [
          params.updatedPreviousRecord.status,
          params.updatedPreviousRecord.expiresAt,
          now,
          params.updatedPreviousRecord.id,
          tenantId,
        ]
      );
    }

    const record: SecretRotationRecord = {
      id,
      tenant_id: tenantId,
      organization_id: 'default',
      secret_name: params.newRecord.secretName,
      secret_version: params.newRecord.secretVersion,
      status: params.newRecord.status,
      encrypted_secret_value: params.newRecord.encryptedSecretValue,
      rotated_at: params.newRecord.rotatedAt,
      created_at: now,
      updated_at: now,
    };

    await this.client.execute(
      `INSERT INTO secret_rotations (
        id, tenant_id, organization_id, secret_name, secret_version,
        status, encrypted_secret_value, rotated_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        record.id,
        record.tenant_id,
        record.organization_id,
        record.secret_name,
        record.secret_version,
        record.status,
        record.encrypted_secret_value,
        record.rotated_at,
        record.created_at,
        record.updated_at,
      ]
    );

    return record;
  }

  /**
   * Automatically revokes all secrets whose grace period has expired.
   */
  public async revokeExpiredSecrets(): Promise<{ count: number; ids: string[] }> {
    const tenantId = this.getTenantId();
    const now = new Date().toISOString();

    const expiredRecords = await this.client.query<SecretRotationRecord>(
      "SELECT * FROM secret_rotations WHERE tenant_id = ? AND status = 'grace_period' AND expires_at IS NOT NULL AND expires_at <= ?;",
      [tenantId, now]
    );

    if (expiredRecords.length === 0) {
      return { count: 0, ids: [] };
    }

    const ids = expiredRecords.map((r) => r.id);
    for (const record of expiredRecords) {
      await this.client.execute(
        "UPDATE secret_rotations SET status = 'revoked', updated_at = ? WHERE id = ? AND tenant_id = ?;",
        [now, record.id, tenantId]
      );
    }

    return { count: ids.length, ids };
  }
}
