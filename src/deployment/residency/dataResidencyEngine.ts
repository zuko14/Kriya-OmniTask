/**
 * Kriya AI — India Data Residency & Sovereign Hosting Governance Engine
 * Implements strict compliance with India DPDP Act 2023 data localization guidelines,
 * regional boundary validation, and India hosting infrastructure blueprints (§30 of CLAUDE.md).
 */

import { CryptoUtils } from '../../core/utils/crypto.js';
import { DeploymentRepository } from '../repositories/deploymentRepository.js';
import {
  DataResidencyConfig,
  UpsertDataResidencyInput,
  HostingRegion,
  ResidencyJurisdiction,
} from '../types/deploymentTypes.js';
import { ValidationError, ForbiddenError } from '../../core/errors/errors.js';
import { logger } from '../../core/logger/logger.js';

export interface ResidencyValidationResult {
  valid: boolean;
  tenantId: string;
  jurisdiction: ResidencyJurisdiction;
  primaryRegion: HostingRegion;
  reason?: string;
}

export interface IndiaHostingBlueprint {
  product: string;
  jurisdiction: string;
  regulatoryStandard: string;
  primaryRegion: {
    code: string;
    location: string;
    provider: string;
    availabilityZones: string[];
  };
  disasterRecoveryRegion: {
    code: string;
    location: string;
    provider: string;
    rpoMinutes: number;
    rtoMinutes: number;
  };
  storageLocalization: {
    database: string;
    encryptionAtRest: string;
    kmsRegion: string;
    immutableObjectStore: string;
  };
  networkIngress: {
    edgePops: string[];
    sslTlsCipherSuite: string;
    ddosProtection: string;
  };
  inferenceGovernance: {
    defaultInferenceRegion: string;
    crossBorderTransferConsentEnforced: boolean;
    piiScrubbingMandatory: boolean;
  };
}

export class DataResidencyEngine {
  constructor(private repo: DeploymentRepository) {}

  /**
   * Upserts a tenant's data residency and hosting configuration.
   */
  public async upsertResidencyConfig(
    tenantId: string,
    input: UpsertDataResidencyInput
  ): Promise<DataResidencyConfig> {
    const existing = await this.repo.getDataResidencyConfig(tenantId);
    const now = new Date().toISOString();

    const config: DataResidencyConfig = {
      id: existing?.id ?? `res_${CryptoUtils.generateId()}`,
      tenantId,
      jurisdiction: input.jurisdiction,
      primaryRegion: input.primaryRegion as HostingRegion,
      allowedRegions: input.allowedRegions,
      strictDataLocalization: input.strictDataLocalization,
      crossBorderTransferPermitted: input.crossBorderTransferPermitted,
      approvedLlmInferenceRegions: input.approvedLlmInferenceRegions,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    await this.repo.saveDataResidencyConfig(config);
    logger.info(`Updated data residency configuration for tenant '${tenantId}' (Jurisdiction: ${config.jurisdiction}, Region: ${config.primaryRegion})`);
    return config;
  }

  /**
   * Retrieves data residency config for a tenant, returning strict India default if unset.
   */
  public async getResidencyConfig(tenantId: string): Promise<DataResidencyConfig> {
    const config = await this.repo.getDataResidencyConfig(tenantId);
    if (config) return config;

    // Default: Strict India DPDP 2023 compliance
    return {
      id: `default_${tenantId}`,
      tenantId,
      jurisdiction: 'IN_DPDP_2023',
      primaryRegion: 'ap-south-1',
      allowedRegions: ['ap-south-1', 'ap-south-2'],
      strictDataLocalization: true,
      crossBorderTransferPermitted: false,
      approvedLlmInferenceRegions: ['ap-south-1', 'ap-south-2'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Validates whether a proposed regional operation (storage or LLM inference) complies with the tenant's residency constraints.
   */
  public async validateOperation(
    tenantId: string,
    targetRegion: string,
    isLlmInference: boolean = false,
    crossBorderTransfer: boolean = false
  ): Promise<ResidencyValidationResult> {
    const config = await this.getResidencyConfig(tenantId);

    // 1. Strict localization check: Cross-border transfer prohibited without explicit permission
    if (config.strictDataLocalization && crossBorderTransfer && !config.crossBorderTransferPermitted) {
      return {
        valid: false,
        tenantId,
        jurisdiction: config.jurisdiction,
        primaryRegion: config.primaryRegion,
        reason: `Cross-border data transfer prohibited: Tenant '${tenantId}' is governed by strict ${config.jurisdiction} data localization mandates.`,
      };
    }

    // 2. LLM Inference region check
    if (isLlmInference) {
      const isApprovedInference = config.approvedLlmInferenceRegions.includes(targetRegion);
      if (!isApprovedInference) {
        return {
          valid: false,
          tenantId,
          jurisdiction: config.jurisdiction,
          primaryRegion: config.primaryRegion,
          reason: `Model inference region '${targetRegion}' is not in the approved inference regions [${config.approvedLlmInferenceRegions.join(', ')}] for tenant '${tenantId}'.`,
        };
      }
    } else {
      // 3. General storage/compute region check
      const isAllowedRegion = config.allowedRegions.includes(targetRegion);
      if (!isAllowedRegion) {
        return {
          valid: false,
          tenantId,
          jurisdiction: config.jurisdiction,
          primaryRegion: config.primaryRegion,
          reason: `Target hosting region '${targetRegion}' is not in the approved regions [${config.allowedRegions.join(', ')}] for tenant '${tenantId}'.`,
        };
      }
    }

    return {
      valid: true,
      tenantId,
      jurisdiction: config.jurisdiction,
      primaryRegion: config.primaryRegion,
    };
  }

  /**
   * Returns the canonical India-region production hosting architecture blueprint.
   */
  public static getIndiaHostingBlueprint(): IndiaHostingBlueprint {
    return {
      product: 'Kriya Omnitask',
      jurisdiction: 'Republic of India',
      regulatoryStandard: 'Digital Personal Data Protection Act, 2023 (DPDP 2023)',
      primaryRegion: {
        code: 'ap-south-1',
        location: 'Mumbai, Maharashtra, India',
        provider: 'AWS / Sovereign Indian Cloud Partner',
        availabilityZones: ['ap-south-1a', 'ap-south-1b', 'ap-south-1c'],
      },
      disasterRecoveryRegion: {
        code: 'ap-south-2',
        location: 'Hyderabad, Telangana, India',
        provider: 'AWS / Sovereign Indian Cloud Partner',
        rpoMinutes: 5,
        rtoMinutes: 15,
      },
      storageLocalization: {
        database: 'Managed PostgreSQL Multi-AZ with synchronous replication within ap-south-1',
        encryptionAtRest: 'AES-256-GCM with customer-managed KMS key in ap-south-1',
        kmsRegion: 'ap-south-1',
        immutableObjectStore: 'Encrypted sovereign S3 buckets with WORM compliance in Mumbai',
      },
      networkIngress: {
        edgePops: ['Mumbai', 'New Delhi', 'Chennai', 'Bengaluru', 'Kolkata'],
        sslTlsCipherSuite: 'TLS_AES_256_GCM_SHA384 (TLS 1.3 Strict)',
        ddosProtection: 'Automated Tier-1 volumetric and layer-7 protection',
      },
      inferenceGovernance: {
        defaultInferenceRegion: 'ap-south-1',
        crossBorderTransferConsentEnforced: true,
        piiScrubbingMandatory: true,
      },
    };
  }
}
