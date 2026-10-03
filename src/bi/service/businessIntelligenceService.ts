/**
 * Kriya AI — Business Intelligence & Executive Briefing Controller Service
 * High-level orchestration service for metric aggregation, briefing synthesis, and outbound delivery (§13, §14 of CLAUDE.md).
 */

import {
  GenerateBriefingRequest,
  ExecutiveBriefingRecord,
} from '../types/biTypes.js';
import { MetricAggregator } from '../aggregators/metricAggregator.js';
import { BriefingSynthesizer } from '../synthesizer/briefingSynthesizer.js';
import { BriefingRepository } from '../repositories/briefingRepository.js';
import { OutboundQueueService } from '../../channels/queue/outboundQueueService.js';
import { NotFoundError } from '../../core/errors/errors.js';
import { logger } from '../../core/logger/logger.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';

export class BusinessIntelligenceService {
  private aggregator: MetricAggregator;
  private briefingRepo: BriefingRepository;
  private outboundQueue: OutboundQueueService;

  constructor(dependencies?: {
    aggregator?: MetricAggregator;
    briefingRepo?: BriefingRepository;
    outboundQueue?: OutboundQueueService;
  }) {
    this.aggregator = dependencies?.aggregator || new MetricAggregator();
    this.briefingRepo = dependencies?.briefingRepo || new BriefingRepository();
    this.outboundQueue = dependencies?.outboundQueue || new OutboundQueueService();
  }

  /**
   * Generates a new executive daily briefing by aggregating multi-source metrics and synthesizing evidence-based narratives.
   */
  public async generateDailyBriefing(params: GenerateBriefingRequest): Promise<ExecutiveBriefingRecord> {
    const tenantId = TenantContextManager.getTenantId();
    const date = params.briefingDate || new Date().toISOString().split('T')[0];

    // 1. Multi-source metric aggregation
    const { snapshot, roi } = await this.aggregator.aggregateSnapshot(tenantId, date);

    // 2. Synthesize narrative markdown and WhatsApp format
    const synthesized = BriefingSynthesizer.synthesize(snapshot, roi);

    // 3. Persist in database
    const briefing = await this.briefingRepo.createBriefing({
      briefingDate: date,
      briefingType: params.briefingType || 'daily_executive',
      title: synthesized.title,
      summaryMarkdown: synthesized.summaryMarkdown,
      metricsSnapshot: snapshot,
      keyHighlights: synthesized.keyHighlights,
      attentionItems: synthesized.attentionItems,
      roiMetrics: roi,
      whatsappFormattedText: synthesized.whatsappFormattedText,
    });

    logger.info(`Executive Daily Briefing synthesized for tenant '${tenantId}' on date '${date}'.`);

    // Optional direct delivery if recipient phone number is provided
    if (params.recipientPhoneNumber) {
      await this.deliverBriefingViaWhatsApp(briefing.id, params.recipientPhoneNumber);
    }

    return briefing;
  }

  /**
   * Lists past executive briefings for the tenant.
   */
  public async listBriefings(startDate?: string, endDate?: string): Promise<ExecutiveBriefingRecord[]> {
    return this.briefingRepo.listBriefings(startDate, endDate);
  }

  /**
   * Retrieves an executive briefing by ID.
   */
  public async getBriefingById(id: string): Promise<ExecutiveBriefingRecord> {
    const briefing = await this.briefingRepo.findById(id);
    if (!briefing) {
      throw new NotFoundError(`Executive briefing '${id}' not found.`);
    }
    return briefing;
  }

  /**
   * Dispatches the executive briefing formatted text to WhatsApp outbound queue.
   */
  public async deliverBriefingViaWhatsApp(
    briefingId: string,
    recipientPhoneNumber: string
  ): Promise<{ delivered: boolean; queueItemId?: string }> {
    const briefing = await this.getBriefingById(briefingId);

    const result = await this.outboundQueue.dispatch({
      channel: 'whatsapp',
      recipient: recipientPhoneNumber,
      messageType: 'text',
      payload: {
        text: briefing.whatsapp_formatted_text,
      },
      idempotencyKey: `briefing_delivery_${briefing.id}_${Date.now()}`,
      isDirectResponse: true,
    });

    await this.briefingRepo.markDelivered(briefing.id);

    logger.info(`Executive briefing '${briefingId}' dispatched for delivery to '${recipientPhoneNumber}'.`);
    return { delivered: result.delivered, queueItemId: result.message.id };
  }
}
