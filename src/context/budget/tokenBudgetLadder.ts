/**
 * Kriya Omnitask — Token Budget Ladder & Gateway Enforcer (§8.5, §23)
 * Enforces per-tenant, per-session, and per-task token consumption budgets
 * against the authoritative 70% warn -> 85% optimize -> 95% restrict -> 100% stop ladder.
 */

import { SessionRepository } from '../repositories/sessionRepository.js';
import { AttentionRepository } from '../../attention/repositories/attentionRepository.js';
import { auditLogger } from '../../security/audit/auditLogger.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import { logger } from '../../core/logger/logger.js';
import {
  TokenBudgetEvaluation,
  TokenBudgetPolicy,
  BudgetLadderStage,
} from '../types/contextTypes.js';

export class TokenBudgetLadder {
  private sessionRepo: SessionRepository;
  private attentionRepo: AttentionRepository;

  constructor(sessionRepo?: SessionRepository, attentionRepo?: AttentionRepository) {
    this.sessionRepo = sessionRepo || new SessionRepository();
    this.attentionRepo = attentionRepo || new AttentionRepository();
  }

  /**
   * Evaluates token utilization against the 70/85/95/100 threshold ladder (§8.5).
   */
  public evaluateLadder(
    allocatedBudgetTokens: number,
    currentTokens: number,
    policy?: TokenBudgetPolicy
  ): {
    stage: BudgetLadderStage;
    utilizationPct: number;
    action: TokenBudgetEvaluation['action'];
    message: string;
  } {
    const utilizationPct = Number(((currentTokens / allocatedBudgetTokens) * 100).toFixed(1));

    const warnThreshold = policy?.warnThresholdPct || 70.0;
    const optimizeThreshold = policy?.optimizeThresholdPct || 85.0;
    const restrictThreshold = policy?.restrictThresholdPct || 95.0;
    const stopThreshold = policy?.stopThresholdPct || 100.0;

    if (utilizationPct >= stopThreshold) {
      return {
        stage: 'stop',
        utilizationPct,
        action: 'circuit_break_stop',
        message: `Token budget 100% cap exceeded (${utilizationPct}%). Gateway execution halted to prevent runaway token spend.`,
      };
    }

    if (utilizationPct >= restrictThreshold) {
      return {
        stage: 'restrict',
        utilizationPct,
        action: 'restrict_critical_only',
        message: `Token budget 95% restrict threshold reached (${utilizationPct}%). Non-critical delegations and verbose outputs restricted.`,
      };
    }

    if (utilizationPct >= optimizeThreshold) {
      return {
        stage: 'optimize',
        utilizationPct,
        action: 'optimize_drop_layer7',
        message: `Token budget 85% optimize threshold reached (${utilizationPct}%). Dropping Layer 7 summary and truncating non-essential turns.`,
      };
    }

    if (utilizationPct >= warnThreshold) {
      return {
        stage: 'warn',
        utilizationPct,
        action: 'warn_compact',
        message: `Token budget 70% warn threshold reached (${utilizationPct}%). Proactive compaction recommended.`,
      };
    }

    return {
      stage: 'normal',
      utilizationPct,
      action: 'proceed',
      message: `Token budget utilization is healthy (${utilizationPct}%).`,
    };
  }

  /**
   * Enforces token budget on a live session before or after an execution step.
   */
  public async evaluateSessionBudget(params: {
    sessionId: string;
    tenantId: string;
    estimatedTokensToAdd?: number;
  }): Promise<TokenBudgetEvaluation> {
    const { sessionId, tenantId, estimatedTokensToAdd = 0 } = params;

    const session = await this.sessionRepo.findSessionById(sessionId, tenantId);
    if (!session) {
      throw new Error(`Session '${sessionId}' not found.`);
    }

    const policy = await this.sessionRepo.getBudgetPolicy(tenantId);
    const currentTokens = session.total_tokens_spent + estimatedTokensToAdd;

    const evalResult = this.evaluateLadder(policy.sessionTokenBudget, currentTokens, policy);

    // If threshold reached, log warning or raise attention
    if (evalResult.stage === 'stop') {
      logger.error(`Token budget circuit breaker tripped for session '${sessionId}': ${evalResult.message}`, {
        tenantId,
        sessionId,
        currentTokens,
      });

      await TenantContextManager.withTenant(tenantId, 'default', async () => {
        const slaExpiresAt = new Date(Date.now() + 1800 * 1000).toISOString();
        await this.attentionRepo.createItem(
          {
            correlationId: TenantContextManager.getCorrelationId(),
            title: 'Session Token Budget 100% Cap Breached',
            description: `Session '${sessionId}' consumed ${currentTokens} tokens (100% of ${policy.sessionTokenBudget}). Execution stopped.`,
            reasonCategory: 'policy_violation',
            sourceAgentId: 'token_gateway',
            channel: 'web',
            contextData: { sessionId, currentTokens, policy },
            recommendedAction: 'Adjust tenant token budget quota or archive session to resume execution',
          },
          'P0_CRITICAL',
          slaExpiresAt
        );

        await auditLogger.logEvent({
          action: 'token.budget.circuit_break_tripped',
          resourceType: 'session',
          resourceId: sessionId,
          details: { currentTokens, budget: policy.sessionTokenBudget, utilizationPct: evalResult.utilizationPct },
        });
      }, { userId: 'token_gateway', roles: ['system', 'operator'] });
    } else if (evalResult.stage === 'warn' || evalResult.stage === 'optimize' || evalResult.stage === 'restrict') {
      logger.warn(`Token budget threshold [${evalResult.stage.toUpperCase()}] reached for session '${sessionId}': ${evalResult.message}`);
    }

    return {
      tenantId,
      sessionId,
      allocatedBudgetTokens: policy.sessionTokenBudget,
      currentConsumedTokens: currentTokens,
      utilizationPct: evalResult.utilizationPct,
      stage: evalResult.stage,
      action: evalResult.action,
      message: evalResult.message,
    };
  }
}
