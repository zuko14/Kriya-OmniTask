/**
 * Xylarc AI — Organization & Workspace Repository
 * Manages customer commercial organizations and operational workspace scopes.
 */

import { BaseRepository, BaseEntity } from './baseRepository.js';
import { DatabaseClient } from '../db.js';

export interface OrganizationRecord extends BaseEntity {
  name: string;
  slug: string;
}

export interface WorkspaceRecord extends BaseEntity {
  organization_id: string;
  name: string;
  slug: string;
}

export class OrganizationRepository extends BaseRepository<OrganizationRecord> {
  protected readonly tableName = 'organizations';

  public async findBySlug(slug: string): Promise<OrganizationRecord | null> {
    const tenantId = this.getTenantId();
    return this.client.queryOne<OrganizationRecord>(
      'SELECT * FROM organizations WHERE slug = ? AND tenant_id = ?;',
      [slug, tenantId]
    );
  }
}

export class WorkspaceRepository extends BaseRepository<WorkspaceRecord> {
  protected readonly tableName = 'workspaces';

  public async findByOrgAndSlug(orgId: string, slug: string): Promise<WorkspaceRecord | null> {
    const tenantId = this.getTenantId();
    return this.client.queryOne<WorkspaceRecord>(
      'SELECT * FROM workspaces WHERE organization_id = ? AND slug = ? AND tenant_id = ?;',
      [orgId, slug, tenantId]
    );
  }

  public async findByOrg(orgId: string): Promise<WorkspaceRecord[]> {
    const tenantId = this.getTenantId();
    return this.client.query<WorkspaceRecord>(
      'SELECT * FROM workspaces WHERE organization_id = ? AND tenant_id = ? ORDER BY name ASC;',
      [orgId, tenantId]
    );
  }
}
