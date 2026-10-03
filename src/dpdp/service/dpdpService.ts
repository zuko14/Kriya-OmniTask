/**
 * Kriya AI — India DPDP Act 2023 Operations Service
 * Comprehensive compliance engine: purpose-bound consent ledger,
 * Data Principal Subject Access Requests (SAR §11-§14),
 * automated retention purges (§8(7)), and DPBI breach notifications (§8(6)).
 */

import { DatabaseClient, db } from '../../storage/db.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import { CryptoUtils } from '../../core/utils/crypto.js';
import { NotFoundError, ValidationError, TenantIsolationError } from '../../core/errors/errors.js';
import { auditLogger } from '../../security/audit/auditLogger.js';
import { ProofService, SignedReceipt } from '../../trust/proof/proofService.js';
import { Customer360Service, CustomerExportPackage } from '../../customer360/services/customer360Service.js';
import { CustomerRepository } from '../../customer360/repositories/customerRepository.js';
import { ConsentRepository, ConsentType } from '../../customer360/repositories/consentRepository.js';
import { DpdpRepository } from '../repositories/dpdpRepository.js';
import {
  DpdpConsentRecord,
  GrantConsentInput,
  GrantConsentInputSchema,
  WithdrawConsentInput,
  WithdrawConsentInputSchema,
  DpdpRightsRequestRecord,
  SubmitRightsRequestInput,
  SubmitRightsRequestInputSchema,
  ExecuteRightsRequestInput,
  ExecuteRightsRequestInputSchema,
  DpdpRetentionJobRecord,
  ExecuteRetentionJobInput,
  ExecuteRetentionJobInputSchema,
  DpdpBreachIncidentRecord,
  ReportBreachIncidentInput,
  ReportBreachIncidentInputSchema,
  DpbiNotificationPackage,
  DpdpRequestStatus,
  DpdpRequestType,
} from '../types/dpdpTypes.js';

export class DpdpService {
  private repository: DpdpRepository;
  private customer360Service: Customer360Service;
  private customerRepo: CustomerRepository;
  private consentRepo: ConsentRepository;
  private proofService: ProofService;
  private customClient?: DatabaseClient;

  constructor(
    repository?: DpdpRepository,
    customer360Service?: Customer360Service,
    proofService?: ProofService,
    client?: DatabaseClient
  ) {
    this.customClient = client;
    this.repository = repository || new DpdpRepository(client);
    this.customer360Service = customer360Service || new Customer360Service();
    this.customerRepo = new CustomerRepository(client);
    this.consentRepo = new ConsentRepository(client);
    this.proofService = proofService || new ProofService(client);
  }

  private get client(): DatabaseClient {
    return this.customClient || db.getClient();
  }

  private getTenantId(): string {
    const tenantId = TenantContextManager.getTenantId();
    if (!tenantId) {
      throw new TenantIsolationError('Tenant context missing for DPDP service');
    }
    return tenantId;
  }

  // ==========================================
  // 1. Consent Ledger (§6, §7 DPDP Act 2023)
  // ==========================================

  /**
   * Records affirmative, purpose-bound, versioned consent with cryptographic proof receipt.
   */
  public async grantConsent(
    input: GrantConsentInput
  ): Promise<{ consent: DpdpConsentRecord; receipt: SignedReceipt }> {
    const data = GrantConsentInputSchema.parse(input);
    const tenantId = this.getTenantId();
    const consentId = `cst_${CryptoUtils.generateId()}`;
    const now = new Date().toISOString();

    // 1. Compute deterministic notice hash
    const rawNotice =
      data.noticeContent || data.noticeHash || `${data.purpose}:${data.noticeVersion}:${data.language}`;
    const noticeHash = CryptoUtils.hashSha256(rawNotice);

    // 2. Mark any prior active consent for this customer and purpose as superseded
    await this.repository.supersedePriorConsents(data.customerId, data.purpose);

    // 3. Issue Ed25519-signed proof receipt
    const receipt = await this.proofService.issue({
      actionType: 'dpdp.consent.grant',
      riskTier: 'TIER_1',
      actor: { agentSlug: 'dpdp-consent-manager' },
      target: { system: 'dpdp_consent_ledger', externalRef: consentId },
      verification: { method: 'sha256_hash_check', state: 'verified' },
      input: {
        customerId: data.customerId,
        purpose: data.purpose,
        noticeVersion: data.noticeVersion,
        noticeHash,
        language: data.language,
      },
      output: { status: 'granted', validUntil: data.validUntil ?? null },
    });

    // 4. Persist to dpdp_consent_ledger
    const record: DpdpConsentRecord = {
      id: consentId,
      tenant_id: tenantId,
      customer_id: data.customerId,
      purpose: data.purpose,
      status: 'granted',
      notice_version: data.noticeVersion || 'v1.0',
      notice_hash: noticeHash,
      language: data.language || 'en',
      valid_until: data.validUntil ?? null,
      proof_receipt_id: receipt.body.receiptId,
      withdrawn_at: null,
      withdrawn_reason: null,
      created_at: now,
      updated_at: now,
    };

    const consent = await this.repository.createConsent(record);

    // 5. Sync to legacy Customer 360 consent table if matching purpose
    const mappedTypes: Record<string, ConsentType> = {
      whatsapp_marketing: 'whatsapp_marketing',
      voice_calls: 'voice_calls',
      email_newsletter: 'email_newsletter',
      data_processing: 'data_processing',
    };
    if (mappedTypes[data.purpose]) {
      await this.consentRepo.setConsent({
        customerId: data.customerId,
        consentType: mappedTypes[data.purpose],
        status: 'granted',
        source: `dpdp_notice_${data.noticeVersion || 'v1.0'}`,
      });
    }

    // 6. Audit logging
    await auditLogger.logEvent({
      action: 'dpdp.consent.granted',
      resourceType: 'dpdp_consent_ledger',
      resourceId: consentId,
      details: {
        customerId: data.customerId,
        purpose: data.purpose,
        noticeHash,
        proofReceiptId: receipt.body.receiptId,
      },
    });

    return { consent, receipt };
  }

  /**
   * Withdraws previously granted consent (§6(4) DPDP Act 2023).
   */
  public async withdrawConsent(
    input: WithdrawConsentInput
  ): Promise<{ consent: DpdpConsentRecord; receipt: SignedReceipt }> {
    const data = WithdrawConsentInputSchema.parse(input);
    let targetConsent: DpdpConsentRecord | null = null;

    if (data.consentId) {
      targetConsent = await this.repository.getConsentById(data.consentId);
    } else if (data.purpose) {
      targetConsent = await this.repository.getActiveConsent(data.customerId, data.purpose);
    }

    if (!targetConsent) {
      throw new NotFoundError(
        `Active consent not found for customer ${data.customerId}${data.purpose ? ` and purpose ${data.purpose}` : ''}`
      );
    }

    // 1. Issue cryptographic proof receipt for withdrawal
    const receipt = await this.proofService.issue({
      actionType: 'dpdp.consent.withdraw',
      riskTier: 'TIER_1',
      actor: { agentSlug: 'dpdp-consent-manager' },
      target: { system: 'dpdp_consent_ledger', externalRef: targetConsent.id },
      verification: { method: 'withdrawal_affirmation', state: 'verified' },
      input: {
        customerId: data.customerId,
        consentId: targetConsent.id,
        reason: data.reason,
      },
      output: { status: 'withdrawn' },
    });

    // 2. Update consent ledger status
    await this.repository.updateConsentStatus(
      targetConsent.id,
      'withdrawn',
      data.reason,
      receipt.body.receiptId
    );

    const updated = await this.repository.getConsentById(targetConsent.id);

    // 3. Sync to legacy Customer 360 consent table if applicable
    const mappedTypes: Record<string, ConsentType> = {
      whatsapp_marketing: 'whatsapp_marketing',
      voice_calls: 'voice_calls',
      email_newsletter: 'email_newsletter',
      data_processing: 'data_processing',
    };
    if (mappedTypes[targetConsent.purpose]) {
      await this.consentRepo.setConsent({
        customerId: data.customerId,
        consentType: mappedTypes[targetConsent.purpose],
        status: 'revoked',
        source: 'dpdp_withdrawal',
      });
    }

    // 4. Audit logging
    await auditLogger.logEvent({
      action: 'dpdp.consent.withdrawn',
      resourceType: 'dpdp_consent_ledger',
      resourceId: targetConsent.id,
      details: {
        customerId: data.customerId,
        purpose: targetConsent.purpose,
        reason: data.reason,
        proofReceiptId: receipt.body.receiptId,
      },
    });

    return { consent: updated!, receipt };
  }

  public async getActiveConsent(customerId: string, purpose: string): Promise<DpdpConsentRecord | null> {
    return this.repository.getActiveConsent(customerId, purpose);
  }

  public async listConsentHistory(customerId: string): Promise<DpdpConsentRecord[]> {
    return this.repository.listConsentsForCustomer(customerId);
  }

  // ==========================================
  // 2. Data Principal Rights Requests (SAR §11 - §14)
  // ==========================================

  /**
   * Submits a formal Data Principal Subject Access Request (SAR).
   * Automatically calculates statutory SLA (e.g. 72 hours for Grievance Redressal §13).
   */
  public async submitRightsRequest(
    input: SubmitRightsRequestInput
  ): Promise<DpdpRightsRequestRecord> {
    const data = SubmitRightsRequestInputSchema.parse(input);
    const tenantId = this.getTenantId();
    const requestId = `sar_${CryptoUtils.generateId()}`;
    const now = new Date();

    // Default SLA: 72 hours for grievance redressal (§13), 168 hours (7 days) for others
    const slaHours = data.customSlaHours || (data.requestType === 'grievance' ? 72 : 168);
    const slaExpiresAt = new Date(now.getTime() + slaHours * 3600 * 1000).toISOString();

    const record: DpdpRightsRequestRecord = {
      id: requestId,
      tenant_id: tenantId,
      customer_id: data.customerId,
      request_type: data.requestType,
      status: 'submitted',
      payload_json: JSON.stringify(data.payload || {}),
      resolution_notes: null,
      erasure_tombstone_hash: null,
      proof_receipt_id: null,
      sla_expires_at: slaExpiresAt,
      completed_at: null,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    };

    const saved = await this.repository.createRightsRequest(record);

    await auditLogger.logEvent({
      action: 'dpdp.sar.submitted',
      resourceType: 'dpdp_rights_requests',
      resourceId: requestId,
      details: {
        customerId: data.customerId,
        requestType: data.requestType,
        slaExpiresAt,
      },
    });

    return saved;
  }

  public async getRightsRequest(requestId: string): Promise<DpdpRightsRequestRecord> {
    const req = await this.repository.getRightsRequestById(requestId);
    if (!req) {
      throw new NotFoundError(`Rights request ${requestId} not found`);
    }
    return req;
  }

  public async listRightsRequests(filters?: {
    customerId?: string;
    status?: DpdpRequestStatus;
    requestType?: DpdpRequestType;
  }): Promise<DpdpRightsRequestRecord[]> {
    return this.repository.listRightsRequests(filters);
  }

  /**
   * Executes a Data Principal Rights Request with complete cryptographic verification.
   * Handles:
   * - 'access': Generates full CustomerExportPackage and issues access proof receipt.
   * - 'erasure': Calls Customer360 forgetCustomer, computes irreversible tombstone hash, issues erasure proof receipt.
   * - 'correction': Updates customer profile/identity attributes and issues correction proof receipt.
   * - 'grievance': Records resolution notes within 72h SLA and issues grievance resolution receipt.
   * - 'nominee': Registers nominee data and issues nominee registration receipt.
   */
  public async executeRightsRequest(
    input: ExecuteRightsRequestInput
  ): Promise<{
    request: DpdpRightsRequestRecord;
    exportData?: CustomerExportPackage;
    receipt: SignedReceipt;
  }> {
    const data = ExecuteRightsRequestInputSchema.parse(input);
    const request = await this.getRightsRequest(data.requestId);

    let exportData: CustomerExportPackage | undefined;
    let erasureTombstoneHash: string | undefined;
    let receipt: SignedReceipt;

    switch (request.request_type) {
      case 'access': {
        // §11 Right to Access
        exportData = await this.customer360Service.exportCustomerData(request.customer_id);
        receipt = await this.proofService.issue({
          actionType: 'dpdp.data_principal.access',
          riskTier: 'TIER_1',
          actor: { agentSlug: 'dpdp-sar-officer' },
          target: { system: 'customer_360', externalRef: request.customer_id },
          verification: { method: 'data_portability_export', state: 'verified' },
          input: { requestId: request.id, customerId: request.customer_id },
          output: { exportedAt: exportData.exportedAt },
        });
        break;
      }

      case 'erasure': {
        // §12 Right to Erasure / Right to be Forgotten
        const nowIso = new Date().toISOString();
        erasureTombstoneHash = CryptoUtils.hashSha256(
          JSON.stringify({
            tenantId: request.tenant_id,
            customerId: request.customer_id,
            erasedAt: nowIso,
            reason: data.erasureReason,
          })
        );

        // Anonymize and delete customer PII across Customer360
        await this.customer360Service.forgetCustomer(
          request.customer_id,
          data.erasureReason || 'Data Principal DPDP Right to Erasure'
        );

        receipt = await this.proofService.issue({
          actionType: 'dpdp.data_principal.erasure',
          riskTier: 'TIER_3',
          actor: { agentSlug: 'dpdp-privacy-officer' },
          target: { system: 'customers', externalRef: request.customer_id },
          verification: { method: 'tombstone_hash_verification', state: 'verified' },
          input: {
            requestId: request.id,
            customerId: request.customer_id,
            reason: data.erasureReason,
          },
          output: { erasureTombstoneHash, status: 'erased' },
        });
        break;
      }

      case 'correction': {
        // §12 Right to Correction
        if (data.correctionUpdates && Object.keys(data.correctionUpdates).length > 0) {
          await this.customerRepo.updateCustomer(request.customer_id, data.correctionUpdates);
        }

        receipt = await this.proofService.issue({
          actionType: 'dpdp.data_principal.correction',
          riskTier: 'TIER_2',
          actor: { agentSlug: 'dpdp-sar-officer' },
          target: { system: 'customers', externalRef: request.customer_id },
          verification: { method: 'attribute_update', state: 'verified' },
          input: { requestId: request.id, updates: data.correctionUpdates },
          output: { status: 'corrected' },
        });
        break;
      }

      case 'grievance': {
        // §13 Grievance Redressal
        receipt = await this.proofService.issue({
          actionType: 'dpdp.grievance.resolved',
          riskTier: 'TIER_2',
          actor: { agentSlug: 'dpdp-grievance-officer' },
          target: { system: 'dpdp_rights_requests', externalRef: request.id },
          verification: { method: 'grievance_adjudication', state: 'verified' },
          input: { requestId: request.id, resolutionNotes: data.resolutionNotes },
          output: { status: 'resolved' },
        });
        break;
      }

      case 'nominee': {
        // §14 Right to Nominate
        receipt = await this.proofService.issue({
          actionType: 'dpdp.nominee.registered',
          riskTier: 'TIER_2',
          actor: { agentSlug: 'dpdp-sar-officer' },
          target: { system: 'dpdp_rights_requests', externalRef: request.id },
          verification: { method: 'nominee_affirmation', state: 'verified' },
          input: { requestId: request.id, notes: data.resolutionNotes },
          output: { status: 'registered' },
        });
        break;
      }

      default:
        throw new ValidationError(`Unsupported rights request type: ${(request as any).request_type}`);
    }

    // Update rights request to completed
    await this.repository.updateRightsRequest(request.id, {
      status: 'completed',
      resolutionNotes: data.resolutionNotes,
      erasureTombstoneHash: erasureTombstoneHash ?? undefined,
      proofReceiptId: receipt.body.receiptId,
      completedAt: new Date().toISOString(),
    });

    const updated = await this.getRightsRequest(request.id);

    await auditLogger.logEvent({
      action: 'dpdp.sar.completed',
      resourceType: 'dpdp_rights_requests',
      resourceId: request.id,
      details: {
        requestType: request.request_type,
        proofReceiptId: receipt.body.receiptId,
        erasureTombstoneHash,
      },
    });

    return { request: updated, exportData, receipt };
  }

  // ==========================================
  // 3. Automated Data Retention & Purge (§8(7))
  // ==========================================

  /**
   * Executes automated data retention purge job pursuant to §8(7) DPDP Act 2023.
   * Records scanned & purged counts and issues cryptographic receipt.
   */
  public async runRetentionPurge(
    input: ExecuteRetentionJobInput
  ): Promise<{ job: DpdpRetentionJobRecord; receipt: SignedReceipt }> {
    const data = ExecuteRetentionJobInputSchema.parse(input);
    const tenantId = this.getTenantId();
    const jobId = `purge_${CryptoUtils.generateId()}`;
    const now = new Date();
    const cutoffTimestamp = new Date(now.getTime() - data.retentionDays * 86400000).toISOString();

    // 1. Initialize job in pending state
    const jobRecord: DpdpRetentionJobRecord = {
      id: jobId,
      tenant_id: tenantId,
      policy_id: data.policyId ?? null,
      target_resource_type: data.targetResourceType,
      retention_days: data.retentionDays,
      cutoff_timestamp: cutoffTimestamp,
      records_scanned: 0,
      records_purged: 0,
      purge_action: data.purgeAction,
      status: 'running',
      proof_receipt_id: null,
      executed_at: now.toISOString(),
      created_at: now.toISOString(),
    };

    await this.repository.createRetentionJob(jobRecord);

    let recordsScanned = 0;
    let recordsPurged = 0;

    try {
      if (data.targetResourceType === 'customer_pii' || data.targetResourceType === 'customers') {
        // Purge inactive/archived customers older than cutoff
        const oldCustomers = await this.client.query<{ id: string }>(
          `SELECT id FROM customers WHERE tenant_id = ? AND updated_at < ?;`,
          [tenantId, cutoffTimestamp]
        );
        recordsScanned = oldCustomers.length;

        for (const cust of oldCustomers) {
          if (data.purgeAction === 'anonymize') {
            await this.customerRepo.anonymize(cust.id);
            recordsPurged++;
          } else {
            await this.client.execute('DELETE FROM customer_identities WHERE customer_id = ?;', [cust.id]);
            await this.client.execute('DELETE FROM customer_timeline_events WHERE customer_id = ?;', [cust.id]);
            await this.client.execute('DELETE FROM customers WHERE id = ? AND tenant_id = ?;', [cust.id, tenantId]);
            recordsPurged++;
          }
        }
      } else if (
        data.targetResourceType === 'ephemeral_chat_logs' ||
        data.targetResourceType === 'timeline_events'
      ) {
        const events = await this.client.query<{ id: string }>(
          `SELECT ct.id FROM customer_timeline_events ct
           JOIN customers c ON ct.customer_id = c.id
           WHERE c.tenant_id = ? AND ct.created_at < ?;`,
          [tenantId, cutoffTimestamp]
        );
        recordsScanned = events.length;

        if (recordsScanned > 0) {
          await this.client.execute(
            `DELETE FROM customer_timeline_events WHERE id IN (
              SELECT ct.id FROM customer_timeline_events ct
              JOIN customers c ON ct.customer_id = c.id
              WHERE c.tenant_id = ? AND ct.created_at < ?
            );`,
            [tenantId, cutoffTimestamp]
          );
          recordsPurged = recordsScanned;
        }
      } else {
        // General resource scanning
        recordsScanned = 0;
        recordsPurged = 0;
      }

      // 2. Issue Proof Receipt
      const receipt = await this.proofService.issue({
        actionType: 'dpdp.retention.purge',
        riskTier: 'TIER_3',
        actor: { agentSlug: 'dpdp-retention-worker' },
        target: { system: data.targetResourceType, externalRef: jobId },
        verification: { method: 'retention_cutoff_execution', state: 'verified' },
        input: {
          targetResourceType: data.targetResourceType,
          retentionDays: data.retentionDays,
          cutoffTimestamp,
          purgeAction: data.purgeAction,
        },
        output: { recordsScanned, recordsPurged, status: 'completed' },
      });

      // 3. Mark job completed
      await this.repository.updateRetentionJob(jobId, {
        status: 'completed',
        recordsScanned,
        recordsPurged,
        proofReceiptId: receipt.body.receiptId,
      });

      const completedJob = await this.repository.getRetentionJobById(jobId);

      await auditLogger.logEvent({
        action: 'dpdp.retention.completed',
        resourceType: 'dpdp_retention_jobs',
        resourceId: jobId,
        details: {
          targetResourceType: data.targetResourceType,
          recordsScanned,
          recordsPurged,
          proofReceiptId: receipt.body.receiptId,
        },
      });

      return { job: completedJob!, receipt };
    } catch (err: any) {
      await this.repository.updateRetentionJob(jobId, {
        status: 'failed',
        recordsScanned,
        recordsPurged,
      });
      throw err;
    }
  }

  public async listRetentionJobs(limit = 50): Promise<DpdpRetentionJobRecord[]> {
    return this.repository.listRetentionJobs(limit);
  }

  // ==========================================
  // 4. Breach Incident Governance (§8(6))
  // ==========================================

  /**
   * Reports personal data breach incident pursuant to §8(6) DPDP Act 2023.
   * Automatically prepares DPBI notification package for High/Critical incidents.
   */
  public async reportBreachIncident(
    input: ReportBreachIncidentInput
  ): Promise<{
    incident: DpdpBreachIncidentRecord;
    dpbiPackage?: DpbiNotificationPackage;
    receipt: SignedReceipt;
  }> {
    const data = ReportBreachIncidentInputSchema.parse(input);
    const tenantId = this.getTenantId();
    const incidentId = `brch_${CryptoUtils.generateId()}`;
    const year = new Date().getFullYear();
    const dpbiReferenceNumber = `DPBI-${year}-${CryptoUtils.generateId().slice(0, 8).toUpperCase()}`;
    const now = new Date().toISOString();

    const isHighOrCritical = data.severity === 'CRITICAL' || data.severity === 'HIGH';

    const record: DpdpBreachIncidentRecord = {
      id: incidentId,
      tenant_id: tenantId,
      incident_name: data.incidentName,
      severity: data.severity,
      breach_type: data.breachType,
      status: 'detected',
      affected_principals_count: data.affectedPrincipalsCount,
      incident_summary: data.incidentSummary,
      root_cause: data.rootCause ?? null,
      remediation_steps: data.remediationSteps ?? null,
      dpbi_notified_at: isHighOrCritical ? now : null,
      dpbi_reference_number: dpbiReferenceNumber,
      principals_notified_at: null,
      dpo_contact: data.dpoContact,
      created_at: now,
      updated_at: now,
    };

    const incident = await this.repository.createBreachIncident(record);

    // Issue cryptographic proof receipt
    const receipt = await this.proofService.issue({
      actionType: 'dpdp.breach.incident_reported',
      riskTier: 'TIER_3',
      actor: { agentSlug: 'dpdp-breach-response-team' },
      target: { system: 'dpdp_breach_incidents', externalRef: incidentId },
      verification: { method: 'dpbi_statutory_intimation', state: 'verified' },
      input: {
        incidentId,
        severity: data.severity,
        breachType: data.breachType,
        affectedPrincipalsCount: data.affectedPrincipalsCount,
      },
      output: { dpbiReferenceNumber, status: 'detected' },
    });

    let dpbiPackage: DpbiNotificationPackage | undefined;
    if (isHighOrCritical) {
      dpbiPackage = await this.generateDpbiNotificationPackage(incidentId);
    }

    await auditLogger.logEvent({
      action: 'dpdp.breach.reported',
      resourceType: 'dpdp_breach_incidents',
      resourceId: incidentId,
      details: {
        severity: data.severity,
        breachType: data.breachType,
        dpbiReferenceNumber,
        affectedCount: data.affectedPrincipalsCount,
      },
    });

    return { incident, dpbiPackage, receipt };
  }

  public async getBreachIncident(incidentId: string): Promise<DpdpBreachIncidentRecord> {
    const inc = await this.repository.getBreachIncidentById(incidentId);
    if (!inc) {
      throw new NotFoundError(`Breach incident ${incidentId} not found`);
    }
    return inc;
  }

  public async listBreachIncidents(): Promise<DpdpBreachIncidentRecord[]> {
    return this.repository.listBreachIncidents();
  }

  /**
   * Generates formal statutory DPBI intimation package under Section 8(6) DPDP Act 2023.
   */
  public async generateDpbiNotificationPackage(incidentId: string): Promise<DpbiNotificationPackage> {
    const incident = await this.getBreachIncident(incidentId);

    const subject = `Urgent: Personal Data Breach Notification [${incident.dpbi_reference_number}]`;
    const bodyMarkdown = `
## Notice of Personal Data Breach
**To:** Affected Data Principal  
**Reference:** ${incident.dpbi_reference_number}  
**Date of Notice:** ${new Date().toISOString()}  

### 1. What Happened
We regret to inform you that our security monitoring systems detected a personal data security incident (${incident.breach_type}) on ${incident.created_at}.
**Summary:** ${incident.incident_summary}

### 2. Actions Taken
Our incident response and data protection teams immediately took containment measures:
${incident.remediation_steps || 'Systems isolated, credentials rotated, and enhanced monitoring activated.'}

### 3. Recommendations for You
- Review your account activity for any unfamiliar transactions or actions.
- Rotate credentials if applicable.

### 4. Data Protection Officer (DPO) Contact
If you have any questions or require grievance redressal under Section 13 of the Digital Personal Data Protection Act, 2023, contact our DPO:  
**Email:** ${incident.dpo_contact}
    `.trim();

    return {
      incidentId: incident.id,
      incidentName: incident.incident_name,
      dpbiReferenceNumber: incident.dpbi_reference_number || 'PENDING',
      severity: incident.severity,
      breachType: incident.breach_type,
      affectedPrincipalsCount: incident.affected_principals_count,
      incidentSummary: incident.incident_summary,
      rootCause: incident.root_cause || 'Under technical forensic investigation',
      remediationSteps: incident.remediation_steps || 'Immediate containment and firewall hardening executed',
      dpoContact: incident.dpo_contact,
      intimationTimestamp: incident.dpbi_notified_at || new Date().toISOString(),
      statutoryFramework: 'Digital Personal Data Protection Act, 2023 (DPDP Act) §8(6)',
      affectedPrincipalNotificationTemplate: {
        subject,
        bodyMarkdown,
      },
    };
  }

  /**
   * Marks affected data principals as notified.
   */
  public async markPrincipalsNotified(incidentId: string): Promise<DpdpBreachIncidentRecord> {
    const incident = await this.getBreachIncident(incidentId);
    const now = new Date().toISOString();

    await this.repository.updateBreachIncident(incident.id, {
      status: 'notified',
      principals_notified_at: now,
    });

    return this.getBreachIncident(incident.id);
  }
}
