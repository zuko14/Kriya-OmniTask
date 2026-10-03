/**
 * Kriya AI — API Versioning & Contract-Locked Gate Manager
 * Enforces contract-locked frontend/backend releases, client version compatibility,
 * and RFC 8594 deprecation/sunset governance (§32 of CLAUDE.md).
 */

import { CryptoUtils } from '../../core/utils/crypto.js';
import { DeploymentRepository } from '../repositories/deploymentRepository.js';
import {
  ApiVersionRegistration,
  RegisterApiVersionInput,
} from '../types/deploymentTypes.js';
import { ValidationError, NotFoundError } from '../../core/errors/errors.js';
import { logger } from '../../core/logger/logger.js';

export interface VersionNegotiationResult {
  allowed: boolean;
  apiVersion: string;
  statusCode?: number;
  errorMessage?: string;
  headers?: Record<string, string>;
}

export class ApiVersionManager {
  constructor(private repo: DeploymentRepository) {}

  /**
   * Simple, reliable semver comparison utility (major.minor.patch).
   * Returns:
   *  1 if a > b
   * -1 if a < b
   *  0 if a === b
   */
  public static compareSemver(a: string, b: string): number {
    const cleanA = a.replace(/^v/, '').split('-')[0];
    const cleanB = b.replace(/^v/, '').split('-')[0];

    const partsA = cleanA.split('.').map((n) => parseInt(n, 10) || 0);
    const partsB = cleanB.split('.').map((n) => parseInt(n, 10) || 0);

    const len = Math.max(partsA.length, partsB.length, 3);
    for (let i = 0; i < len; i++) {
      const valA = partsA[i] ?? 0;
      const valB = partsB[i] ?? 0;
      if (valA > valB) return 1;
      if (valA < valB) return -1;
    }
    return 0;
  }

  /**
   * Registers or updates an API version with contract-locked minimum client constraints.
   */
  public async registerApiVersion(input: RegisterApiVersionInput): Promise<ApiVersionRegistration> {
    const existing = await this.repo.getApiVersion(input.apiVersion);
    const now = new Date().toISOString();

    const record: ApiVersionRegistration = {
      id: existing?.id ?? `apiver_${CryptoUtils.generateId()}`,
      apiVersion: input.apiVersion,
      status: input.status,
      minSupportedClientVersion: input.minSupportedClientVersion,
      deprecatedAt: input.deprecatedAt ?? existing?.deprecatedAt,
      sunsetAt: input.sunsetAt ?? existing?.sunsetAt,
      notes: input.notes ?? existing?.notes,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    await this.repo.saveApiVersion(record);
    logger.info(`Registered API version '${record.apiVersion}' (Status: ${record.status}, MinClient: ${record.minSupportedClientVersion})`);
    return record;
  }

  /**
   * Evaluates incoming request headers and route parameters against versioning and contract locks.
   */
  public async validateClientContract(
    apiVersion: string,
    clientVersionHeader?: string
  ): Promise<VersionNegotiationResult> {
    const reg = await this.repo.getApiVersion(apiVersion);
    if (!reg) {
      // Default to allowed for baseline unconfigured paths (e.g. /api/v1 default)
      return {
        allowed: true,
        apiVersion,
        headers: {},
      };
    }

    const headers: Record<string, string> = {};

    // 1. Check if the version has been sunset (HTTP 410 Gone)
    if (reg.status === 'sunset' || (reg.sunsetAt && new Date(reg.sunsetAt).getTime() <= Date.now())) {
      return {
        allowed: false,
        apiVersion,
        statusCode: 410,
        errorMessage: `API version '${apiVersion}' has been sunset and is no longer available. Please migrate to the current release.`,
        headers: {
          'Deprecation': 'true',
          'Sunset': reg.sunsetAt ? new Date(reg.sunsetAt).toUTCString() : new Date().toUTCString(),
        },
      };
    }

    // 2. Check if the version is deprecated (add RFC 8594 headers)
    if (reg.status === 'deprecated') {
      headers['Deprecation'] = 'true';
      if (reg.sunsetAt) {
        headers['Sunset'] = new Date(reg.sunsetAt).toUTCString();
      }
    }

    // 3. Contract locking: Check client version against minimum supported version
    if (clientVersionHeader) {
      const cmp = ApiVersionManager.compareSemver(clientVersionHeader, reg.minSupportedClientVersion);
      if (cmp < 0) {
        return {
          allowed: false,
          apiVersion,
          statusCode: 426, // 426 Upgrade Required
          errorMessage: `Client version '${clientVersionHeader}' is obsolete for API '${apiVersion}'. Minimum required client version is '${reg.minSupportedClientVersion}'. Please refresh or upgrade.`,
          headers,
        };
      }
    }

    return {
      allowed: true,
      apiVersion,
      headers,
    };
  }

  public async listVersions(status?: string): Promise<ApiVersionRegistration[]> {
    return this.repo.listApiVersions(status);
  }
}
