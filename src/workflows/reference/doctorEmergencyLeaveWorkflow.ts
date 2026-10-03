/**
 * Kriya Omnitask — Reference Workflow: "Doctor Emergency Leave" (docs/kriya WP-4.7, Blueprint §14)
 *
 * M4 Acceptance Milestone Demo: End-to-end composition of:
 *   1. Intake Agent (WP-4.2): notice ingestion and customer notification
 *   2. Scheduling Agent (WP-4.3): slot release, cancellation, and rebooking availability
 *   3. Document (Lens) Agent (WP-4.5): deterministic extraction of emergency leave notice (zero-retention)
 *   4. Payments & Mandate (WP-3.1, WP-4.4): T2 auto-refund under mandate, T3 human-gate for over-limit refunds
 *   5. Attention & Verification Agents (WP-4.6): branch role routing and async read-back verification jobs
 *
 * Flow:
 *   detect → find affected → cancel/release (T1) → refund under limit (T2) →
 *   over-limit approval (T3) → offer rebooking → verify settlement.
 */

import { GraphDefinition } from '../../runtime/graph/types.js';
import { assertValidGraph } from '../../runtime/graph/validator.js';
import { GraphExecutor, RunResult } from '../../runtime/graph/executor.js';
import { createRuntimeHandlers, RuntimeDeps } from '../../runtime/graph/handlers.js';
import { GraphRunRepository } from '../../runtime/graph/graphRunRepository.js';
import { AppointmentBook, AppointmentRecord, ResourceRecord, schedulingTools } from '../../scheduling/appointmentBook.js';
import { DocumentService } from '../../document/service/documentService.js';
import { DocumentRepository } from '../../document/repositories/documentRepository.js';
import { MandateService } from '../../trust/mandate/mandateService.js';
import { ProofService } from '../../trust/proof/proofService.js';
import { AttentionService } from '../../attention/service/attentionService.js';
import { VerificationJobService } from '../../attention/service/verificationJobService.js';
import { ToolRegistryService } from '../../tools/registry/toolRegistry.js';
import { ToolGateway } from '../../tools/gateway/toolGateway.js';
import { PolicyEngine } from '../../policy/engine/policyEngine.js';
import { RefundRepository } from '../../billing/repositories/refundRepository.js';
import { paymentTools } from '../../billing/service/paymentTools.js';
import { DatabaseClient, db } from '../../storage/db.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import { CryptoUtils } from '../../core/utils/crypto.js';
import { ValidationError, NotFoundError } from '../../core/errors/errors.js';

// ============================================================================
// 1. Graph Definition (Blueprint §14 Compliant)
// ============================================================================

export function buildDoctorEmergencyLeaveGraph(): GraphDefinition {
  return {
    id: 'doctor_emergency_leave_case',
    version: '1.0.0',
    entry: 'policy_cancel',
    maxSteps: 30,
    nodes: [
      {
        id: 'policy_cancel',
        kind: 'policy',
        config: { actionType: 'tool_execution', category: 'booking', writeTo: 'policy_cancel' },
      },
      {
        id: 'cancel_slot',
        kind: 'tool',
        actionTier: 'T1',
        config: {
          tool: 'schedule_cancel',
          inputPath: 'cancelInput',
          writeTo: 'action_cancel',
        },
      },
      {
        id: 'verify_cancel',
        kind: 'verify',
        config: {
          actionPath: 'action_cancel',
          writeTo: 'verification_cancel',
        },
      },
      {
        id: 'proof_cancel',
        kind: 'proof',
        config: {
          actionPath: 'action_cancel',
          verificationPath: 'verification_cancel',
          writeTo: 'receipt_cancel',
        },
      },
      {
        id: 'policy_refund',
        kind: 'policy',
        config: { actionType: 'tool_execution', category: 'financial', writeTo: 'policy_refund' },
      },
      {
        id: 'mandate_refund',
        kind: 'mandate',
        config: {
          actionType: 'payment_refund',
          amountPath: 'feeAmount',
          currency: 'INR',
          writeTo: 'mandate',
        },
      },
      {
        id: 'approval_gate',
        kind: 'human_gate',
        config: { reason: 'Refund exceeds autonomous mandate limit' },
      },
      {
        id: 'refund_t2',
        kind: 'tool',
        actionTier: 'T2',
        config: {
          tool: 'payment_refund',
          inputPath: 'refundInput',
          writeTo: 'action_refund',
        },
      },
      {
        id: 'refund_t3',
        kind: 'tool',
        actionTier: 'T3',
        config: {
          tool: 'payment_refund',
          inputPath: 'refundInput',
          writeTo: 'action_refund',
        },
      },
      {
        id: 'verify_refund',
        kind: 'verify',
        config: {
          actionPath: 'action_refund',
          writeTo: 'verification_refund',
        },
      },
      {
        id: 'proof_refund',
        kind: 'proof',
        config: {
          actionPath: 'action_refund',
          verificationPath: 'verification_refund',
          writeTo: 'receipt_refund',
        },
      },
      {
        id: 'rebooking_rule',
        kind: 'rule',
        config: { rule: 'find_rebooking_options' },
      },
      { id: 'done_verified', kind: 'end', outcome: 'verified', config: {} },
      { id: 'done_escalated', kind: 'end', outcome: 'escalated', config: {} },
      { id: 'done_mismatch', kind: 'end', outcome: 'verification_failed', config: {} },
    ],
    edges: [
      { from: 'policy_cancel', to: 'cancel_slot' },
      { from: 'cancel_slot', to: 'verify_cancel' },
      {
        from: 'verify_cancel',
        to: 'proof_cancel',
        when: [{ path: 'verification_cancel.state', op: 'eq', value: 'verified' }],
      },
      { from: 'verify_cancel', to: 'done_mismatch' },
      { from: 'proof_cancel', to: 'policy_refund' },
      {
        from: 'policy_refund',
        to: 'mandate_refund',
        when: [{ path: 'policy_refund.decision', op: 'eq', value: 'allow' }],
      },
      { from: 'policy_refund', to: 'done_escalated' },
      {
        from: 'mandate_refund',
        to: 'refund_t2',
        when: [{ path: 'mandate.decision', op: 'eq', value: 'allow' }],
      },
      { from: 'mandate_refund', to: 'approval_gate' },
      {
        from: 'approval_gate',
        to: 'refund_t3',
        when: [{ path: 'approval.decision', op: 'eq', value: 'approved' }],
      },
      { from: 'approval_gate', to: 'done_escalated' },
      { from: 'refund_t2', to: 'verify_refund' },
      { from: 'refund_t3', to: 'verify_refund' },
      {
        from: 'verify_refund',
        to: 'proof_refund',
        when: [{ path: 'verification_refund.state', op: 'eq', value: 'verified' }],
      },
      { from: 'verify_refund', to: 'done_mismatch' },
      { from: 'proof_refund', to: 'rebooking_rule' },
      { from: 'rebooking_rule', to: 'done_verified' },
    ],
  };
}

// ============================================================================
// 2. Types & Interfaces
// ============================================================================

export interface EmergencyLeaveInput {
  leaveNoticeText?: string;
  resourceId?: string;
  doctorName?: string;
  leaveStart?: string; // "YYYY-MM-DD" or "YYYY-MM-DD HH:MM"
  leaveEnd?: string;
  reason?: string;
  mandateId?: string;
  branchId?: string;
  defaultCustomerLanguage?: string;
}

export interface RebookingOption {
  resourceId: string;
  doctorName: string;
  department: string | null;
  date: string;
  freeSlots: string[];
}

export interface PatientResolution {
  appointmentId: string;
  customerRef: string;
  customerName: string | null;
  originalSlot: string;
  feeAmount: number;
  status: 'verified' | 'parked_for_approval' | 'escalated' | 'failed';
  runId: string;
  cancellationReceiptId?: string;
  refundReceiptId?: string;
  refundId?: string;
  requiresHumanApproval?: boolean;
  attentionItemId?: string;
  rebookingOptions?: RebookingOption[];
  notificationText?: string;
}

export interface EmergencyLeaveExecutionReport {
  leaveId: string;
  resourceId: string;
  doctorName: string;
  leaveStart: string;
  leaveEnd: string;
  reason: string;
  totalAffected: number;
  autoResolvedCount: number;
  parkedCount: number;
  totalRefundAmount: number;
  resolutions: PatientResolution[];
  verificationJobId?: string;
  verificationStatus: 'verified' | 'pending' | 'mismatch';
  completedAt: string;
}

// ============================================================================
// 3. Workflow Service Implementation
// ============================================================================

export class DoctorEmergencyLeaveWorkflow {
  private book: AppointmentBook;
  private docService: DocumentService;
  private mandateService: MandateService;
  private proofService: ProofService;
  private attentionService: AttentionService;
  private verificationService: VerificationJobService;
  private toolRegistry: ToolRegistryService;
  private toolGateway: ToolGateway;
  private policyEngine: PolicyEngine;
  private refundRepo: RefundRepository;
  private graphRepo: GraphRunRepository;

  constructor(private readonly customClient?: DatabaseClient) {
    const client = this.customClient ?? db.getClient();
    this.book = new AppointmentBook(client);
    this.attentionService = new AttentionService(client);
    this.docService = new DocumentService(client, undefined, this.attentionService);
    this.mandateService = new MandateService(client);
    this.proofService = new ProofService(client);
    this.toolRegistry = new ToolRegistryService();
    if (this.customClient) {
      for (const tool of schedulingTools(client)) this.toolRegistry.registerTool(tool);
      for (const tool of paymentTools(() => new RefundRepository(client))) this.toolRegistry.registerTool(tool);
    }
    this.verificationService = new VerificationJobService(client, this.toolRegistry, this.attentionService);
    this.toolGateway = new ToolGateway({ toolRegistry: this.toolRegistry, dbClient: client });
    this.policyEngine = new PolicyEngine(client);
    this.refundRepo = new RefundRepository(client);
    this.graphRepo = new GraphRunRepository(client);
  }

  private get client(): DatabaseClient {
    return this.customClient ?? db.getClient();
  }

  private tenant(): string {
    return TenantContextManager.getTenantId();
  }

  /**
   * Helper to format localized patient notifications.
   */
  public static composeNotification(
    customerName: string | null,
    doctorName: string,
    startsAt: string,
    refundAmount: number,
    alternateOptions: RebookingOption[],
    language = 'en'
  ): string {
    const name = customerName || 'Valued Patient';
    const alt =
      alternateOptions.length > 0 && alternateOptions[0].freeSlots.length > 0
        ? `${alternateOptions[0].doctorName} at ${alternateOptions[0].freeSlots.slice(0, 2).join(', ')}`
        : 'the next available dates';

    switch (language.toLowerCase()) {
      case 'hi':
      case 'hindi':
        return `नमस्ते ${name}, ${doctorName} आपातकालीन अवकाश पर हैं। ${startsAt} का आपका अपॉइंटमेंट रद्द कर दिया गया है और ₹${refundAmount} का शुल्क वापस कर दिया गया है। वैकल्पिक समय: ${alt}। पुनः बुक करने के लिए उत्तर दें।`;
      case 'te':
      case 'telugu':
        return `నమస్కారం ${name}, ${doctorName} గారు అత్యవసర సెలవులో ఉన్నారు. ${startsAt} న మీ అపాయింట్‌మెంట్ రద్దు చేయబడింది మరియు ₹${refundAmount} ఫీజు రీఫండ్ చేయబడింది. ప్రత్యామ్నాయ స్లాట్‌లు: ${alt}। బుక్ చేసుకోవడానికి రిప్లై ఇవ్వండి.`;
      case 'ta':
      case 'tamil':
        return `வணக்கம் ${name}, ${doctorName} அவசர விடுப்பில் உள்ளார். ${startsAt} உங்கள் முன்பதிவு ரத்து செய்யப்பட்டு ₹${refundAmount} கட்டணம் திருப்பி வழங்கப்பட்டது. மாற்று நேரம்: ${alt}.`;
      default:
        return `Dear ${name}, ${doctorName} is on emergency medical leave. Your appointment at ${startsAt} has been cancelled and your fee of ₹${refundAmount} has been refunded. Alternative slots are available with ${alt}. Reply to rebook.`;
    }
  }

  /**
   * Phase 1 & 2: Detect leave details and find affected appointments.
   */
  public async detectAndFindAffected(input: EmergencyLeaveInput): Promise<{
    resource: ResourceRecord;
    leaveStart: string;
    leaveEnd: string;
    reason: string;
    affected: AppointmentRecord[];
  }> {
    let doctorName = input.doctorName;
    let leaveStart = input.leaveStart;
    let leaveEnd = input.leaveEnd;
    let reason = input.reason || 'Doctor Emergency Leave';

    // If leave notice text is provided, parse it with Document (Lens) Agent (L0 deterministic, zero-retention)
    if (input.leaveNoticeText) {
      const parsed = await this.docService.parseDocument({
        rawContent: input.leaveNoticeText,
        documentType: 'leave_notice',
      });
      if (parsed.status === 'verified' && parsed.structuredData) {
        const data = parsed.structuredData as {
          doctorName?: string;
          leaveStart?: string;
          leaveEnd?: string;
          reason?: string;
        };
        if (data.doctorName && !doctorName) doctorName = data.doctorName;
        if (data.leaveStart && !leaveStart) leaveStart = data.leaveStart;
        if (data.leaveEnd && !leaveEnd) leaveEnd = data.leaveEnd;
        if (data.reason && (!input.reason || input.reason === 'Doctor Emergency Leave')) {
          reason = data.reason;
        }
      }
    }

    if (!leaveStart || !leaveEnd) {
      throw new ValidationError('Leave start and end dates/times are required.');
    }

    // Resolve resource
    let resource: ResourceRecord | null = null;
    if (input.resourceId) {
      resource = await this.book.resource(input.resourceId);
    }
    if (!resource && doctorName) {
      const avail = await this.book.availability(leaveStart.slice(0, 10), { doctor: doctorName });
      if (avail.length > 0) {
        resource = await this.book.resource(avail[0].resourceId);
      }
    }
    if (!resource) {
      throw new NotFoundError(
        `Doctor resource not found for '${input.resourceId || doctorName || 'unknown'}'.`
      );
    }

    // Query affected appointments
    const fromStr = leaveStart.length === 10 ? `${leaveStart} 00:00` : leaveStart;
    const toStr = leaveEnd.length === 10 ? `${leaveEnd} 23:59` : leaveEnd;
    const affected = await this.book.forResource(resource.id, fromStr, toStr);

    return {
      resource,
      leaveStart,
      leaveEnd,
      reason,
      affected,
    };
  }

  /**
   * Phase 3: Execute the Verified Action graph for a single affected patient appointment.
   */
  public async processAffectedAppointment(params: {
    appointment: AppointmentRecord;
    resource: ResourceRecord;
    leaveReason: string;
    mandateId?: string;
    branchId?: string;
    language?: string;
  }): Promise<PatientResolution> {
    const { appointment, resource, leaveReason, branchId, language } = params;
    const feeAmount = appointment.fee_amount ?? 500.0;
    const customerRef = appointment.customer_ref;

    // Build custom runtime deps and handlers
    const runtimeDeps: RuntimeDeps = {
      agentSlug: 'scheduling',
      agentVersion: '1.0.0',
      policyEngine: this.policyEngine,
      mandateService: this.mandateService,
      proofService: this.proofService,
      toolGateway: this.toolGateway,
      toolRegistry: this.toolRegistry,
      dbClient: this.client,
      rules: {
        find_rebooking_options: async () => {
          // Rule executed within graph: finds alternate slots in department
          const sameDay = appointment.starts_at.slice(0, 10);
          const dept = resource.department ?? undefined;
          const alts = await this.book.availability(sameDay, { department: dept });
          const filtered = alts
            .filter((a) => a.resourceId !== resource.id && a.freeSlots.length > 0)
            .map((a) => ({
              resourceId: a.resourceId,
              doctorName: a.name,
              department: a.department,
              date: sameDay,
              freeSlots: a.freeSlots,
            }));
          return { rebookingOptions: filtered };
        },
      },
    };

    const { handlers, compensator } = createRuntimeHandlers(runtimeDeps);
    const executor = new GraphExecutor(handlers, this.graphRepo, compensator);
    const graph = buildDoctorEmergencyLeaveGraph();
    assertValidGraph(graph);

    const initialState = {
      appointmentId: appointment.id,
      customerRef,
      customerName: appointment.customer_name,
      doctorName: resource.name,
      resourceId: resource.id,
      startsAt: appointment.starts_at,
      feeAmount,
      currency: 'INR',
      cancelInput: {
        appointmentId: appointment.id,
        customerRef,
        reason: `Doctor Emergency Leave: ${resource.name} (${leaveReason})`,
      },
      refundInput: {
        customerRef,
        appointmentId: appointment.id,
        amount: feeAmount,
        currency: 'INR',
        reason: `Refund for cancelled appointment with ${resource.name} (${leaveReason})`,
        mandateId: params.mandateId,
      },
      language: language || 'en',
    };

    const runResult = await executor.start(graph, initialState);

    // If parked at human gate (T3 over-limit refund)
    if (runResult.status === 'parked') {
      // Escalate to Attention Center (WP-4.6)
      const item = await this.attentionService.escalateToHuman({
        correlationId: runResult.runId,
        customerId: customerRef,
        sourceAgentId: 'scheduling',
        priority: 'P1_HIGH',
        reasonCategory: 'financial_threshold',
        title: `Approval Required: Refund ₹${feeAmount} for ${resource.name} Emergency Leave`,
        description: `Patient ${appointment.customer_name || customerRef} appointment at ${appointment.starts_at} was cancelled due to emergency leave. Refund amount of ₹${feeAmount} exceeds autonomous mandate limit.`,
        assignedRole: 'billing_manager',
        branchId: branchId || 'branch_main',
        financialValueUsd: feeAmount,
        contextData: {
          runId: runResult.runId,
          appointmentId: appointment.id,
          customerRef,
          feeAmount,
          resourceId: resource.id,
          reasonCategory: 'approval_gate',
        },
      });

      return {
        appointmentId: appointment.id,
        customerRef,
        customerName: appointment.customer_name,
        originalSlot: appointment.starts_at,
        feeAmount,
        status: 'parked_for_approval',
        runId: runResult.runId,
        requiresHumanApproval: true,
        attentionItemId: item.id,
        cancellationReceiptId: (runResult.state.receipt_cancel as { id?: string })?.id,
      };
    }

    // Auto-resolved under mandate (T2)
    const rebookingOptions = (runResult.state.rebookingOptions as RebookingOption[]) || [];
    const notification = DoctorEmergencyLeaveWorkflow.composeNotification(
      appointment.customer_name,
      resource.name,
      appointment.starts_at,
      feeAmount,
      rebookingOptions,
      language
    );

    return {
      appointmentId: appointment.id,
      customerRef,
      customerName: appointment.customer_name,
      originalSlot: appointment.starts_at,
      feeAmount,
      status: runResult.outcome === 'verified' ? 'verified' : 'escalated',
      runId: runResult.runId,
      cancellationReceiptId: (runResult.state.receipt_cancel as { id?: string })?.id,
      refundReceiptId: (runResult.state.receipt_refund as { id?: string })?.id,
      refundId: (runResult.state.action_refund as { result?: { refundId?: string } })?.result?.refundId,
      rebookingOptions,
      notificationText: notification,
    };
  }

  /**
   * Resumes a parked run when a human operator approves the over-limit refund.
   */
  public async approveOverLimitRefund(params: {
    runId: string;
    humanApproverId: string;
    attentionItemId?: string;
    language?: string;
  }): Promise<PatientResolution> {
    const { runId, humanApproverId, attentionItemId, language } = params;

    // Resolve attention item if provided
    if (attentionItemId) {
      await this.attentionService.resolveItem(attentionItemId, {
        action: 'approved',
        notes: `Approved by human operator ${humanApproverId}. Authorizing refund.`,
      });
    }

    const runtimeDeps: RuntimeDeps = {
      agentSlug: 'scheduling',
      agentVersion: '1.0.0',
      policyEngine: this.policyEngine,
      mandateService: this.mandateService,
      proofService: this.proofService,
      toolGateway: this.toolGateway,
      toolRegistry: this.toolRegistry,
      dbClient: this.client,
      rules: {
        find_rebooking_options: async (state) => {
          const resourceId = String(state.resourceId);
          const res = await this.book.resource(resourceId);
          const sameDay = String(state.startsAt).slice(0, 10);
          const alts = await this.book.availability(sameDay, { department: res?.department ?? undefined });
          const filtered = alts
            .filter((a) => a.resourceId !== resourceId && a.freeSlots.length > 0)
            .map((a) => ({
              resourceId: a.resourceId,
              doctorName: a.name,
              department: a.department,
              date: sameDay,
              freeSlots: a.freeSlots,
            }));
          return { rebookingOptions: filtered };
        },
      },
    };

    const { handlers, compensator } = createRuntimeHandlers(runtimeDeps);
    const executor = new GraphExecutor(handlers, this.graphRepo, compensator);

    const existingRun = await this.graphRepo.getRun(runId);
    const existingState = existingRun ? JSON.parse(existingRun.state_json) : {};
    const existingRefundInput = (existingState.refundInput as Record<string, unknown>) || {};

    const resumed: RunResult = await executor.resume(runId, {
      approval: { decision: 'approved', by: humanApproverId },
      refundInput: { ...existingRefundInput, humanApproverId },
    });

    const state = resumed.state;
    const rebookingOptions = (state.rebookingOptions as RebookingOption[]) || [];
    const notification = DoctorEmergencyLeaveWorkflow.composeNotification(
      (state.customerName as string) ?? null,
      String(state.doctorName),
      String(state.startsAt),
      Number(state.feeAmount),
      rebookingOptions,
      language || (state.language as string) || 'en'
    );

    return {
      appointmentId: String(state.appointmentId),
      customerRef: String(state.customerRef),
      customerName: (state.customerName as string) || null,
      originalSlot: String(state.startsAt),
      feeAmount: Number(state.feeAmount),
      status: resumed.outcome === 'verified' ? 'verified' : 'escalated',
      runId: resumed.runId,
      cancellationReceiptId: (state.receipt_cancel as { id?: string })?.id,
      refundReceiptId: (state.receipt_refund as { id?: string })?.id,
      refundId: (state.action_refund as { result?: { refundId?: string } })?.result?.refundId,
      requiresHumanApproval: false,
      rebookingOptions,
      notificationText: notification,
    };
  }

  /**
   * Resumes a parked run when a human operator rejects the refund request.
   */
  public async rejectOverLimitRefund(params: {
    runId: string;
    humanApproverId: string;
    reason?: string;
    attentionItemId?: string;
  }): Promise<PatientResolution> {
    const { runId, humanApproverId, reason, attentionItemId } = params;

    if (attentionItemId) {
      await this.attentionService.resolveItem(attentionItemId, {
        action: 'rejected',
        notes: `Rejected by human operator ${humanApproverId}: ${reason || 'Refund rejected.'}`,
      });
    }

    const runtimeDeps: RuntimeDeps = {
      agentSlug: 'scheduling',
      agentVersion: '1.0.0',
      policyEngine: this.policyEngine,
      mandateService: this.mandateService,
      proofService: this.proofService,
      toolGateway: this.toolGateway,
      toolRegistry: this.toolRegistry,
      dbClient: this.client,
    };

    const { handlers, compensator } = createRuntimeHandlers(runtimeDeps);
    const executor = new GraphExecutor(handlers, this.graphRepo, compensator);

    const resumed = await executor.resume(runId, {
      approval: { decision: 'rejected', by: humanApproverId, reason },
    });

    const state = resumed.state;
    return {
      appointmentId: String(state.appointmentId),
      customerRef: String(state.customerRef),
      customerName: (state.customerName as string) || null,
      originalSlot: String(state.startsAt),
      feeAmount: Number(state.feeAmount),
      status: 'escalated',
      runId: resumed.runId,
      cancellationReceiptId: (state.receipt_cancel as { id?: string })?.id,
      requiresHumanApproval: false,
    };
  }

  /**
   * Full end-to-end execution of the Doctor Emergency Leave workflow across all affected appointments.
   */
  public async executeWorkflow(input: EmergencyLeaveInput): Promise<EmergencyLeaveExecutionReport> {
    const { resource, leaveStart, leaveEnd, reason, affected } = await this.detectAndFindAffected(input);

    const leaveId = `dlev_${CryptoUtils.generateId()}`;
    const now = new Date().toISOString();

    // Record emergency leave in repository
    await this.client.execute(
      `INSERT INTO doctor_emergency_leaves (id, tenant_id, resource_id, doctor_name, leave_start, leave_end, reason, status, affected_count, resolved_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, 0, ?, ?)`,
      [leaveId, this.tenant(), resource.id, resource.name, leaveStart, leaveEnd, reason, affected.length, now, now]
    );

    const resolutions: PatientResolution[] = [];
    let autoResolved = 0;
    let parked = 0;
    let totalRefunds = 0;

    for (const appt of affected) {
      const res = await this.processAffectedAppointment({
        appointment: appt,
        resource,
        leaveReason: reason,
        mandateId: input.mandateId,
        branchId: input.branchId,
        language: input.defaultCustomerLanguage,
      });

      resolutions.push(res);
      if (res.status === 'verified') {
        autoResolved++;
        totalRefunds += res.feeAmount;
      } else if (res.status === 'parked_for_approval') {
        parked++;
      }
    }

    // Phase 5: Verification Agent Settlement Verification Read-Back Job (WP-4.6, WP-3.4)
    // Create an async verification job confirming that all affected slots are released and refunded
    const verJob = await this.verificationService.createJob({
      idempotencyKey: `ver_dlev_${leaveId}`,
      runId: `run_${leaveId}`,
      toolSlug: 'schedule_find_slots',
      actionInput: {
        date: leaveStart.slice(0, 10),
        doctor: resource.name,
      },
      actionOutput: {
        leaveId,
        cancelledCount: affected.length,
      },
      deadlineMinutes: 5,
    });

    // Verification check read-back: confirm that the doctor has 0 confirmed appointments remaining in the leave window
    const remainingConfirmed = await this.book.forResource(resource.id, leaveStart, leaveEnd);
    const verificationStatus = remainingConfirmed.length === 0 ? 'verified' : 'mismatch';

    await this.client.execute(
      `UPDATE doctor_emergency_leaves SET resolved_count = ?, status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`,
      [autoResolved, parked === 0 ? 'completed' : 'active', new Date().toISOString(), leaveId, this.tenant()]
    );

    return {
      leaveId,
      resourceId: resource.id,
      doctorName: resource.name,
      leaveStart,
      leaveEnd,
      reason,
      totalAffected: affected.length,
      autoResolvedCount: autoResolved,
      parkedCount: parked,
      totalRefundAmount: totalRefunds,
      resolutions,
      verificationJobId: verJob.id,
      verificationStatus,
      completedAt: new Date().toISOString(),
    };
  }
}
