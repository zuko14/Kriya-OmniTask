/**
 * Kriya Omnitask — Business DNA & Roster Moulding Service (§3, §4, §23)
 * Orchestrates DNA profile resolution, agent roster moulding, manifest versioning, and rollback.
 */

import { DnaRepository } from './dnaRepository.js';
import { TenantRepository } from '../../storage/repositories/tenantRepository.js';
import { auditLogger } from '../../security/audit/auditLogger.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import { CryptoUtils } from '../../core/utils/crypto.js';
import { NotFoundError, ValidationError } from '../../core/errors/errors.js';
import {
  DnaProfile,
  DnaAgentSpec,
  TenantRosterManifest,
  SwitchDnaRequest,
  RollbackRosterManifestRequest,
  ResolvedTenantDna,
} from './dnaTypes.js';

export class BusinessDnaService {
  private dnaRepo: DnaRepository;
  private tenantRepo: TenantRepository;

  constructor(dnaRepo?: DnaRepository, tenantRepo?: TenantRepository) {
    this.dnaRepo = dnaRepo || new DnaRepository();
    this.tenantRepo = tenantRepo || new TenantRepository();
  }

  /**
   * Retrieves all available global Business DNA profiles.
   */
  public async listProfiles(activeOnly = true): Promise<DnaProfile[]> {
    return this.dnaRepo.listProfiles(activeOnly);
  }

  /**
   * Retrieves a specific Business DNA profile by ID.
   */
  public async getProfile(profileId: string): Promise<DnaProfile> {
    return this.dnaRepo.getRequiredProfile(profileId);
  }

  /**
   * Moulds a DNA profile into an immutable, versioned Roster Manifest for a tenant (§4).
   */
  public async mouldAndSaveManifest(
    tenantId: string,
    dnaProfileId: string,
    operatorId: string,
    options: {
      optionalAgentIds?: string[];
      autonomyCeiling?: 'L1' | 'L2' | 'L3' | 'L4';
      rolledBackFromVersion?: number;
    } = {}
  ): Promise<TenantRosterManifest> {
    const profile = await this.dnaRepo.getRequiredProfile(dnaProfileId);
    const tenant = await this.tenantRepo.findById(tenantId);
    if (!tenant) {
      throw new NotFoundError(`Tenant '${tenantId}' not found.`);
    }

    const latestVersion = await this.dnaRepo.getLatestVersionNumber(tenantId);
    const nextVersion = latestVersion + 1;
    const now = new Date().toISOString();
    const manifestId = CryptoUtils.generateId();

    // 1. Resolve required agents and activated optional agents
    const optionalAgentSet = new Set(options.optionalAgentIds || []);
    const mouldedAgents: DnaAgentSpec[] = [];

    // Add required agents (always active)
    for (const reqAgent of profile.required_agents) {
      mouldedAgents.push({
        ...reqAgent,
        is_optional: false,
        is_active: true,
        // Apply autonomy ceiling if tenant has stricter autonomy limit
        ceiling_autonomy: this.capAutonomy(reqAgent.ceiling_autonomy, options.autonomyCeiling || (tenant.autonomy_ceiling as any) || 'L2'),
      });
    }

    // Add optional agents
    for (const optAgent of profile.optional_agents) {
      const isEnabled = optionalAgentSet.has(optAgent.id) || optionalAgentSet.has(optAgent.slug);
      mouldedAgents.push({
        ...optAgent,
        is_optional: true,
        is_active: isEnabled,
        ceiling_autonomy: this.capAutonomy(optAgent.ceiling_autonomy, options.autonomyCeiling || (tenant.autonomy_ceiling as any) || 'L2'),
      });
    }

    // 2. Canonical payload for cryptographic checksum
    const canonicalPayload = {
      tenant_id: tenantId,
      version: nextVersion,
      dna_profile_id: profile.id,
      dna_profile_version: profile.version,
      entity_vocabulary: profile.entity_vocabulary,
      capabilities: profile.capabilities,
      lifecycle_stages: profile.lifecycle_model.stages,
      agents: mouldedAgents,
      created_at: now,
    };

    const checksum = CryptoUtils.hashSha256(JSON.stringify(canonicalPayload));

    // 3. Create Tenant Roster Manifest record
    const manifest: TenantRosterManifest = {
      id: manifestId,
      tenant_id: tenantId,
      version: nextVersion,
      dna_profile_id: profile.id,
      dna_profile_version: profile.version,
      entity_vocabulary: profile.entity_vocabulary,
      capabilities: profile.capabilities,
      lifecycle_stages: profile.lifecycle_model.stages,
      agents: mouldedAgents,
      checksum,
      status: 'active',
      created_by: operatorId,
      created_at: now,
      rolled_back_from_version: options.rolledBackFromVersion || null,
    };

    const saved = await this.dnaRepo.saveManifest(manifest);

    // Update tenant's active dna_profile_id
    await this.tenantRepo.updateStatus(tenantId, tenant.status); // keeps integrity
    // direct update to ensure dna_profile_id is persisted
    const dbClient = (this.dnaRepo as any).client;
    await dbClient.execute('UPDATE tenants SET dna_profile_id = ?, updated_at = ? WHERE id = ?;', [
      profile.id,
      now,
      tenantId,
    ]);

    return saved;
  }

  /**
   * Switches a tenant's DNA profile, moulding a new manifest version (§3, §4).
   */
  public async switchTenantDna(
    tenantId: string,
    request: SwitchDnaRequest,
    operatorId: string
  ): Promise<ResolvedTenantDna> {
    const profile = await this.dnaRepo.getRequiredProfile(request.dnaProfileId);
    const tenant = await this.tenantRepo.findById(tenantId);
    if (!tenant) {
      throw new NotFoundError(`Tenant '${tenantId}' not found.`);
    }

    const previousProfileId = tenant.dna_profile_id || 'dna_retail_commerce';

    const manifest = await this.mouldAndSaveManifest(tenantId, request.dnaProfileId, operatorId, {
      optionalAgentIds: request.optionalAgentIds,
      autonomyCeiling: request.autonomyCeiling,
    });

    // Record cryptographic audit event
    await TenantContextManager.withTenant(tenantId, 'default', async () => {
      await auditLogger.logEvent({
        action: 'tenant.dna.switched',
        resourceType: 'tenant',
        resourceId: tenantId,
        details: {
          previousProfileId,
          newProfileId: profile.id,
          manifestVersion: manifest.version,
          manifestChecksum: manifest.checksum,
          operatorId,
          reason: request.reason,
          activeAgentsCount: manifest.agents.filter((a) => a.is_active).length,
          capabilitiesCount: manifest.capabilities.length,
        },
      });
    }, { userId: operatorId, roles: ['system', 'operator'] });

    return this.getTenantDnaResolution(tenantId);
  }

  /**
   * Rolls back a tenant's roster manifest to a prior version (§4, §23).
   */
  public async rollbackRosterManifest(
    tenantId: string,
    request: RollbackRosterManifestRequest,
    operatorId: string
  ): Promise<ResolvedTenantDna> {
    const targetManifest = await this.dnaRepo.getManifestByVersion(tenantId, request.targetVersion);
    if (!targetManifest) {
      throw new NotFoundError(
        `Target manifest version ${request.targetVersion} not found for tenant '${tenantId}'.`
      );
    }

    const activeManifest = await this.dnaRepo.getActiveManifest(tenantId);
    if (activeManifest && activeManifest.version === request.targetVersion) {
      throw new ValidationError(`Tenant '${tenantId}' is already running manifest version ${request.targetVersion}.`);
    }

    // Build rolled-back manifest from historical spec with a new incremental version
    const profile = await this.dnaRepo.getRequiredProfile(targetManifest.dna_profile_id);
    const latestVersion = await this.dnaRepo.getLatestVersionNumber(tenantId);
    const nextVersion = latestVersion + 1;
    const now = new Date().toISOString();
    const manifestId = CryptoUtils.generateId();

    const canonicalPayload = {
      tenant_id: tenantId,
      version: nextVersion,
      dna_profile_id: targetManifest.dna_profile_id,
      dna_profile_version: targetManifest.dna_profile_version,
      entity_vocabulary: targetManifest.entity_vocabulary,
      capabilities: targetManifest.capabilities,
      lifecycle_stages: targetManifest.lifecycle_stages,
      agents: targetManifest.agents,
      rolled_back_from_version: request.targetVersion,
      created_at: now,
    };

    const checksum = CryptoUtils.hashSha256(JSON.stringify(canonicalPayload));

    const rolledBackManifest: TenantRosterManifest = {
      id: manifestId,
      tenant_id: tenantId,
      version: nextVersion,
      dna_profile_id: targetManifest.dna_profile_id,
      dna_profile_version: targetManifest.dna_profile_version,
      entity_vocabulary: targetManifest.entity_vocabulary,
      capabilities: targetManifest.capabilities,
      lifecycle_stages: targetManifest.lifecycle_stages,
      agents: targetManifest.agents,
      checksum,
      status: 'active',
      created_by: operatorId,
      created_at: now,
      rolled_back_from_version: request.targetVersion,
    };

    await this.dnaRepo.saveManifest(rolledBackManifest);

    const dbClient = (this.dnaRepo as any).client;
    await dbClient.execute('UPDATE tenants SET dna_profile_id = ?, updated_at = ? WHERE id = ?;', [
      profile.id,
      now,
      tenantId,
    ]);

    // Record cryptographic audit event
    await TenantContextManager.withTenant(tenantId, 'default', async () => {
      await auditLogger.logEvent({
        action: 'tenant.roster.rolled_back',
        resourceType: 'tenant',
        resourceId: tenantId,
        details: {
          restoredFromVersion: request.targetVersion,
          newManifestVersion: nextVersion,
          dnaProfileId: profile.id,
          operatorId,
          reason: request.reason,
          checksum,
        },
      });
    }, { userId: operatorId, roles: ['system', 'operator'] });

    return this.getTenantDnaResolution(tenantId);
  }

  /**
   * Retrieves the fully resolved DNA, active manifest, vocabulary, and agent roster for a tenant.
   */
  public async getTenantDnaResolution(tenantId: string): Promise<ResolvedTenantDna> {
    const tenant = await this.tenantRepo.findById(tenantId);
    if (!tenant) {
      throw new NotFoundError(`Tenant '${tenantId}' not found.`);
    }

    let activeManifest = await this.dnaRepo.getActiveManifest(tenantId);
    const dnaProfileId = tenant.dna_profile_id || 'dna_retail_commerce';

    // Auto-mould manifest v1 if not yet created
    if (!activeManifest) {
      activeManifest = await this.mouldAndSaveManifest(tenantId, dnaProfileId, 'system_auto_mould');
    }

    const dnaProfile = await this.dnaRepo.getRequiredProfile(activeManifest.dna_profile_id);

    return {
      tenantId,
      activeManifest,
      dnaProfile,
      vocabulary: activeManifest.entity_vocabulary,
      capabilities: activeManifest.capabilities,
      lifecycleStages: activeManifest.lifecycle_stages,
      agents: activeManifest.agents,
      kpis: dnaProfile.default_kpis,
    };
  }

  /**
   * Lists the full manifest version history for a tenant (§4).
   */
  public async listManifestHistory(tenantId: string): Promise<TenantRosterManifest[]> {
    return this.dnaRepo.listManifestHistory(tenantId);
  }

  /**
   * Checks whether a tenant's active DNA enables a specific capability flag.
   */
  public async hasCapability(tenantId: string, capability: string): Promise<boolean> {
    const resolution = await this.getTenantDnaResolution(tenantId);
    return resolution.capabilities.includes(capability);
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  private capAutonomy(agentCeiling: string, tenantCeiling: string): 'L1' | 'L2' | 'L3' | 'L4' {
    const levels = { L1: 1, L2: 2, L3: 3, L4: 4 };
    const agentVal = levels[agentCeiling as keyof typeof levels] || 2;
    const tenantVal = levels[tenantCeiling as keyof typeof levels] || 2;
    const capped = Math.min(agentVal, tenantVal);
    return (`L${capped}` as 'L1' | 'L2' | 'L3' | 'L4');
  }
}
