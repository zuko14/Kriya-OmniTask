/**
 * Kriya Omnitask — Proactive Compactor Engine (§8.4, §23)
 * Triggers proactive context compaction at 60–70% window utilization.
 * Enforces structured schema-validated extraction (Tier 1) and verification before discarding raw turns.
 * If extraction or verification fails, aborts compaction immediately and escalates to Attention.
 */

import { SessionRepository } from '../repositories/sessionRepository.js';
import { AttentionRepository } from '../../attention/repositories/attentionRepository.js';
import { auditLogger } from '../../security/audit/auditLogger.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import { logger } from '../../core/logger/logger.js';
import {
  CompactionResult,
  Tier1SessionState,
  Tier1SessionStateSchema,
  SessionEntity,
  SessionDecision,
  SessionCommitment,
  SessionOpenItem,
} from '../types/contextTypes.js';

export interface ExtractorFunction {
  (turnsText: string, existingState: Tier1SessionState): Promise<{
    entities: Record<string, unknown>;
    decisions: SessionDecision[];
    commitments: SessionCommitment[];
    openItems: SessionOpenItem[];
    rollingSummary: string;
  }>;
}

export class ProactiveCompactor {
  private sessionRepo: SessionRepository;
  private attentionRepo: AttentionRepository;
  private customExtractor?: ExtractorFunction;

  constructor(sessionRepo?: SessionRepository, attentionRepo?: AttentionRepository) {
    this.sessionRepo = sessionRepo || new SessionRepository();
    this.attentionRepo = attentionRepo || new AttentionRepository();
  }

  /**
   * Allows setting a custom extractor (for testing or model-backed extraction).
   */
  public setCustomExtractor(extractor?: ExtractorFunction): void {
    this.customExtractor = extractor;
  }

  /**
   * Deterministic default extractor for structured session state.
   */
  private async defaultExtract(
    turnsText: string,
    existingState: Tier1SessionState
  ): Promise<{
    entities: Record<string, unknown>;
    decisions: SessionDecision[];
    commitments: SessionCommitment[];
    openItems: SessionOpenItem[];
    rollingSummary: string;
  }> {
    const now = new Date().toISOString();
    const entities = { ...existingState.entities };
    const decisions = [...existingState.decisions];
    const commitments = [...existingState.commitments];
    const openItems = [...existingState.openItems];

    // Simple deterministic extraction patterns
    const lines = turnsText.split('\n');
    for (const line of lines) {
      // Extract named entities (e.g. "Order #12345", "Phone: +919876543210")
      const orderMatch = line.match(/order\s*#?([A-Za-z0-9_-]+)/i);
      if (orderMatch) {
        entities['last_order_id'] = orderMatch[1];
      }
      const vehicleMatch = line.match(/vehicle\s*[:#]?\s*([A-Za-z0-9 -]+)/i);
      if (vehicleMatch) {
        entities['vehicle_model'] = vehicleMatch[1].trim();
      }
      const itemMatch = line.match(/item\s*[:#]?\s*([A-Za-z0-9 -]+)/i);
      if (itemMatch) {
        entities['item_name'] = itemMatch[1].trim();
      }

      // Extract decisions
      if (line.toLowerCase().includes('agreed') || line.toLowerCase().includes('confirmed') || line.toLowerCase().includes('selected')) {
        decisions.push({
          id: `dec-${decisions.length + 1}`,
          decision: line.trim(),
          agreedBy: line.toLowerCase().startsWith('customer') ? 'customer' : 'agent',
          decidedAt: now,
        });
      }

      // Extract commitments
      if (line.toLowerCase().includes('will call') || line.toLowerCase().includes('will deliver') || line.toLowerCase().includes('promise') || line.toLowerCase().includes('scheduled')) {
        commitments.push({
          id: `com-${commitments.length + 1}`,
          commitment: line.trim(),
          committedParty: line.toLowerCase().startsWith('agent') ? 'agent' : 'customer',
          status: 'pending',
          createdAt: now,
        });
      }

      // Extract open items
      if (line.includes('?') && (line.toLowerCase().includes('waiting') || line.toLowerCase().includes('pending') || line.toLowerCase().includes('please provide'))) {
        openItems.push({
          id: `open-${openItems.length + 1}`,
          questionOrNeed: line.trim(),
          assignedTo: 'customer',
          priority: 'MEDIUM',
          status: 'open',
          createdAt: now,
        });
      }
    }

    const rollingSummary = `[Summary of ${lines.length} compacted interactions]: Customer interacted regarding ${Object.keys(entities).join(', ') || 'inquiries'}. ${decisions.length} decisions logged, ${commitments.length} commitments active.`;

    return {
      entities,
      decisions,
      commitments,
      openItems,
      rollingSummary,
    };
  }

  /**
   * Executes proactive compaction on a session (§8.4).
   */
  public async compactSession(params: {
    sessionId: string;
    tenantId: string;
    force?: boolean;
  }): Promise<CompactionResult> {
    const { sessionId, tenantId, force } = params;
    const now = new Date().toISOString();

    const session = await this.sessionRepo.findSessionById(sessionId, tenantId);
    if (!session) {
      throw new Error(`Session '${sessionId}' not found for tenant '${tenantId}'`);
    }

    const budgetPolicy = await this.sessionRepo.getBudgetPolicy(tenantId);
    const uncompactedTurns = await this.sessionRepo.listTurns(sessionId, tenantId, { uncompactedOnly: true });

    // Calculate token consumption of uncompacted turns
    let initialTokens = uncompactedTurns.reduce((acc, t) => acc + (t.tokensPrompt + t.tokensCompletion || Math.ceil(t.content.length / 4)), 0);
    const utilizationPct = (initialTokens / budgetPolicy.taskTokenBudget) * 100;

    // Proactive compaction check: trigger if utilization exceeds 60-70% (default 65%) or if forced (§8.4)
    if (!force && utilizationPct < budgetPolicy.compactionThresholdPct) {
      return {
        sessionId,
        success: true,
        status: 'no_compaction_needed',
        initialTokens,
        compactedTokens: initialTokens,
        tokensSaved: 0,
        extractedEntitiesCount: 0,
        extractedDecisionsCount: 0,
        extractedCommitmentsCount: 0,
        extractedOpenItemsCount: 0,
        turnsCompactedCount: 0,
        rollingSummary: session.rolling_summary,
        compactedAt: now,
      };
    }

    if (uncompactedTurns.length === 0) {
      return {
        sessionId,
        success: true,
        status: 'no_compaction_needed',
        initialTokens: 0,
        compactedTokens: 0,
        tokensSaved: 0,
        extractedEntitiesCount: 0,
        extractedDecisionsCount: 0,
        extractedCommitmentsCount: 0,
        extractedOpenItemsCount: 0,
        turnsCompactedCount: 0,
        rollingSummary: session.rolling_summary,
        compactedAt: now,
      };
    }

    // Keep the most recent 2 turns in working context, compact the rest
    const turnsToCompact = uncompactedTurns.length > 2 ? uncompactedTurns.slice(0, uncompactedTurns.length - 2) : uncompactedTurns;
    const turnsText = turnsToCompact.map((t) => `${t.speaker.toUpperCase()}: ${t.content}`).join('\n');

    // Retrieve or initialize existing Tier 1 Session State
    let existingState = await this.sessionRepo.getSessionState(sessionId, tenantId);
    if (!existingState) {
      existingState = {
        sessionId,
        tenantId,
        entities: {},
        decisions: [],
        commitments: [],
        openItems: [],
        version: 1,
        extractedAt: now,
      };
    }

    // STEP 1: EXTRACT & STEP 2: VERIFY (§8.4)
    let extractedPayload: {
      entities: Record<string, unknown>;
      decisions: SessionDecision[];
      commitments: SessionCommitment[];
      openItems: SessionOpenItem[];
      rollingSummary: string;
    };

    try {
      if (this.customExtractor) {
        extractedPayload = await this.customExtractor(turnsText, existingState);
      } else {
        extractedPayload = await this.defaultExtract(turnsText, existingState);
      }

      // Explicit Schema Verification (Cannot be skipped!)
      const candidateState: Tier1SessionState = {
        sessionId,
        tenantId,
        entities: extractedPayload.entities,
        decisions: extractedPayload.decisions,
        commitments: extractedPayload.commitments,
        openItems: extractedPayload.openItems,
        version: existingState.version + 1,
        extractedAt: now,
      };

      // Throws if validation fails
      Tier1SessionStateSchema.parse(candidateState);

      // Persist verified Tier 1 Session State
      await this.sessionRepo.saveSessionState(candidateState);
    } catch (err: any) {
      // CRITICAL HARD RULE (§8.4): If extraction or verification fails, abort compaction and escalate!
      // NEVER discard raw context assuming extraction worked.
      const errorMsg = `Proactive Compaction extraction verification failed: ${err.message || err}. Compaction aborted; 0 raw turns discarded.`;
      logger.error(errorMsg, { sessionId, tenantId });

      await TenantContextManager.withTenant(tenantId, 'default', async () => {
        const slaExpiresAt = new Date(Date.now() + 3600 * 1000).toISOString();
        await this.attentionRepo.createItem(
          {
            correlationId: TenantContextManager.getCorrelationId(),
            title: 'Context Compaction Extraction Failure',
            description: `Proactive compaction extraction failed for session '${sessionId}'. Full raw transcript preserved in Tier 3 archive.`,
            reasonCategory: 'workflow_suspended',
            sourceAgentId: 'system_compactor',
            channel: 'web',
            contextData: {
              sessionId,
              tenantId,
              error: err.message || String(err),
              uncompactedTurnsCount: uncompactedTurns.length,
            },
            recommendedAction: 'Review raw conversation transcript in Tier 3 archive and manually resolve customer intent',
          },
          'P1_HIGH',
          slaExpiresAt
        );

        await auditLogger.logEvent({
          action: 'context.compaction.aborted_escalated',
          resourceType: 'session',
          resourceId: sessionId,
          details: { error: err.message, turnsPreserved: uncompactedTurns.length },
        });
      }, { userId: 'system_compactor', roles: ['system', 'operator'] });

      return {
        sessionId,
        success: false,
        status: 'aborted_escalated',
        initialTokens,
        compactedTokens: initialTokens,
        tokensSaved: 0,
        extractedEntitiesCount: 0,
        extractedDecisionsCount: 0,
        extractedCommitmentsCount: 0,
        extractedOpenItemsCount: 0,
        turnsCompactedCount: 0,
        rollingSummary: session.rolling_summary,
        escalationReason: errorMsg,
        compactedAt: now,
      };
    }

    // STEP 3: SUMMARIZE (§8.4)
    const combinedSummary = session.rolling_summary
      ? `${session.rolling_summary}\n${extractedPayload.rollingSummary}`
      : extractedPayload.rollingSummary;

    // STEP 4: DISCARD (§8.4)
    // Mark compacted turns in DB (Tier 3 keeps raw transcript, but working context drops them)
    const turnIdsToCompact = turnsToCompact.map((t) => t.id);
    await this.sessionRepo.markTurnsCompacted(sessionId, tenantId, turnIdsToCompact);

    // Update Session record
    await this.sessionRepo.updateSession(sessionId, tenantId, {
      rollingSummary: combinedSummary,
      status: 'compacted',
      lastCompactedAt: now,
    });

    const tokensCompacted = turnsToCompact.reduce((acc, t) => acc + (t.tokensPrompt + t.tokensCompletion || Math.ceil(t.content.length / 4)), 0);
    const summaryTokens = Math.ceil(combinedSummary.length / 4);
    const tokensSaved = Math.max(0, tokensCompacted - summaryTokens);

    await TenantContextManager.withTenant(tenantId, 'default', async () => {
      await auditLogger.logEvent({
        action: 'context.compaction.completed',
        resourceType: 'session',
        resourceId: sessionId,
        details: {
          turnsCompactedCount: turnsToCompact.length,
          tokensCompacted,
          tokensSaved,
          extractedEntitiesCount: Object.keys(extractedPayload.entities).length,
        },
      });
    }, { userId: 'system_compactor', roles: ['system', 'operator'] });

    return {
      sessionId,
      success: true,
      status: 'compacted',
      initialTokens,
      compactedTokens: initialTokens - tokensSaved,
      tokensSaved,
      extractedEntitiesCount: Object.keys(extractedPayload.entities).length,
      extractedDecisionsCount: extractedPayload.decisions.length,
      extractedCommitmentsCount: extractedPayload.commitments.length,
      extractedOpenItemsCount: extractedPayload.openItems.length,
      turnsCompactedCount: turnsToCompact.length,
      rollingSummary: combinedSummary,
      compactedAt: now,
    };
  }
}
