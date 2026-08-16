/**
 * Xylarc AI — Omnichannel Communication REST Routes
 * Implements webhook verification, inbound event ingestion, and idempotent outbound messaging.
 */

import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../middleware/authMiddleware.js';
import { requirePermission } from '../middleware/rbacMiddleware.js';
import { ChannelRepository } from '../../channels/repositories/channelRepository.js';
import { MessageRepository } from '../../channels/repositories/messageRepository.js';
import { WebhookRepository } from '../../channels/repositories/webhookRepository.js';
import { WebhookVerifier } from '../../channels/security/webhookVerifier.js';
import { WhatsAppConnector } from '../../channels/whatsapp/whatsappConnector.js';
import { OutboundQueueService } from '../../channels/queue/outboundQueueService.js';
import { EntityResolutionService } from '../../customer360/services/entityResolutionService.js';
import { TimelineRepository } from '../../customer360/repositories/timelineRepository.js';
import { ValidationError, UnauthorizedError } from '../../core/errors/errors.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import { config } from '../../core/config/config.js';

const SendMessageSchema = z.object({
  customerId: z.string().optional(),
  channel: z.enum(['whatsapp', 'voice', 'email', 'sms']),
  recipient: z.string().min(1),
  idempotencyKey: z.string().min(1),
  messageType: z.enum(['text', 'template', 'interactive_button', 'interactive_list', 'media', 'voice_call']),
  payload: z.record(z.unknown()),
  isDirectResponse: z.boolean().optional(),
});

const ConfigureChannelSchema = z.object({
  channelType: z.enum(['whatsapp', 'voice', 'email', 'sms']),
  provider: z.enum(['meta_cloud_api', 'twilio', 'vonage', 'sendgrid', 'aws_ses']),
  credentials: z.record(z.unknown()),
  settings: z.record(z.unknown()).optional(),
});

export async function channelRoutes(fastify: FastifyInstance): Promise<void> {
  const channelRepo = new ChannelRepository();
  const messageRepo = new MessageRepository();
  const webhookRepo = new WebhookRepository();
  const queueService = new OutboundQueueService();
  const resolutionService = new EntityResolutionService();
  const timelineRepo = new TimelineRepository();

  // 1. Meta Webhook Verification Challenge (GET)
  fastify.get('/api/v1/channels/whatsapp/webhook', async (request, reply) => {
    const query = request.query as {
      'hub.mode'?: string;
      'hub.verify_token'?: string;
      'hub.challenge'?: string;
    };

    const expectedToken = config.get('WHATSAPP_WEBHOOK_VERIFY_TOKEN');

    if (query['hub.mode'] === 'subscribe' && query['hub.verify_token'] === expectedToken) {
      return reply.status(200).send(query['hub.challenge']);
    }

    throw new UnauthorizedError('Webhook verification token mismatch');
  });

  // 2. Meta Webhook Inbound Event Ingestion (POST)
  fastify.post('/api/v1/channels/whatsapp/webhook', async (request, reply) => {
    const signature = request.headers['x-hub-signature-256'] as string;
    const appSecret = config.get('WHATSAPP_APP_SECRET');
    const rawBody = JSON.stringify(request.body);

    // Verify signature if provided
    if (signature && !WebhookVerifier.verifyMetaSignature(rawBody, signature, appSecret)) {
      throw new UnauthorizedError('Invalid webhook HMAC-SHA256 signature');
    }

    const payloadHash = WebhookVerifier.computePayloadHash(rawBody);
    const tenantId = (request.headers['x-tenant-id'] as string) || 'system';

    return TenantContextManager.withTenant(tenantId, 'default', async () => {
      // Deduplication check
      const { isDuplicate } = await webhookRepo.recordInbound({
        channel: 'whatsapp',
        payloadHash,
        rawPayload: request.body,
      });

      if (isDuplicate) {
        return reply.status(200).send({ status: 'ignored', reason: 'duplicate_payload' });
      }

      // Parse payload
      const { messages, statuses } = WhatsAppConnector.parseInboundWebhook(request.body);

      // Process Inbound Messages
      for (const msg of messages) {
        // Resolve or create Customer 360 profile
        const resolution = await resolutionService.resolve({
          phone: msg.from,
          whatsappId: msg.from,
          source: 'whatsapp_webhook',
        });

        // Record interaction in Timeline
        await timelineRepo.appendEvent({
          customerId: resolution.customer.id,
          channel: 'whatsapp',
          eventType: msg.type === 'button_reply' ? 'message.button_clicked' : 'message.received',
          summary: msg.text ? `Inbound WhatsApp: ${msg.text.slice(0, 100)}` : `Inbound ${msg.type} message`,
          details: { messageId: msg.messageId, raw: msg.rawPayload },
          actorType: 'customer',
        });
      }

      // Process Delivery Status Receipts
      for (const st of statuses) {
        await messageRepo.updateDeliveryStatus(st.messageId, st.status as any, st.timestamp);
      }

      return reply.status(200).send({
        status: 'processed',
        messagesProcessed: messages.length,
        statusesProcessed: statuses.length,
      });
    });
  });

  // 3. Send Outbound Message (POST)
  fastify.post('/api/v1/channels/send', {
    preHandler: [authenticate, requirePermission('tool:execute')],
  }, async (request, reply) => {
    const user = request.user!;
    return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
      const parseResult = SendMessageSchema.safeParse(request.body);
      if (!parseResult.success) {
        throw new ValidationError('Outbound message payload invalid', { issues: parseResult.error.issues });
      }

      const result = await queueService.dispatch(parseResult.data);
      return reply.status(result.delivered ? 200 : 422).send(result);
    }, { userId: user.userId, roles: user.roles });
  });

  // 4. Get Message Status (GET)
  fastify.get('/api/v1/channels/messages/:id', {
    preHandler: [authenticate, requirePermission('tool:execute')],
  }, async (request, reply) => {
    const user = request.user!;
    return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
      const { id } = request.params as { id: string };
      const message = await messageRepo.getById(id);
      return reply.status(200).send({ message });
    }, { userId: user.userId, roles: user.roles });
  });

  // 5. Configure Tenant Channel Integration (POST)
  fastify.post('/api/v1/channels/config', {
    preHandler: [authenticate, requirePermission('tool:configure')],
  }, async (request, reply) => {
    const user = request.user!;
    return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
      const parseResult = ConfigureChannelSchema.safeParse(request.body);
      if (!parseResult.success) {
        throw new ValidationError('Channel configuration validation failed', { issues: parseResult.error.issues });
      }

      const body = parseResult.data;
      const configRecord = await channelRepo.saveChannelConfig({
        channelType: body.channelType,
        provider: body.provider,
        credentials: body.credentials,
        settings: body.settings,
      });

      return reply.status(200).send({
        channel: {
          id: configRecord.id,
          channelType: configRecord.channel_type,
          provider: configRecord.provider,
          status: configRecord.status,
          settings: JSON.parse(configRecord.settings_json),
          updatedAt: configRecord.updated_at,
        },
      });
    }, { userId: user.userId, roles: user.roles });
  });

  // 6. Get Tenant Channel Integration Config (GET)
  fastify.get('/api/v1/channels/config/:channelType', {
    preHandler: [authenticate, requirePermission('tool:configure')],
  }, async (request, reply) => {
    const user = request.user!;
    return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
      const { channelType } = request.params as { channelType: string };
      const configRecord = await channelRepo.findByType(channelType);
      if (!configRecord) {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: `No config found for ${channelType}` } });
      }

      return reply.status(200).send({
        channel: {
          id: configRecord.id,
          channelType: configRecord.channel_type,
          provider: configRecord.provider,
          status: configRecord.status,
          settings: JSON.parse(configRecord.settings_json),
          updatedAt: configRecord.updated_at,
        },
      });
    }, { userId: user.userId, roles: user.roles });
  });
}
