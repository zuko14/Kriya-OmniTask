/**
 * Xylarc AI — Enterprise Governance Service
 * High-level orchestration for org units, ABAC evaluations, SSO auth, and compliance retention purging.
 */

import { GovernanceRepository } from '../repositories/governanceRepository.js';
import { OrganizationHierarchyEngine } from '../org/organizationHierarchyEngine.js';
import { AbacPolicyEvaluator } from '../abac/abacPolicyEvaluator.js';
import { EnterpriseSsoAdapter, SsoAuthResult } from '../sso/enterpriseSsoAdapter.js';
import { DataRetentionPurgePlanner } from '../retention/dataRetentionPurgePlanner.js';
import {
  CreateOrgUnitRequest,
  OrganizationUnit,
  UpsertSsoConfigRequest,
  EnterpriseSsoConfig,
  SsoExchangeRequest,
  SsoProviderType,
  AbacEvaluationRequest,
  AbacEvaluationResult,
  UpsertRetentionPolicyRequest,
  DataRetentionPolicy,
  GovernancePurgeAudit,
} from '../types/governanceTypes.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import { CryptoUtils } from '../../core/utils/crypto.js';

export class GovernanceService {
  private repo = new GovernanceRepository();

  public async createOrgUnit(request: CreateOrgUnitRequest): Promise<OrganizationUnit> {
    const tenantId = TenantContextManager.getTenantId();
    const existingUnits = await this.repo.listOrgUnits(tenantId);

    if (request.parentUnitId) {
      const wouldCycle = OrganizationHierarchyEngine.wouldCreateCycle(
        existingUnits,
        'new_unit',
        request.parentUnitId
      );
      if (wouldCycle) {
        throw new Error(`Circular hierarchy detected when linking parent unit '${request.parentUnitId}'.`);
      }
    }

    const now = new Date().toISOString();
    const unit: OrganizationUnit = {
      id: `unit_${CryptoUtils.generateId()}`,
      tenantId,
      parentUnitId: request.parentUnitId,
      name: request.name,
      code: request.code,
      unitType: request.unitType,
      leadUserId: request.leadUserId,
      metadata: request.metadata || {},
      createdAt: now,
      updatedAt: now,
    };

    await this.repo.createOrgUnit(unit);
    return unit;
  }

  public async listOrgUnits(): Promise<OrganizationUnit[]> {
    const tenantId = TenantContextManager.getTenantId();
    return this.repo.listOrgUnits(tenantId);
  }

  public async getOrgHierarchyTree(): Promise<OrganizationUnit[]> {
    const tenantId = TenantContextManager.getTenantId();
    const units = await this.repo.listOrgUnits(tenantId);
    return OrganizationHierarchyEngine.buildHierarchyTree(units);
  }

  public async upsertSsoConfig(request: UpsertSsoConfigRequest): Promise<EnterpriseSsoConfig> {
    const tenantId = TenantContextManager.getTenantId();
    const now = new Date().toISOString();
    const encryptedSecret = JSON.stringify(CryptoUtils.encrypt(request.clientSecret));

    const config: EnterpriseSsoConfig = {
      id: `sso_${CryptoUtils.generateId()}`,
      tenantId,
      providerType: request.providerType,
      issuerUrl: request.issuerUrl,
      clientId: request.clientId,
      claimsMapping: request.claimsMapping || {},
      enforceSso: request.enforceSso || false,
      isActive: request.isActive !== undefined ? request.isActive : true,
      createdAt: now,
      updatedAt: now,
    };

    await this.repo.upsertSsoConfig(config, encryptedSecret);
    return config;
  }

  public async getSsoConfig(providerType: SsoProviderType): Promise<EnterpriseSsoConfig | null> {
    const tenantId = TenantContextManager.getTenantId();
    return this.repo.getSsoConfig(tenantId, providerType);
  }

  public async exchangeSsoToken(request: SsoExchangeRequest): Promise<SsoAuthResult> {
    const tenantId = TenantContextManager.getTenantId();
    const config = await this.repo.getSsoConfig(tenantId, request.providerType);
    if (!config) {
      throw new Error(`SSO configuration not found for provider '${request.providerType}'.`);
    }

    return EnterpriseSsoAdapter.exchangeIdpToken(config, request);
  }

  public async evaluateAbac(request: AbacEvaluationRequest): Promise<AbacEvaluationResult> {
    const tenantId = TenantContextManager.getTenantId();
    let accessibleUnitIds: string[] | undefined;

    if (request.subject.unitId) {
      const units = await this.repo.listOrgUnits(tenantId);
      accessibleUnitIds = OrganizationHierarchyEngine.getSubtreeUnitIds(units, request.subject.unitId);
    }

    return AbacPolicyEvaluator.evaluate(request, accessibleUnitIds);
  }

  public async upsertRetentionPolicy(request: UpsertRetentionPolicyRequest): Promise<DataRetentionPolicy> {
    const tenantId = TenantContextManager.getTenantId();
    const now = new Date().toISOString();

    const policy: DataRetentionPolicy = {
      id: `ret_${CryptoUtils.generateId()}`,
      tenantId,
      dataClassification: request.dataClassification,
      targetResourceType: request.targetResourceType,
      retentionDays: request.retentionDays,
      purgeAction: request.purgeAction || 'hard_delete',
      isActive: request.isActive !== undefined ? request.isActive : true,
      createdAt: now,
      updatedAt: now,
    };

    await this.repo.upsertRetentionPolicy(policy);
    return policy;
  }

  public async listRetentionPolicies(): Promise<DataRetentionPolicy[]> {
    const tenantId = TenantContextManager.getTenantId();
    return this.repo.listRetentionPolicies(tenantId);
  }

  public async executeRetentionPurgeSimulation(): Promise<GovernancePurgeAudit[]> {
    const tenantId = TenantContextManager.getTenantId();
    const policies = await this.repo.listRetentionPolicies(tenantId);
    const audits: GovernancePurgeAudit[] = [];

    for (const policy of policies.filter((p) => p.isActive)) {
      // Simulate purge evaluation
      const audit = DataRetentionPurgePlanner.createPurgeAudit(
        tenantId,
        policy,
        15, // Evaluated simulated records
        5,  // Identified out-of-retention records
        'completed'
      );
      await this.repo.insertPurgeAudit(audit);
      audits.push(audit);
    }

    return audits;
  }

  public async listPurgeAudits(limit = 50): Promise<GovernancePurgeAudit[]> {
    const tenantId = TenantContextManager.getTenantId();
    return this.repo.listPurgeAudits(tenantId, limit);
  }
}
