/**
 * Xylarc AI — Digital Twin Entities & Relationships Repository
 * Relational storage for organizational context nodes and adjacency edges (§13 of CLAUDE.md).
 */

import { BaseRepository } from '../../storage/repositories/baseRepository.js';
import { DatabaseClient } from '../../storage/db.js';
import {
  DigitalTwinEntityRecord,
  DigitalTwinRelationshipRecord,
  CreateEntityRequest,
  CreateRelationshipRequest,
} from '../types/digitalTwinTypes.js';
import { CryptoUtils } from '../../core/utils/crypto.js';

export class DigitalTwinRepository extends BaseRepository<DigitalTwinEntityRecord> {
  protected readonly tableName = 'digital_twin_entities';

  constructor(client?: DatabaseClient) {
    super(client);
  }

  /**
   * Creates a new Digital Twin entity (Department, Location, Product, Service, etc.).
   */
  public async createEntity(data: CreateEntityRequest): Promise<DigitalTwinEntityRecord> {
    const tenantId = this.getTenantId();
    const id = CryptoUtils.generateId();
    const now = new Date().toISOString();

    const record: DigitalTwinEntityRecord = {
      id,
      tenant_id: tenantId,
      organization_id: 'default',
      entity_type: data.entityType,
      name: data.name,
      slug: data.slug,
      description: data.description,
      parent_entity_id: data.parentEntityId,
      properties_json: JSON.stringify(data.properties || {}),
      status: data.status || 'active',
      created_at: now,
      updated_at: now,
    };

    await this.client.execute(
      `INSERT INTO digital_twin_entities (
        id, tenant_id, organization_id, entity_type, name, slug, description,
        parent_entity_id, properties_json, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        record.id,
        record.tenant_id,
        record.organization_id,
        record.entity_type,
        record.name,
        record.slug,
        record.description || null,
        record.parent_entity_id || null,
        record.properties_json,
        record.status,
        record.created_at,
        record.updated_at,
      ]
    );

    return record;
  }

  /**
   * Creates a typed relationship edge between two entities.
   */
  public async createRelationship(data: CreateRelationshipRequest): Promise<DigitalTwinRelationshipRecord> {
    const tenantId = this.getTenantId();
    const id = CryptoUtils.generateId();
    const now = new Date().toISOString();

    const record: DigitalTwinRelationshipRecord = {
      id,
      tenant_id: tenantId,
      source_entity_id: data.sourceEntityId,
      target_entity_id: data.targetEntityId,
      relationship_type: data.relationshipType,
      properties_json: JSON.stringify(data.properties || {}),
      created_at: now,
      updated_at: now,
    };

    await this.client.execute(
      `INSERT INTO digital_twin_relationships (
        id, tenant_id, source_entity_id, target_entity_id, relationship_type, properties_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?);`,
      [
        record.id,
        record.tenant_id,
        record.source_entity_id,
        record.target_entity_id,
        record.relationship_type,
        record.properties_json,
        record.created_at,
      ]
    );

    return record;
  }

  /**
   * Retrieves all entities for the tenant.
   */
  public async listEntities(): Promise<DigitalTwinEntityRecord[]> {
    const tenantId = this.getTenantId();
    return this.client.query<DigitalTwinEntityRecord>(
      'SELECT * FROM digital_twin_entities WHERE tenant_id = ? ORDER BY created_at ASC;',
      [tenantId]
    );
  }

  /**
   * Retrieves all relationships for the tenant.
   */
  public async listRelationships(): Promise<DigitalTwinRelationshipRecord[]> {
    const tenantId = this.getTenantId();
    return this.client.query<DigitalTwinRelationshipRecord>(
      'SELECT * FROM digital_twin_relationships WHERE tenant_id = ? ORDER BY created_at ASC;',
      [tenantId]
    );
  }
}
