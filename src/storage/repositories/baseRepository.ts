/**
 * Kriya AI — Tenant-Scoped Base Repository
 * Enforces automatic tenant boundary filtering on all read/write/delete operations.
 */

import { DatabaseClient, db } from '../db.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import { TenantIsolationError, NotFoundError } from '../../core/errors/errors.js';
import { CryptoUtils } from '../../core/utils/crypto.js';

export interface BaseEntity {
  id: string;
  tenant_id: string;
  created_at: string;
  updated_at: string;
}

export abstract class BaseRepository<T extends BaseEntity> {
  protected abstract readonly tableName: string;
  protected customClient?: DatabaseClient;

  constructor(client?: DatabaseClient) {
    this.customClient = client;
  }

  protected get client(): DatabaseClient {
    return this.customClient || db.getClient();
  }

  /**
   * Retrieves an entity by ID, strictly filtered by the active tenant context.
   */
  public async findById(id: string): Promise<T | null> {
    const tenantId = this.getTenantId();
    const sql = `SELECT * FROM ${this.tableName} WHERE id = ? AND tenant_id = ?;`;
    return this.client.queryOne<T>(sql, [id, tenantId]);
  }

  /**
   * Retrieves an entity by ID or throws NotFoundError.
   */
  public async getById(id: string): Promise<T> {
    const entity = await this.findById(id);
    if (!entity) {
      throw new NotFoundError(`Resource in ${this.tableName} with ID ${id} not found.`);
    }
    return entity;
  }

  /**
   * Retrieves all entities belonging to the active tenant with optional column filters.
   */
  public async findAll(filters: Record<string, unknown> = {}): Promise<T[]> {
    const tenantId = this.getTenantId();
    const whereClauses = ['tenant_id = ?'];
    const params: unknown[] = [tenantId];

    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && key !== 'tenant_id') {
        whereClauses.push(`${key} = ?`);
        params.push(value);
      }
    }

    const sql = `SELECT * FROM ${this.tableName} WHERE ${whereClauses.join(' AND ')} ORDER BY created_at DESC;`;
    return this.client.query<T>(sql, params);
  }

  /**
   * Creates a new entity belonging to the active tenant.
   */
  public async create(data: Omit<T, 'id' | 'tenant_id' | 'created_at' | 'updated_at'> & Partial<BaseEntity>): Promise<T> {
    const tenantId = this.getTenantId();
    const now = new Date().toISOString();
    const id = data.id || CryptoUtils.generateId();

    const record: Record<string, unknown> = {
      ...data,
      id,
      tenant_id: tenantId,
      created_at: now,
      updated_at: now,
    };

    const columns = Object.keys(record);
    const placeholders = columns.map(() => '?').join(', ');
    const values = Object.values(record).map((v) => (v === undefined ? null : v));

    const sql = `INSERT INTO ${this.tableName} (${columns.join(', ')}) VALUES (${placeholders});`;
    await this.client.execute(sql, values);

    return record as unknown as T;
  }

  /**
   * Updates an entity by ID, verifying tenant boundary ownership.
   */
  public async update(id: string, updates: Partial<Omit<T, 'id' | 'tenant_id' | 'created_at'>>): Promise<T> {
    const tenantId = this.getTenantId();
    const existing = await this.findById(id);
    if (!existing) {
      throw new NotFoundError(`Cannot update: Resource ${id} in ${this.tableName} not found.`);
    }

    const now = new Date().toISOString();
    const updateData: Record<string, unknown> = {
      ...updates,
      updated_at: now,
    };

    delete updateData.id;
    delete updateData.tenant_id;
    delete updateData.created_at;

    const setClauses: string[] = [];
    const params: unknown[] = [];

    for (const [key, val] of Object.entries(updateData)) {
      setClauses.push(`${key} = ?`);
      params.push(val === undefined ? null : val);
    }

    if (setClauses.length === 0) {
      return existing;
    }

    params.push(id, tenantId);
    const sql = `UPDATE ${this.tableName} SET ${setClauses.join(', ')} WHERE id = ? AND tenant_id = ?;`;
    await this.client.execute(sql, params);

    return (await this.findById(id))!;
  }

  /**
   * Deletes an entity by ID, strictly within tenant boundaries.
   */
  public async delete(id: string): Promise<boolean> {
    const tenantId = this.getTenantId();
    const sql = `DELETE FROM ${this.tableName} WHERE id = ? AND tenant_id = ?;`;
    const result = await this.client.execute(sql, [id, tenantId]);
    return result.changes > 0;
  }

  /**
   * Counts entities for the active tenant.
   */
  public async count(filters: Record<string, unknown> = {}): Promise<number> {
    const tenantId = this.getTenantId();
    const whereClauses = ['tenant_id = ?'];
    const params: unknown[] = [tenantId];

    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && key !== 'tenant_id') {
        whereClauses.push(`${key} = ?`);
        params.push(value);
      }
    }

    const sql = `SELECT COUNT(*) as total FROM ${this.tableName} WHERE ${whereClauses.join(' AND ')};`;
    const result = await this.client.queryOne<{ total: number }>(sql, params);
    return result ? Number(result.total) : 0;
  }

  protected getTenantId(): string {
    const ctx = TenantContextManager.getRequired();
    if (!ctx.tenantId) {
      throw new TenantIsolationError('Tenant ID missing from active execution context.');
    }
    return ctx.tenantId;
  }
}
