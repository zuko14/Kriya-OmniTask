/**
 * Kriya AI — Customer 360 View & Governance Service
 * Synthesizes customer profiles, timeline, identities, consent, and privacy rights (§10, §21, §26 of CLAUDE.md).
 */

import { CustomerRepository, CustomerRecord, LifecycleStage } from '../repositories/customerRepository.js';
import { IdentityRepository, CustomerIdentityRecord } from '../repositories/identityRepository.js';
import { TimelineRepository, TimelineEventRecord } from '../repositories/timelineRepository.js';
import { ConsentRepository, CustomerConsentRecord, ConsentType } from '../repositories/consentRepository.js';
import { auditLogger } from '../../security/audit/auditLogger.js';

export interface Customer360View {
  profile: CustomerRecord;
  identities: CustomerIdentityRecord[];
  timeline: TimelineEventRecord[];
  consents: CustomerConsentRecord[];
  signals: {
    sentiment: number;
    churnRisk: number;
    lifecycleStage: LifecycleStage;
    totalInteractions: number;
    preferredChannel: string;
    preferredLanguage: string;
  };
}

export interface CustomerExportPackage {
  customer: CustomerRecord;
  identities: CustomerIdentityRecord[];
  timeline: TimelineEventRecord[];
  consents: CustomerConsentRecord[];
  exportedAt: string;
}

export class Customer360Service {
  private customerRepo: CustomerRepository;
  private identityRepo: IdentityRepository;
  private timelineRepo: TimelineRepository;
  private consentRepo: ConsentRepository;

  constructor(
    customerRepo?: CustomerRepository,
    identityRepo?: IdentityRepository,
    timelineRepo?: TimelineRepository,
    consentRepo?: ConsentRepository
  ) {
    this.customerRepo = customerRepo || new CustomerRepository();
    this.identityRepo = identityRepo || new IdentityRepository();
    this.timelineRepo = timelineRepo || new TimelineRepository();
    this.consentRepo = consentRepo || new ConsentRepository();
  }

  /**
   * Retrieves the full 360 profile and contextual signals for a customer.
   */
  public async getCustomer360(customerId: string): Promise<Customer360View> {
    const profile = await this.customerRepo.getById(customerId);
    const identities = await this.identityRepo.listForCustomer(customerId);
    const timeline = await this.timelineRepo.getTimeline(customerId, { limit: 50 });
    const consents = await this.consentRepo.listForCustomer(customerId);

    return {
      profile,
      identities,
      timeline,
      consents,
      signals: {
        sentiment: profile.sentiment_score,
        churnRisk: profile.churn_risk_score,
        lifecycleStage: profile.lifecycle_stage,
        totalInteractions: timeline.length,
        preferredChannel: profile.preferred_channel,
        preferredLanguage: profile.preferred_language,
      },
    };
  }

  /**
   * Verifies if marketing or automated outreach is permitted for this customer on a given channel.
   */
  public async canCommunicate(
    customerId: string,
    channel: 'whatsapp' | 'voice' | 'email'
  ): Promise<{ allowed: boolean; reason?: string }> {
    let consentType: ConsentType = 'data_processing';
    if (channel === 'whatsapp') consentType = 'whatsapp_marketing';
    else if (channel === 'voice') consentType = 'voice_calls';
    else if (channel === 'email') consentType = 'email_newsletter';

    const consent = await this.consentRepo.getConsent(customerId, consentType);
    if (consent && consent.status === 'revoked') {
      return {
        allowed: false,
        reason: `Explicit opt-out recorded for ${consentType} at ${consent.revoked_at}`,
      };
    }

    return { allowed: true };
  }

  /**
   * Updates customer signals and records a timeline event.
   */
  public async recordInteraction(params: {
    customerId: string;
    channel: 'whatsapp' | 'voice' | 'email' | 'web' | 'crm' | 'system';
    eventType: string;
    summary: string;
    details?: Record<string, unknown>;
    sentimentScore?: number;
    lifecycleStage?: LifecycleStage;
    actorType?: 'agent' | 'customer' | 'human_operator' | 'system';
    actorId?: string;
  }): Promise<TimelineEventRecord> {
    const event = await this.timelineRepo.appendEvent({
      customerId: params.customerId,
      channel: params.channel,
      eventType: params.eventType,
      summary: params.summary,
      details: params.details,
      actorType: params.actorType,
      actorId: params.actorId,
    });

    if (params.sentimentScore !== undefined || params.lifecycleStage !== undefined) {
      await this.customerRepo.updateSignals(params.customerId, {
        sentimentScore: params.sentimentScore,
        lifecycleStage: params.lifecycleStage,
      });
    }

    return event;
  }

  /**
   * GDPR / DPDP Article 15 Data Portability & Access export.
   */
  public async exportCustomerData(customerId: string): Promise<CustomerExportPackage> {
    const data = await this.getCustomer360(customerId);
    await auditLogger.logEvent({
      action: 'customer.data_exported',
      resourceType: 'customer',
      resourceId: customerId,
      details: { exportTime: new Date().toISOString() },
    });

    return {
      customer: data.profile,
      identities: data.identities,
      timeline: data.timeline,
      consents: data.consents,
      exportedAt: new Date().toISOString(),
    };
  }

  /**
   * GDPR / DPDP Article 17 Right to Erasure (Anonymization).
   */
  public async forgetCustomer(customerId: string, reason: string): Promise<void> {
    const customer = await this.customerRepo.getById(customerId);
    await this.customerRepo.anonymize(customer.id);

    await this.timelineRepo.appendEvent({
      customerId,
      channel: 'system',
      eventType: 'customer.anonymized',
      summary: 'Customer PII anonymized pursuant to GDPR/DPDP Right to be Forgotten',
      details: { reason },
    });

    await auditLogger.logEvent({
      action: 'customer.anonymized',
      resourceType: 'customer',
      resourceId: customerId,
      details: { reason },
    });
  }
}
