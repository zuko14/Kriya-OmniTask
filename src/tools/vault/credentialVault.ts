/**
 * Xylarc AI — Tenant Credential Vault Service
 * Isolated, AES-256-GCM encrypted credential vault for third-party integrations (§8.4 of CLAUDE.md).
 */

import { CredentialRepository } from '../repositories/toolRepository.js';
import { StoreCredentialInput, StoreCredentialSchema } from '../types/toolTypes.js';
import { CryptoUtils } from '../../core/utils/crypto.js';
import { NotFoundError, ValidationError } from '../../core/errors/errors.js';
import { logger } from '../../core/logger/logger.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';

export class CredentialVault {
  private credentialRepo: CredentialRepository;

  constructor(credentialRepo?: CredentialRepository) {
    this.credentialRepo = credentialRepo || new CredentialRepository();
  }

  /**
   * Stores or updates a third-party service credential encrypted at rest via AES-256-GCM.
   */
  public async storeSecret(input: StoreCredentialInput): Promise<{ id: string; serviceSlug: string; name: string }> {
    const validated = StoreCredentialSchema.parse(input);
    const tenantId = TenantContextManager.getTenantId();

    const plaintext = JSON.stringify(validated.secretData);
    const encrypted = CryptoUtils.encrypt(plaintext);

    const record = await this.credentialRepo.saveCredential({
      serviceSlug: validated.serviceSlug,
      name: validated.name,
      encryptedData: encrypted.data,
      iv: encrypted.iv,
      tag: encrypted.tag,
      metadata: validated.metadata,
    });

    logger.info(`Credential stored securely for service '${validated.serviceSlug}' in tenant '${tenantId}'`, {
      tenantId,
      serviceSlug: validated.serviceSlug,
    });

    return {
      id: record.id,
      serviceSlug: record.service_slug,
      name: record.name,
    };
  }

  /**
   * Decrypts and retrieves plaintext secret data into execution runtime memory.
   * NEVER exposed to LLM context or logs.
   */
  public async getSecret<T = Record<string, unknown>>(serviceSlug: string): Promise<T | null> {
    const record = await this.credentialRepo.findByServiceSlug(serviceSlug);
    if (!record) return null;

    try {
      const decryptedJson = CryptoUtils.decrypt({
        data: record.encrypted_data,
        iv: record.iv,
        tag: record.tag,
      });

      return JSON.parse(decryptedJson) as T;
    } catch (err: any) {
      logger.error(`Failed to decrypt credential for service '${serviceSlug}': ${err.message}`);
      throw new ValidationError(`Credential decryption failed for service '${serviceSlug}'.`);
    }
  }

  /**
   * Lists stored credential metadata (keys/secrets redacted).
   */
  public async listServices(): Promise<Array<{ id: string; serviceSlug: string; name: string; createdAt: string; updatedAt: string }>> {
    const records = await this.credentialRepo.listCredentials();
    return records.map((r) => ({
      id: r.id,
      serviceSlug: r.service_slug,
      name: r.name,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  /**
   * Deletes a service credential.
   */
  public async deleteSecret(serviceSlug: string): Promise<boolean> {
    const deleted = await this.credentialRepo.deleteByServiceSlug(serviceSlug);
    if (!deleted) {
      throw new NotFoundError(`Credential for service '${serviceSlug}' not found in active tenant.`);
    }
    return true;
  }
}
