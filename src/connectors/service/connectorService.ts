/**
 * Kriya Omnitask — Connector Service (WP-5.4, Blueprint §05, §13, ADR-011)
 * Manages tenant third-party integrations, credential vault binding,
 * connector instantiation, and health validation.
 */

import { DatabaseClient, db } from '../../storage/db.js';
import { CredentialVault } from '../../tools/vault/credentialVault.js';
import { TenantConnectorRepository } from '../repositories/tenantConnectorRepository.js';
import { GoogleCalendarConnector, FetchFunction } from '../calendar/googleCalendarConnector.js';
import {
  BaseConnector,
  CalendarConnector,
  ConnectorHealthCheck,
  RegisterConnectorInput,
  TenantConnectorRecord,
} from '../types/connectorTypes.js';
import { NotFoundError, ValidationError } from '../../core/errors/errors.js';
import { logger } from '../../core/logger/logger.js';

export interface ConnectorServiceOptions {
  client?: DatabaseClient;
  vault?: CredentialVault;
  fetchClient?: FetchFunction;
}

export class ConnectorService {
  private repo: TenantConnectorRepository;
  private vault: CredentialVault;
  private fetchClient?: FetchFunction;

  constructor(opts: ConnectorServiceOptions = {}) {
    this.repo = new TenantConnectorRepository(opts.client);
    this.vault = opts.vault ?? new CredentialVault();
    this.fetchClient = opts.fetchClient;
  }

  /**
   * Registers a new tenant connector and securely stores its secret in the vault.
   */
  public async registerConnector(
    input: RegisterConnectorInput,
    secretData: Record<string, unknown>
  ): Promise<{ connector: TenantConnectorRecord; health: ConnectorHealthCheck }> {
    // 1. Store credentials securely in the vault (AES-256-GCM)
    await this.vault.storeSecret({
      serviceSlug: input.credentialSlug,
      name: `${input.provider}:${input.name}`,
      secretData,
      metadata: {
        category: input.category,
        provider: input.provider,
      },
    });

    // 2. Register record in tenant_connectors table
    const record = await this.repo.registerConnector(input);

    // 3. Test connection to verify credentials work
    const instance = await this.getConnectorInstance(record.id);
    let health: ConnectorHealthCheck;
    if (instance) {
      health = await instance.testConnection();
      if (!health.healthy) {
        await this.repo.updateStatus(record.id, 'error', health.message);
      } else {
        await this.repo.updateStatus(record.id, 'active');
      }
    } else {
      health = { healthy: false, status: 'error', latencyMs: 0, message: 'Provider not implemented' };
    }

    const updated = (await this.repo.getConnector(record.id))!;
    return { connector: updated, health };
  }

  /**
   * Instantiates a connector client for a given record.
   */
  public async getConnectorInstance(connectorId: string): Promise<BaseConnector | null> {
    const record = await this.repo.getConnector(connectorId);
    if (!record) return null;

    if (record.provider === 'google_calendar') {
      const settings = JSON.parse(record.settings_json || '{}');
      return new GoogleCalendarConnector({
        id: record.id,
        credentialSlug: record.credential_slug,
        vault: this.vault,
        calendarId: settings.calendarId,
        fetchClient: this.fetchClient,
      });
    }

    return null;
  }

  /**
   * Resolves the primary active calendar connector for the tenant.
   */
  public async getActiveCalendarConnector(connectorId?: string): Promise<CalendarConnector | null> {
    if (connectorId) {
      const instance = await this.getConnectorInstance(connectorId);
      if (instance && instance.category === 'calendar') {
        return instance as CalendarConnector;
      }
      return null;
    }

    const calendarConnectors = await this.repo.findByCategory('calendar');
    const active = calendarConnectors.find((c) => c.status === 'active');
    if (!active) return null;

    const instance = await this.getConnectorInstance(active.id);
    return instance as CalendarConnector | null;
  }

  public async testConnector(id: string): Promise<ConnectorHealthCheck> {
    const instance = await this.getConnectorInstance(id);
    if (!instance) {
      throw new NotFoundError(`Connector '${id}' not found or unsupported provider.`);
    }

    const health = await instance.testConnection();
    await this.repo.updateStatus(id, health.healthy ? 'active' : 'error', health.message);
    if (health.healthy) {
      await this.repo.updateLastSynced(id);
    }
    return health;
  }

  public async listConnectors(): Promise<TenantConnectorRecord[]> {
    return this.repo.listConnectors();
  }

  public async deleteConnector(id: string): Promise<void> {
    const record = await this.repo.getConnector(id);
    if (!record) {
      throw new NotFoundError(`Connector '${id}' not found.`);
    }

    // Call disconnect on instance if needed
    const instance = await this.getConnectorInstance(id);
    if (instance) {
      try {
        await instance.disconnect();
      } catch (err) {
        logger.warn(`Error disconnecting connector '${id}':`, { err });
      }
    }

    await this.repo.deleteConnector(id);
  }
}
