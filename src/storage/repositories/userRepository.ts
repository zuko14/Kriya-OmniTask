/**
 * Xylarc AI — User & Role Repository
 * Manages user accounts, password authentication, and role assignments with tenant boundaries.
 */

import { BaseRepository, BaseEntity } from './baseRepository.js';
import { CryptoUtils } from '../../core/utils/crypto.js';

export interface UserRecord extends BaseEntity {
  email: string;
  password_hash: string;
  full_name: string;
  status: 'active' | 'inactive' | 'locked';
}

export interface RoleRecord extends BaseEntity {
  name: string;
  description?: string;
  permissions_json: string;
  is_system: number;
}

export class UserRepository extends BaseRepository<UserRecord> {
  protected readonly tableName = 'users';

  public async findByEmail(email: string): Promise<UserRecord | null> {
    const tenantId = this.getTenantId();
    return this.client.queryOne<UserRecord>(
      'SELECT * FROM users WHERE email = ? AND tenant_id = ?;',
      [email.toLowerCase().trim(), tenantId]
    );
  }

  public async createWithPassword(data: {
    email: string;
    password: string;
    full_name: string;
    id?: string;
  }): Promise<Omit<UserRecord, 'password_hash'>> {
    const password_hash = CryptoUtils.hashPassword(data.password);
    const created = await this.create({
      id: data.id,
      email: data.email.toLowerCase().trim(),
      password_hash,
      full_name: data.full_name,
      status: 'active',
    });

    const { password_hash: _, ...safeUser } = created;
    return safeUser;
  }

  public async assignRole(userId: string, roleId: string): Promise<void> {
    const tenantId = this.getTenantId();
    const now = new Date().toISOString();
    await this.client.execute(
      `INSERT INTO user_roles (user_id, role_id, tenant_id, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, role_id) DO NOTHING;`,
      [userId, roleId, tenantId, now]
    );
  }

  public async findRoleByName(roleName: string): Promise<RoleRecord | null> {
    const tenantId = this.getTenantId();
    return this.client.queryOne<RoleRecord>(
      'SELECT * FROM roles WHERE name = ? AND (tenant_id = ? OR tenant_id = ? OR is_system = 1);',
      [roleName, tenantId, 'system']
    );
  }

  public async assignRoleByName(userId: string, roleName: string): Promise<void> {
    let role = await this.findRoleByName(roleName);
    if (!role) {
      const roleId = `role-${roleName}-${CryptoUtils.generateSecureToken(4)}`;
      const now = new Date().toISOString();
      await this.client.execute(
        `INSERT INTO roles (id, tenant_id, name, description, permissions_json, is_system, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
        [roleId, this.getTenantId(), roleName, `${roleName} role`, '[]', 0, now, now]
      );
      role = { id: roleId, tenant_id: this.getTenantId(), name: roleName, permissions_json: '[]', is_system: 0, created_at: now, updated_at: now };
    }
    await this.assignRole(userId, role.id);
  }

  public async getUserRoles(userId: string): Promise<RoleRecord[]> {
    const tenantId = this.getTenantId();
    const sql = `
      SELECT r.* FROM roles r
      INNER JOIN user_roles ur ON ur.role_id = r.id
      WHERE ur.user_id = ? AND ur.tenant_id = ?;
    `;
    return this.client.query<RoleRecord>(sql, [userId, tenantId]);
  }
}
