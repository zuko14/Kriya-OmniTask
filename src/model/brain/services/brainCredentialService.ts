import { CredentialVault } from '../../../tools/vault/credentialVault.js';
import { BrainSupplyRepository } from '../repositories/brainSupplyRepository.js';
import { TenantBrainRecord } from '../types/brainSupplyTypes.js';
import { auditLogger } from '../../../security/audit/auditLogger.js';
import { TenantContextManager } from '../../../core/context/tenantContext.js';
import { ValidationError } from '../../../core/errors/errors.js';
import { logger } from '../../../core/logger/logger.js';
import { config } from '../../../core/config/config.js';
import type { FetchFn } from '../../gateway/openRouterAdapter.js';

export interface KeyValidationResult {
  valid: boolean;
  provider: string;
  keyLastFour: string;
  errorMessage?: string;
}

/** Providers whose keys can be verified AND used for execution today (decision D2: OpenRouter). */
export const SUPPORTED_BRAIN_KEY_PROVIDERS = ['openrouter'] as const;

export class BrainCredentialService {
  private vault: CredentialVault;
  private brainRepo: BrainSupplyRepository;
  private fetchFn: FetchFn;

  constructor(
    vault: CredentialVault = new CredentialVault(),
    brainRepo: BrainSupplyRepository = new BrainSupplyRepository(),
    fetchFn: FetchFn = (url, init) => fetch(url, init)
  ) {
    this.fetchFn = fetchFn;
    this.vault = vault;
    this.brainRepo = brainRepo;
  }

  /**
   * Validates a provider API key via handshake (§9.8, §18.6.2 Step 1).
   * A key failing validation is NEVER saved.
   */
  public async validateKey(provider: string, apiKey: string): Promise<KeyValidationResult> {
    if (!apiKey || apiKey.trim().length < 8) {
      return {
        valid: false,
        provider,
        keyLastFour: '',
        errorMessage: 'Invalid API key format: Key is too short or empty.',
      };
    }

    const cleanKey = apiKey.trim();
    const keyLastFour = cleanKey.slice(-4);

    // Only keys we can both verify and execute with are accepted (docs/kriya S28).
    if (!(SUPPORTED_BRAIN_KEY_PROVIDERS as readonly string[]).includes(provider)) {
      return {
        valid: false,
        provider,
        keyLastFour,
        errorMessage: `Provider '${provider}' keys are not supported yet. Use an OpenRouter key (it reaches Anthropic, OpenAI, Google, DeepSeek and more).`,
      };
    }

    // Real handshake: OpenRouter's key-info endpoint answers 200 for a live key, 401/403 otherwise.
    const base = (config.get('OPENROUTER_BASE_URL') ?? 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
    let status: number;
    try {
      const res = await this.fetchFn(`${base}/key`, {
        headers: { Authorization: `Bearer ${cleanKey}` },
        signal: AbortSignal.timeout(10_000),
      });
      status = res.status;
    } catch (err) {
      return {
        valid: false,
        provider,
        keyLastFour,
        errorMessage: `Could not reach '${provider}' to verify the key (${err instanceof Error ? err.message.split(cleanKey).join('[REDACTED]') : 'network error'}). The key was not saved.`,
      };
    }

    if (status === 200) {
      logger.info(`[BRAIN CREDENTIALS] Key verified with provider '${provider}' (••••${keyLastFour})`);
      return { valid: true, provider, keyLastFour };
    }

    logger.warn(`[BRAIN CREDENTIALS] Handshake failed for provider '${provider}' (HTTP ${status})`);
    return {
      valid: false,
      provider,
      keyLastFour,
      errorMessage:
        status === 401 || status === 403
          ? `Authentication handshake failed with provider '${provider}'. HTTP ${status} Unauthorized.`
          : `Provider '${provider}' could not verify the key (HTTP ${status}). The key was not saved.`,
    };
  }

  /**
   * Stores a validated provider credential into the tenant's envelope-encrypted vault (§9.8).
   * Never stores plaintext key in regular tables or logs.
   */
  public async storeValidatedKey(
    tenantId: string,
    provider: string,
    apiKey: string
  ): Promise<{ serviceSlug: string; keyLastFour: string }> {
    return TenantContextManager.withTenant(tenantId, 'default', async () => {
      const validation = await this.validateKey(provider, apiKey);
      if (!validation.valid) {
        throw new ValidationError(`Cannot save unverified key: ${validation.errorMessage}`);
      }

      const serviceSlug = `brain_provider_${provider}_${Date.now()}`;
      const cleanKey = apiKey.trim();
      const keyLastFour = cleanKey.slice(-4);

      // Save into envelope-encrypted AES-256-GCM vault
      await this.vault.storeSecret({
        serviceSlug,
        name: `Brain Key: ${provider}`,
        secretData: {
          provider,
          apiKey: cleanKey,
          keyLastFour,
          storedAt: new Date().toISOString(),
        },
        metadata: {
          provider,
          keyLastFour,
        },
      });

      await auditLogger.logEvent({
        action: 'brain.key_saved',
        resourceType: 'brain_credential',
        resourceId: serviceSlug,
        details: {
          tenantId,
          provider,
          keyLastFour,
        },
      });

      return {
        serviceSlug,
        keyLastFour,
      };
    });
  }

  /**
   * Rotates an active brain's key with zero downtime (§9.8):
   * Add new -> verify handshake -> cut over -> revoke old.
   */
  public async rotateKey(
    tenantId: string,
    brainId: string,
    newApiKey: string
  ): Promise<TenantBrainRecord> {
    return TenantContextManager.withTenant(tenantId, 'default', async () => {
      const brain = await this.brainRepo.getTenantBrain(brainId, tenantId);
      if (!brain) {
        throw new ValidationError(`Brain '${brainId}' not found for tenant '${tenantId}'.`);
      }

      // Step 1: Handshake validation of new key
      const validation = await this.validateKey(brain.provider, newApiKey);
      if (!validation.valid) {
        throw new ValidationError(`Key rotation aborted: New key validation failed: ${validation.errorMessage}`);
      }

      // Step 2: Store new key in vault
      const newServiceSlug = `brain_provider_${brain.provider}_${Date.now()}`;
      await this.vault.storeSecret({
        serviceSlug: newServiceSlug,
        name: `Brain Key: ${brain.provider}`,
        secretData: {
          provider: brain.provider,
          apiKey: newApiKey.trim(),
          keyLastFour: validation.keyLastFour,
          storedAt: new Date().toISOString(),
        },
      });

      const oldServiceSlug = brain.credentialVaultServiceSlug;

      // Step 3: Cut over active brain to new key
      const updatedBrain: TenantBrainRecord = {
        ...brain,
        credentialVaultServiceSlug: newServiceSlug,
        keyLastFour: validation.keyLastFour,
        status: 'certified',
        healthStatus: 'healthy',
        updatedAt: new Date().toISOString(),
      };

      await this.brainRepo.saveTenantBrain(updatedBrain);

      // Step 4: Revoke old key from vault if existed
      if (oldServiceSlug) {
        try {
          await this.vault.deleteSecret(oldServiceSlug);
        } catch (err) {
          logger.warn(`Failed to delete old vault secret '${oldServiceSlug}' during rotation`, { err });
        }
      }

      await auditLogger.logEvent({
        action: 'brain.key_rotated',
        resourceType: 'tenant_brain',
        resourceId: brainId,
        details: {
          tenantId,
          provider: brain.provider,
          newKeyLastFour: validation.keyLastFour,
        },
      });

      return updatedBrain;
    });
  }

  /**
   * Revokes an active brain credential (§9.8):
   * Stops routing immediately and sets brain status to 'revoked'.
   * Agents degrade gracefully per §9.4.
   */
  public async revokeBrain(tenantId: string, brainId: string): Promise<TenantBrainRecord> {
    return TenantContextManager.withTenant(tenantId, 'default', async () => {
      const brain = await this.brainRepo.getTenantBrain(brainId, tenantId);
      if (!brain) {
        throw new ValidationError(`Brain '${brainId}' not found for tenant '${tenantId}'.`);
      }

      if (brain.credentialVaultServiceSlug) {
        try {
          await this.vault.deleteSecret(brain.credentialVaultServiceSlug);
        } catch (err) {
          logger.warn(`Vault secret deletion error for '${brain.credentialVaultServiceSlug}'`, { err });
        }
      }

      const revokedBrain: TenantBrainRecord = {
        ...brain,
        status: 'revoked',
        healthStatus: 'halted',
        assignedAgents: [], // Detach from all agents
        updatedAt: new Date().toISOString(),
      };

      await this.brainRepo.saveTenantBrain(revokedBrain);

      await auditLogger.logEvent({
        action: 'brain.key_revoked',
        resourceType: 'tenant_brain',
        resourceId: brainId,
        details: {
          tenantId,
          modelId: brain.modelId,
          provider: brain.provider,
          keyLastFour: brain.keyLastFour,
        },
      });

      return revokedBrain;
    });
  }
}
