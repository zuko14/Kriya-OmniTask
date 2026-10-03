/**
 * Kriya Omnitask — Per-Language Token & Cost Tracker (§8.6, §23)
 * Tracks tokenization efficiency multipliers and financial spend per conversation separately per language.
 */

import { SessionRepository } from '../repositories/sessionRepository.js';
import {
  INDIC_TOKEN_MULTIPLIERS,
  USD_TO_INR_RATE,
  LanguageCostRecord,
} from '../types/contextTypes.js';

export class LanguageCostTracker {
  private sessionRepo: SessionRepository;

  constructor(sessionRepo?: SessionRepository) {
    this.sessionRepo = sessionRepo || new SessionRepository();
  }

  /**
   * Computes financial cost (USD and INR) for token consumption in a specific language.
   * Standard blended inference rate: $1.00 per 1M prompt tokens, $4.00 per 1M completion tokens.
   */
  public computeCost(
    language: string,
    promptTokens: number,
    completionTokens: number,
    baseRatePer1M = { promptUsd: 1.0, completionUsd: 4.0 }
  ): {
    costUsd: number;
    costInr: number;
    multiplier: number;
  } {
    const multiplier = INDIC_TOKEN_MULTIPLIERS[language] || 1.0;

    const promptCost = (promptTokens / 1_000_000) * baseRatePer1M.promptUsd;
    const completionCost = (completionTokens / 1_000_000) * baseRatePer1M.completionUsd;
    const costUsd = Number((promptCost + completionCost).toFixed(6));
    const costInr = Number((costUsd * USD_TO_INR_RATE).toFixed(4));

    return {
      costUsd,
      costInr,
      multiplier,
    };
  }

  /**
   * Records language-specific token usage and financial cost for a conversation session.
   */
  public async trackTurnCost(params: {
    tenantId: string;
    sessionId: string;
    language: string;
    promptTokens: number;
    completionTokens: number;
  }): Promise<LanguageCostRecord> {
    const { tenantId, sessionId, language, promptTokens, completionTokens } = params;

    const { costUsd, costInr } = this.computeCost(language, promptTokens, completionTokens);

    // 1. Record language-specific ledger entry
    const record = await this.sessionRepo.recordLanguageCost({
      tenantId,
      sessionId,
      language,
      promptTokens,
      completionTokens,
      costUsd,
      costInr,
    });

    // 2. Update conversation session aggregate tokens and costs
    await this.sessionRepo.updateSession(sessionId, tenantId, {
      promptTokensDelta: promptTokens,
      completionTokensDelta: completionTokens,
      costUsdDelta: costUsd,
      costInrDelta: costInr,
    });

    return record;
  }

  /**
   * Retrieves full breakdown of costs by language for a given conversation session.
   */
  public async getSessionLanguageCostBreakdown(
    sessionId: string,
    tenantId: string
  ): Promise<{
    sessionId: string;
    totalCostUsd: number;
    totalCostInr: number;
    languages: LanguageCostRecord[];
  }> {
    const records = await this.sessionRepo.getLanguageCosts(sessionId, tenantId);
    const totalCostUsd = Number(records.reduce((acc, r) => acc + r.costUsd, 0).toFixed(6));
    const totalCostInr = Number(records.reduce((acc, r) => acc + r.costInr, 0).toFixed(4));

    return {
      sessionId,
      totalCostUsd,
      totalCostInr,
      languages: records,
    };
  }
}
