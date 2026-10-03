/**
 * Kriya Omnitask — Inbound Customer Message Service (WP-2.7, Blueprint §05, §13)
 * Wires incoming omnichannel customer messages (WhatsApp, etc.) directly into the
 * Intake / Concierge agent DAG graph runtime with durable execution, verifiable read-backs,
 * automated outbound replies, and Customer 360 timeline traceability.
 */

import { DatabaseClient, db } from '../../storage/db.js';
import { buildIntakeAgent, Handoff } from '../../agents/phase0/intakeAgent.js';
import { createSchedulingReceiver } from '../../agents/phase0/schedulingAgent.js';
import { createPaymentsReceiver } from '../../agents/phase0/paymentsAgent.js';
import { createRuntimeHandlers } from '../../runtime/graph/handlers.js';
import { GraphExecutor, RunResult } from '../../runtime/graph/executor.js';
import { GraphRunRepository } from '../../runtime/graph/graphRunRepository.js';
import { ToolRegistryService } from '../../tools/registry/toolRegistry.js';
import { ModelGateway } from '../../model/gateway/modelGateway.js';
import { ProofService } from '../../trust/proof/proofService.js';
import { MandateService } from '../../trust/mandate/mandateService.js';
import { AttentionService } from '../../attention/service/attentionService.js';
import { ObservabilityService } from '../../observability/service/observabilityService.js';
import { TraceRepository } from '../../observability/repositories/traceRepository.js';
import { OutboundQueueService } from '../queue/outboundQueueService.js';
import { TimelineRepository } from '../../customer360/repositories/timelineRepository.js';
import { ConsentRepository } from '../../customer360/repositories/consentRepository.js';
import { logger } from '../../core/logger/logger.js';

export interface ProcessInboundCustomerMessageParams {
  tenantId: string;
  customerId: string;
  phone: string;
  channel: 'whatsapp' | 'voice' | 'email' | 'sms';
  messageText: string;
  messageId: string;
  rawPayload?: Record<string, unknown>;
}

export interface InboundCustomerMessageResult {
  runId: string;
  status: string;
  outcome?: string;
  reply?: string;
  handoff?: Handoff;
  deliveryRef?: string;
  isDuplicate?: boolean;
}

export class InboundMessageService {
  private client: DatabaseClient;
  private toolRegistry: ToolRegistryService;
  private gateway: ModelGateway;
  private attentionService: AttentionService;
  private observabilityService: ObservabilityService;
  private outboundQueue: OutboundQueueService;
  private timelineRepo: TimelineRepository;
  private graphRunRepo: GraphRunRepository;

  constructor(deps: {
    client?: DatabaseClient;
    toolRegistry?: ToolRegistryService;
    gateway?: ModelGateway;
    attentionService?: AttentionService;
    observabilityService?: ObservabilityService;
    outboundQueue?: OutboundQueueService;
    timelineRepo?: TimelineRepository;
    graphRunRepo?: GraphRunRepository;
  } = {}) {
    this.client = deps.client ?? db.getClient();
    this.toolRegistry = deps.toolRegistry ?? new ToolRegistryService();
    this.gateway = deps.gateway ?? new ModelGateway();
    this.attentionService = deps.attentionService ?? new AttentionService(this.client);
    this.observabilityService = deps.observabilityService ?? new ObservabilityService(new TraceRepository(this.client));
    this.outboundQueue = deps.outboundQueue ?? new OutboundQueueService();
    this.timelineRepo = deps.timelineRepo ?? new TimelineRepository(this.client);
    this.graphRunRepo = deps.graphRunRepo ?? new GraphRunRepository(this.client);
  }

  /**
   * Dispatches an inbound customer message directly into the Intake agent DAG graph runtime.
   */
  public async processInboundCustomerMessage(
    params: ProcessInboundCustomerMessageParams
  ): Promise<InboundCustomerMessageResult> {
    const correlationId = `inbound:${params.channel}:${params.messageId}`;

    // 1. Idempotency Check: if this inbound message was already processed into a run, return it
    const existingRun = await this.graphRunRepo.findByCorrelationId(correlationId);
    if (existingRun) {
      const state = JSON.parse(existingRun.state_json || '{}');
      return {
        runId: existingRun.id,
        status: existingRun.status,
        outcome: existingRun.outcome ?? undefined,
        reply: typeof state.reply === 'string' ? state.reply : undefined,
        handoff: state.handoff as Handoff | undefined,
        deliveryRef: (state.delivery as { ref?: string } | undefined)?.ref,
        isDuplicate: true,
      };
    }

    // 2. Build Intake Agent Graph with integrated specialist receivers
    const schedulingReceiver = createSchedulingReceiver({
      registry: this.toolRegistry,
      gateway: this.gateway,
      client: this.client,
      attention: this.attentionService,
    });

    const paymentsReceiver = createPaymentsReceiver({
      registry: this.toolRegistry,
      gateway: this.gateway,
      client: this.client,
      attention: this.attentionService,
    });

    const consentRepo = new ConsentRepository(this.client);
    const agent = buildIntakeAgent({
      consentRepo,
      attention: this.attentionService,
      receivers: {
        scheduling: schedulingReceiver,
        payments: paymentsReceiver,
      },
    });

    // 3. Assemble verified runtime handlers
    const { handlers, compensator } = createRuntimeHandlers({
      agentSlug: 'intake',
      gateway: this.gateway,
      schemas: agent.schemas,
      rules: agent.rules,
      toolRegistry: this.toolRegistry,
      proofService: new ProofService(this.client),
      mandateService: new MandateService(this.client),
      dbClient: this.client,
    });

    // 4. Execute through the durable GraphExecutor
    const executor = new GraphExecutor(
      handlers,
      this.graphRunRepo,
      compensator,
      this.attentionService,
      this.observabilityService
    );

    const runResult: RunResult = await executor.start(
      agent.graph,
      {
        request: params.messageText,
        customerId: params.customerId,
        channel: params.channel,
        phone: params.phone,
        messageId: params.messageId,
      },
      { correlationId }
    );

    const finalReply = typeof runResult.state.reply === 'string' ? runResult.state.reply : undefined;
    const handoff = runResult.state.handoff as Handoff | undefined;
    const delivery = runResult.state.delivery as { ref?: string; outcome?: string } | undefined;

    // 5. Automated direct customer reply dispatch if an answer or message was produced
    if (finalReply && params.phone) {
      try {
        await this.outboundQueue.dispatch({
          customerId: params.customerId,
          channel: params.channel,
          recipient: params.phone,
          idempotencyKey: `reply:${runResult.runId}`,
          messageType: 'text',
          payload: { body: finalReply },
          isDirectResponse: true,
        });
        logger.info(
          `Outbound response dispatched for inbound run '${runResult.runId}' via ${params.channel}`,
          { customerId: params.customerId, runId: runResult.runId }
        );
      } catch (dispatchErr) {
        logger.error(
          `Failed to dispatch direct response for run '${runResult.runId}': ${dispatchErr instanceof Error ? dispatchErr.message : String(dispatchErr)}`,
          { runId: runResult.runId, customerId: params.customerId }
        );
      }
    }

    // 6. Record interaction in Customer Timeline
    await this.timelineRepo.appendEvent({
      customerId: params.customerId,
      channel: params.channel,
      eventType: 'agent.intake_completed',
      summary: `Intake agent processed inquiry (${runResult.outcome ?? runResult.status})`,
      details: {
        runId: runResult.runId,
        outcome: runResult.outcome,
        status: runResult.status,
        intent: (runResult.state.classification as { intent?: string } | undefined)?.intent,
        hasReply: !!finalReply,
        deliveryRef: delivery?.ref,
      },
      actorType: 'agent',
      actorId: 'intake',
    });

    return {
      runId: runResult.runId,
      status: runResult.status,
      outcome: runResult.outcome ?? undefined,
      reply: finalReply,
      handoff,
      deliveryRef: delivery?.ref,
      isDuplicate: false,
    };
  }
}
