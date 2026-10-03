/**
 * Kriya AI — Deterministic Entity Resolution Engine
 * Resolves customer identities across channels (WhatsApp, Voice, Email, CRM, Web)
 * with explainable matching logic (§9 of CLAUDE.md).
 */

import { CustomerRepository, CustomerRecord } from '../repositories/customerRepository.js';
import { IdentityRepository, CustomerIdentityRecord } from '../repositories/identityRepository.js';
import { TimelineRepository } from '../repositories/timelineRepository.js';
import { auditLogger } from '../../security/audit/auditLogger.js';

export interface IdentityPayload {
  email?: string;
  phone?: string;
  whatsappId?: string;
  externalCrmId?: string;
  nationalId?: string;
  fullName?: string;
  preferredLanguage?: string;
  preferredChannel?: 'whatsapp' | 'voice' | 'email' | 'web';
  source: string;
}

export interface ResolutionResult {
  customer: CustomerRecord;
  isNew: boolean;
  matchType: 'exact_email' | 'exact_phone' | 'exact_whatsapp' | 'exact_crm' | 'alias_match' | 'new_profile';
  confidence: number;
  explanation: string;
  registeredIdentities: CustomerIdentityRecord[];
}

export class EntityResolutionService {
  private customerRepo: CustomerRepository;
  private identityRepo: IdentityRepository;
  private timelineRepo: TimelineRepository;

  constructor(
    customerRepo?: CustomerRepository,
    identityRepo?: IdentityRepository,
    timelineRepo?: TimelineRepository
  ) {
    this.customerRepo = customerRepo || new CustomerRepository();
    this.identityRepo = identityRepo || new IdentityRepository();
    this.timelineRepo = timelineRepo || new TimelineRepository();
  }

  /**
   * Normalizes an email address.
   */
  public static normalizeEmail(email?: string): string | undefined {
    if (!email) return undefined;
    const clean = email.toLowerCase().trim();
    return clean.includes('@') ? clean : undefined;
  }

  /**
   * Normalizes a phone number to standard digits with leading +.
   */
  public static normalizePhone(phone?: string): string | undefined {
    if (!phone) return undefined;
    const clean = phone.replace(/[^0-9+]/g, '');
    if (clean.length < 7) return undefined;
    return clean.startsWith('+') ? clean : `+${clean}`;
  }

  /**
   * Deterministically resolves or provisions a Customer 360 profile.
   */
  public async resolve(payload: IdentityPayload): Promise<ResolutionResult> {
    const email = EntityResolutionService.normalizeEmail(payload.email);
    const phone = EntityResolutionService.normalizePhone(payload.phone);
    const whatsappId = payload.whatsappId ? payload.whatsappId.trim() : phone;
    const crmId = payload.externalCrmId?.trim();

    let matchedCustomer: CustomerRecord | null = null;
    let matchType: ResolutionResult['matchType'] = 'new_profile';
    let explanation = 'No prior identity match found. Initialized new Customer 360 record.';

    // 1. Check CRM ID
    if (crmId) {
      const idMatch = await this.identityRepo.findIdentity('crm_id', crmId);
      if (idMatch) {
        matchedCustomer = await this.customerRepo.findById(idMatch.customer_id);
        if (matchedCustomer) {
          matchType = 'exact_crm';
          explanation = `Matched existing customer via exact external CRM ID: ${crmId}`;
        }
      }
    }

    // 2. Check WhatsApp ID / Phone
    if (!matchedCustomer && whatsappId) {
      const idMatch = await this.identityRepo.findIdentity('whatsapp_id', whatsappId);
      if (idMatch) {
        matchedCustomer = await this.customerRepo.findById(idMatch.customer_id);
        if (matchedCustomer) {
          matchType = 'exact_whatsapp';
          explanation = `Matched existing customer via WhatsApp ID: ${whatsappId}`;
        }
      }
    }

    // 3. Check Phone
    if (!matchedCustomer && phone) {
      const idMatch = await this.identityRepo.findIdentity('phone', phone);
      if (idMatch) {
        matchedCustomer = await this.customerRepo.findById(idMatch.customer_id);
        if (matchedCustomer) {
          matchType = 'exact_phone';
          explanation = `Matched existing customer via normalized E.164 phone: ${phone}`;
        }
      }
    }

    // 4. Check Email
    if (!matchedCustomer && email) {
      const idMatch = await this.identityRepo.findIdentity('email', email);
      if (idMatch) {
        matchedCustomer = await this.customerRepo.findById(idMatch.customer_id);
        if (matchedCustomer) {
          matchType = 'exact_email';
          explanation = `Matched existing customer via verified email address: ${email}`;
        }
      }
    }

    const isNew = !matchedCustomer;

    // If new, create customer record
    if (!matchedCustomer) {
      matchedCustomer = await this.customerRepo.create({
        full_name: payload.fullName || (email ? email.split('@')[0] : 'Guest Customer'),
        primary_email: email,
        primary_phone: phone,
        external_crm_id: crmId,
        preferred_language: payload.preferredLanguage || 'en',
        preferred_channel: payload.preferredChannel || (whatsappId ? 'whatsapp' : 'email'),
        lifecycle_stage: 'lead',
        sentiment_score: 0.0,
        churn_risk_score: 0.0,
        attributes_json: '{}',
        status: 'active',
      });

      await this.timelineRepo.appendEvent({
        customerId: matchedCustomer.id,
        channel: payload.preferredChannel || 'system',
        eventType: 'customer.created',
        summary: `Customer 360 profile created via ${payload.source}`,
        details: { explanation },
      });
    }

    // Register all incoming identifiers to the resolved customer
    const registered: CustomerIdentityRecord[] = [];

    if (email) {
      registered.push(
        await this.identityRepo.registerIdentity({
          customerId: matchedCustomer.id,
          identityType: 'email',
          identityValue: email,
          isVerified: true,
          source: payload.source,
        })
      );
    }

    if (phone) {
      registered.push(
        await this.identityRepo.registerIdentity({
          customerId: matchedCustomer.id,
          identityType: 'phone',
          identityValue: phone,
          isVerified: true,
          source: payload.source,
        })
      );
    }

    if (whatsappId) {
      registered.push(
        await this.identityRepo.registerIdentity({
          customerId: matchedCustomer.id,
          identityType: 'whatsapp_id',
          identityValue: whatsappId,
          isVerified: true,
          source: payload.source,
        })
      );
    }

    if (crmId) {
      registered.push(
        await this.identityRepo.registerIdentity({
          customerId: matchedCustomer.id,
          identityType: 'crm_id',
          identityValue: crmId,
          isVerified: true,
          source: payload.source,
        })
      );
    }

    return {
      customer: matchedCustomer,
      isNew,
      matchType,
      confidence: 1.0,
      explanation,
      registeredIdentities: registered,
    };
  }

  /**
   * Merges a source customer record into a target customer record with complete data repointing and audit explanation.
   */
  public async mergeCustomers(params: {
    sourceCustomerId: string;
    targetCustomerId: string;
    reason: string;
  }): Promise<CustomerRecord> {
    const source = await this.customerRepo.getById(params.sourceCustomerId);
    const target = await this.customerRepo.getById(params.targetCustomerId);

    // Repoint identities from source to target
    const sourceIdentities = await this.identityRepo.listForCustomer(source.id);
    for (const ident of sourceIdentities) {
      await this.identityRepo.registerIdentity({
        customerId: target.id,
        identityType: ident.identity_type,
        identityValue: ident.identity_value,
        isVerified: ident.is_verified === 1,
        confidence: ident.confidence,
        source: `merge_from_${source.id}`,
      });
    }

    // Mark source customer as merged
    await this.customerRepo.update(source.id, {
      status: 'merged',
      merged_into_id: target.id,
    });

    // Record timeline events for both records
    await this.timelineRepo.appendEvent({
      customerId: target.id,
      channel: 'system',
      eventType: 'customer.merged',
      summary: `Merged data from customer ${source.id} (${source.full_name})`,
      details: { sourceId: source.id, reason: params.reason },
    });

    await auditLogger.logEvent({
      action: 'customer.merged',
      resourceType: 'customer',
      resourceId: target.id,
      details: { sourceCustomerId: source.id, targetCustomerId: target.id, reason: params.reason },
    });

    return (await this.customerRepo.findById(target.id))!;
  }
}
