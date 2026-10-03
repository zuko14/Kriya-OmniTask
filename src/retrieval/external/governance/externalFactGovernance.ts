/**
 * Kriya Omnitask — External Fact Governance & Conflict Resolution Engine (§10.2, §10.4)
 * Enforces Trust Ladder action justification rules and System of Record supremacy.
 *
 * HARD RULES (§10.2, §10.4):
 * 1. External facts (Tier C/D/E) CANNOT solely justify a HIGH or CRITICAL action.
 * 2. An external fact conflicting with a system of record (Tier A) raises an Attention Item;
 *    the system of record WINS, always.
 */

import { RiskTier } from '../../../agents/types/agentTypes.js';
import {
  ActionJustificationResult,
  ExternalEvidenceItem,
  ExternalFactRecord,
  SystemOfRecordConflictEvaluation,
  TrustTier,
} from '../types/externalRetrievalTypes.js';
import { AttentionRepository } from '../../../attention/repositories/attentionRepository.js';
import { auditLogger } from '../../../security/audit/auditLogger.js';
import { logger } from '../../../core/logger/logger.js';
import { TenantContextManager } from '../../../core/context/tenantContext.js';

export class ExternalFactGovernance {
  private attentionRepo: AttentionRepository;

  constructor(attentionRepo?: AttentionRepository) {
    this.attentionRepo = attentionRepo || new AttentionRepository();
  }

  /**
   * Evaluates if a set of supporting evidence facts is sufficient to justify an action at actionRiskTier (§10.2).
   *
   * RULE:
   * HIGH and CRITICAL actions require authoritative Tier A (System of Record) or Tier B (Tenant Knowledge)
   * corroboration. They CANNOT be executed solely on Tier C (External), Tier D (Open Web), or Tier E (Recall).
   */
  public static validateActionJustification(
    actionRiskTier: RiskTier,
    evidenceList: ExternalEvidenceItem[]
  ): ActionJustificationResult {
    const tiersPresent = Array.from(new Set(evidenceList.map((e) => e.trustTier)));

    // LOW and MEDIUM actions can proceed with supporting Tier C/D/E evidence
    if (actionRiskTier === 'LOW' || actionRiskTier === 'MEDIUM') {
      return {
        permitted: true,
        actionRiskTier,
        requiresHumanApproval: false,
        supportingTiersPresent: tiersPresent,
      };
    }

    // HIGH and CRITICAL actions REQUIRE Tier A or Tier B evidence
    const hasAuthoritativeCorroboration = tiersPresent.some(
      (t) => t === 'TIER_A' || t === 'TIER_B'
    );

    if (!hasAuthoritativeCorroboration) {
      const reason = `Action rejected: Risk tier is '${actionRiskTier}', but evidence consists solely of unauthoritative sources (${tiersPresent.join(', ')}). External facts cannot solely justify a HIGH or CRITICAL action without Tier A/B corroboration (§10.2).`;
      return {
        permitted: false,
        actionRiskTier,
        reason,
        requiresHumanApproval: true,
        supportingTiersPresent: tiersPresent,
      };
    }

    return {
      permitted: true,
      actionRiskTier,
      requiresHumanApproval: false,
      supportingTiersPresent: tiersPresent,
    };
  }

  /**
   * Resolves conflicts between external retrieved facts and internal System of Record (Tier A) values (§10.2).
   *
   * RULE:
   * The System of Record (Tier A) ALWAYS wins.
   * The conflict is raised as an Attention Item in the Human Attention Center and logged to audit.
   */
  public async evaluateConflictWithSystemOfRecord(
    tenantId: string,
    params: {
      fieldName: string;
      externalFact: { value?: unknown; sourceUrl: string; trustTier: TrustTier; citation: string };
      systemOfRecordFact: { value?: unknown; sourceName: string; trustTier: 'TIER_A' };
      agentSlug: string;
      correlationId: string;
      taskId?: string;
    }
  ): Promise<SystemOfRecordConflictEvaluation> {
    const extValStr = JSON.stringify(params.externalFact.value);
    const sorValStr = JSON.stringify(params.systemOfRecordFact.value);

    const hasConflict = extValStr !== sorValStr;

    if (!hasConflict) {
      return {
        hasConflict: false,
        winningValue: params.systemOfRecordFact.value,
        rejectedValue: params.externalFact.value,
        sourceOfTruth: 'system_of_record',
        attentionItemCreated: false,
        description: `External data matches System of Record for field '${params.fieldName}'.`,
      };
    }

    const description = `Data Conflict Detected on field '${params.fieldName}': System of Record (${params.systemOfRecordFact.sourceName}) value is '${sorValStr}', whereas external source (${params.externalFact.sourceUrl}) states '${extValStr}'. System of Record prevailed per §10.2.`;

    logger.warn(description, { tenantId, fieldName: params.fieldName, correlationId: params.correlationId });

    // 1. Create Attention Item for Human Operator Review (§10.2)
    const slaExpiresAt = new Date(Date.now() + 3600 * 1000).toISOString();
    const attentionItem = await TenantContextManager.withTenant(tenantId, 'default', async () => {
      return this.attentionRepo.createItem(
        {
          correlationId: params.correlationId,
          title: `External Data Conflict: ${params.fieldName}`,
          description,
          reasonCategory: 'agent_disagreement',
          sourceAgentId: params.agentSlug,
          channel: 'system',
          contextData: {
            fieldName: params.fieldName,
            systemOfRecord: params.systemOfRecordFact,
            externalFact: params.externalFact,
            taskId: params.taskId,
          },
          recommendedAction: `Verify if System of Record (${params.systemOfRecordFact.sourceName}) requires an update, or confirm external fact is inaccurate.`,
        },
        'P1_HIGH',
        slaExpiresAt
      );
    });

    // 2. Log Immutable Audit Ledger Event
    await auditLogger.logEvent({
      action: 'external_retrieval.sor_conflict_raised',
      resourceType: 'attention_item',
      resourceId: attentionItem.id,
      details: {
        tenantId,
        fieldName: params.fieldName,
        winningValue: params.systemOfRecordFact.value,
        rejectedValue: params.externalFact.value,
        sourceUrl: params.externalFact.sourceUrl,
        attentionItemId: attentionItem.id,
        correlationId: params.correlationId,
      },
    });

    return {
      hasConflict: true,
      winningValue: params.systemOfRecordFact.value,
      rejectedValue: params.externalFact.value,
      sourceOfTruth: 'system_of_record',
      attentionItemCreated: true,
      attentionItemId: attentionItem.id,
      description,
    };
  }
}
