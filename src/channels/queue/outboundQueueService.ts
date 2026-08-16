/**
 * Xylarc AI — Outbound Message Queue & Dispatcher
 * Idempotent message delivery, privacy consent gating, and frequency governance (§21, §27 of CLAUDE.md).
 */

import { MessageRepository, OutboundMessageRecord, OutboundStatus } from '../repositories/messageRepository.js';
import { ChannelRepository } from '../repositories/channelRepository.js';
import { FrequencyGovernor } from '../governor/frequencyGovernor.js';
import { Customer360Service } from '../../customer360/services/customer360Service.js';
import { QuotaService } from '../../control-plane/quotas/quotaService.js';
import { TimelineRepository } from '../../customer360/repositories/timelineRepository.js';
import { auditLogger } from '../../security/audit/auditLogger.js';
import { CryptoUtils } from '../../core/utils/crypto.js';

export interface SendMessagePayload {
  customerId?: string;
  channel: 'whatsapp' | 'voice' | 'email' | 'sms';
  recipient: string;
  idempotencyKey: string;
  messageType: 'text' | 'template' | 'interactive_button' | 'interactive_list' | 'media' | 'voice_call';
  payload: Record<string, unknown>;
  isDirectResponse?: boolean;
}

export interface SendResult {
  message: OutboundMessageRecord;
  delivered: boolean;
  status: OutboundStatus;
  reason?: string;
}

export class OutboundQueueService {
  private messageRepo: MessageRepository;
  private channelRepo: ChannelRepository;
  private governor: FrequencyGovernor;
  private customer360Service: Customer360Service;
  private quotaService: QuotaService;
  private timelineRepo: TimelineRepository;

  constructor(
    messageRepo?: MessageRepository,
    channelRepo?: ChannelRepository,
    governor?: FrequencyGovernor,
    customer360Service?: Customer360Service,
    quotaService?: QuotaService,
    timelineRepo?: TimelineRepository
  ) {
    this.messageRepo = messageRepo || new MessageRepository();
    this.channelRepo = channelRepo || new ChannelRepository();
    this.governor = governor || new FrequencyGovernor(this.messageRepo);
    this.customer360Service = customer360Service || new Customer360Service();
    this.quotaService = quotaService || new QuotaService();
    this.timelineRepo = timelineRepo || new TimelineRepository();
  }

  /**
   * Dispatches or enqueues an outbound message idempotently.
   */
  public async dispatch(params: SendMessagePayload): Promise<SendResult> {
    // 1. Idempotency Check: Return existing record if already submitted
    const existing = await this.messageRepo.findByIdempotencyKey(params.idempotencyKey);
    if (existing) {
      return {
        message: existing,
        delivered: existing.status === 'sent' || existing.status === 'delivered',
        status: existing.status,
        reason: 'Idempotency key match: returning existing submission.',
      };
    }

    // 2. Channel Plan Quota Check
    if (params.channel === 'whatsapp' || params.channel === 'voice') {
      await this.quotaService.assertChannelAllowed(params.channel);
    }

    // 3. Customer Consent Check
    if (params.customerId && (params.channel === 'whatsapp' || params.channel === 'voice' || params.channel === 'email')) {
      const consentCheck = await this.customer360Service.canCommunicate(params.customerId, params.channel);
      if (!consentCheck.allowed) {
        const record = await this.messageRepo.create({
          customer_id: params.customerId,
          channel: params.channel,
          idempotency_key: params.idempotencyKey,
          recipient: params.recipient,
          message_type: params.messageType,
          payload_json: JSON.stringify(params.payload),
          status: 'failed',
          error_message: `Opt-out restriction: ${consentCheck.reason}`,
          retry_count: 0,
        });

        return { message: record, delivered: false, status: 'failed', reason: consentCheck.reason };
      }
    }

    // 4. Anti-Spam Frequency & Quiet Hours Governance
    const govCheck = await this.governor.evaluateOutbound({
      customerId: params.customerId,
      isDirectResponse: params.isDirectResponse,
    });

    if (!govCheck.allowed) {
      const throttleStatus: OutboundStatus = govCheck.status === 'allowed' ? 'failed' : govCheck.status;
      const record = await this.messageRepo.create({
        customer_id: params.customerId,
        channel: params.channel,
        idempotency_key: params.idempotencyKey,
        recipient: params.recipient,
        message_type: params.messageType,
        payload_json: JSON.stringify(params.payload),
        status: throttleStatus,
        error_message: govCheck.reason,
        retry_count: 0,
      });

      return { message: record, delivered: false, status: throttleStatus, reason: govCheck.reason };
    }

    // 5. Successful Transmission
    const externalMessageId = `wamid.${CryptoUtils.generateId()}`;
    const now = new Date().toISOString();

    const record = await this.messageRepo.create({
      customer_id: params.customerId,
      channel: params.channel,
      idempotency_key: params.idempotencyKey,
      recipient: params.recipient,
      message_type: params.messageType,
      payload_json: JSON.stringify(params.payload),
      status: 'sent',
      external_message_id: externalMessageId,
      sent_at: now,
      retry_count: 0,
    });

    // 6. Record interaction in Customer 360 Timeline
    if (params.customerId) {
      await this.timelineRepo.appendEvent({
        customerId: params.customerId,
        channel: params.channel,
        eventType: 'message.sent',
        summary: `Outbound ${params.channel} message sent (${params.messageType})`,
        details: { idempotencyKey: params.idempotencyKey, externalMessageId },
        actorType: 'system',
      });
    }

    await auditLogger.logEvent({
      action: 'channel.message_sent',
      resourceType: 'outbound_message',
      resourceId: record.id,
      details: { channel: params.channel, recipient: params.recipient, messageType: params.messageType },
    });

    return {
      message: record,
      delivered: true,
      status: 'sent',
    };
  }
}
