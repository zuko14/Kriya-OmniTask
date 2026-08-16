/**
 * Xylarc AI — Channel Integration Repository
 * Manages per-tenant messaging channel configurations with encrypted provider credentials.
 */

import { BaseRepository, BaseEntity } from '../../storage/repositories/baseRepository.js';
import { DatabaseClient } from '../../storage/db.js';
import { CryptoUtils } from '../../core/utils/crypto.js';

export interface ChannelIntegrationRecord extends BaseEntity {
  channel_type: 'whatsapp' | 'voice' | 'email' | 'sms';
  provider: 'meta_cloud_api' | 'twilio' | 'vonage' | 'sendgrid' | 'aws_ses';
  status: 'active' | 'disabled' | 'error';
  credentials_encrypted: string;
  settings_json: string;
}

export class ChannelRepository extends BaseRepository<ChannelIntegrationRecord> {
  protected readonly tableName = 'channel_integrations';

  constructor(client?: DatabaseClient) {
    super(client);
  }

  public async findByType(channelType: string): Promise<ChannelIntegrationRecord | null> {
    const tenantId = this.getTenantId();
    return this.client.queryOne<ChannelIntegrationRecord>(
      'SELECT * FROM channel_integrations WHERE channel_type = ? AND tenant_id = ?;',
      [channelType, tenantId]
    );
  }

  public async saveChannelConfig<T extends Record<string, unknown>>(params: {
    channelType: 'whatsapp' | 'voice' | 'email' | 'sms';
    provider: 'meta_cloud_api' | 'twilio' | 'vonage' | 'sendgrid' | 'aws_ses';
    credentials: T;
    settings?: Record<string, unknown>;
  }): Promise<ChannelIntegrationRecord> {
    const tenantId = this.getTenantId();
    const existing = await this.findByType(params.channelType);
    const credentials_encrypted = JSON.stringify(CryptoUtils.encrypt(JSON.stringify(params.credentials)));
    const settings_json = JSON.stringify(params.settings || {});
    const now = new Date().toISOString();

    if (existing) {
      await this.update(existing.id, {
        provider: params.provider,
        credentials_encrypted,
        settings_json,
        status: 'active',
      });
      return (await this.findById(existing.id))!;
    }

    return this.create({
      channel_type: params.channelType,
      provider: params.provider,
      status: 'active',
      credentials_encrypted,
      settings_json,
    });
  }

  public async getDecryptedCredentials<T = Record<string, unknown>>(channelType: string): Promise<T | null> {
    const integration = await this.findByType(channelType);
    if (!integration || !integration.credentials_encrypted) return null;
    try {
      const decryptedStr = CryptoUtils.decrypt(integration.credentials_encrypted);
      return JSON.parse(decryptedStr) as T;
    } catch {
      return null;
    }
  }
}
