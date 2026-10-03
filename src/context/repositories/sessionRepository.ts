/**
 * Kriya Omnitask — Four-Tier Session & Memory Repository (§8, §23)
 * Provides transactional persistence and query capabilities for conversation sessions,
 * Tier 1 session states, conversation turns, token budgets, and per-language costs.
 */

import { DatabaseClient, db } from '../../storage/db.js';
import {
  ConversationTurn,
  Tier1SessionState,
  TokenBudgetPolicy,
  LanguageCostRecord,
  Tier1SessionStateSchema,
  INDIC_TOKEN_MULTIPLIERS,
} from '../types/contextTypes.js';

export interface SessionRecord {
  id: string;
  tenant_id: string;
  organization_id: string;
  customer_id: string | null;
  agent_slug: string;
  channel: string;
  language: string;
  status: string;
  rolling_summary: string;
  total_prompt_tokens: number;
  total_completion_tokens: number;
  total_tokens_spent: number;
  total_cost_usd: number;
  total_cost_inr: number;
  last_compacted_at: string | null;
  created_at: string;
  updated_at: string;
}

export class SessionRepository {
  private client: DatabaseClient;

  constructor(client?: DatabaseClient) {
    this.client = client || db.getClient();
  }

  // ============================================================================
  // Conversation Sessions
  // ============================================================================

  public async createSession(params: {
    id: string;
    tenantId: string;
    organizationId?: string;
    customerId?: string | null;
    agentSlug: string;
    channel?: string;
    language?: string;
  }): Promise<SessionRecord> {
    const now = new Date().toISOString();
    const orgId = params.organizationId || 'default';
    const channel = params.channel || 'web';
    const language = params.language || 'en';

    await this.client.execute(
      `INSERT INTO conversation_sessions (
        id, tenant_id, organization_id, customer_id, agent_slug,
        channel, language, status, rolling_summary, total_prompt_tokens,
        total_completion_tokens, total_tokens_spent, total_cost_usd,
        total_cost_inr, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', '', 0, 0, 0, 0.0, 0.0, ?, ?);`,
      [
        params.id,
        params.tenantId,
        orgId,
        params.customerId || null,
        params.agentSlug,
        channel,
        language,
        now,
        now,
      ]
    );

    return (await this.findSessionById(params.id, params.tenantId))!;
  }

  public async findSessionById(id: string, tenantId: string): Promise<SessionRecord | null> {
    const row = await this.client.queryOne<SessionRecord>(
      'SELECT * FROM conversation_sessions WHERE id = ? AND tenant_id = ?;',
      [id, tenantId]
    );
    return row || null;
  }

  public async updateSession(
    id: string,
    tenantId: string,
    update: {
      status?: string;
      rollingSummary?: string;
      promptTokensDelta?: number;
      completionTokensDelta?: number;
      costUsdDelta?: number;
      costInrDelta?: number;
      lastCompactedAt?: string;
    }
  ): Promise<void> {
    const now = new Date().toISOString();
    const session = await this.findSessionById(id, tenantId);
    if (!session) return;

    const newPromptTokens = session.total_prompt_tokens + (update.promptTokensDelta || 0);
    const newCompletionTokens = session.total_completion_tokens + (update.completionTokensDelta || 0);
    const newTotalTokens = newPromptTokens + newCompletionTokens;
    const newCostUsd = Number((session.total_cost_usd + (update.costUsdDelta || 0)).toFixed(6));
    const newCostInr = Number((session.total_cost_inr + (update.costInrDelta || 0)).toFixed(4));
    const newSummary = update.rollingSummary !== undefined ? update.rollingSummary : session.rolling_summary;
    const newStatus = update.status || session.status;
    const lastCompacted = update.lastCompactedAt || session.last_compacted_at;

    await this.client.execute(
      `UPDATE conversation_sessions
       SET status = ?, rolling_summary = ?, total_prompt_tokens = ?,
           total_completion_tokens = ?, total_tokens_spent = ?,
           total_cost_usd = ?, total_cost_inr = ?, last_compacted_at = ?, updated_at = ?
       WHERE id = ? AND tenant_id = ?;`,
      [
        newStatus,
        newSummary,
        newPromptTokens,
        newCompletionTokens,
        newTotalTokens,
        newCostUsd,
        newCostInr,
        lastCompacted,
        now,
        id,
        tenantId,
      ]
    );
  }

  // ============================================================================
  // Conversation Turns (Tier 0 & Tier 3)
  // ============================================================================

  public async saveTurn(turn: {
    id: string;
    tenantId: string;
    sessionId: string;
    turnIndex: number;
    speaker: 'customer' | 'agent' | 'system' | 'supervisor';
    language?: string;
    content: string;
    structuredPayload?: Record<string, unknown>;
    tokensPrompt?: number;
    tokensCompletion?: number;
    isCompacted?: boolean;
    createdAt?: string;
  }): Promise<ConversationTurn> {
    const now = turn.createdAt || new Date().toISOString();
    const language = turn.language || 'en';
    const payloadJson = JSON.stringify(turn.structuredPayload || {});
    const isCompacted = turn.isCompacted ? 1 : 0;
    const promptTokens = turn.tokensPrompt || 0;
    const completionTokens = turn.tokensCompletion || 0;

    await this.client.execute(
      `INSERT INTO conversation_turns (
        id, tenant_id, session_id, turn_index, speaker, language,
        content, structured_payload_json, tokens_prompt, tokens_completion,
        is_compacted, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        turn.id,
        turn.tenantId,
        turn.sessionId,
        turn.turnIndex,
        turn.speaker,
        language,
        turn.content,
        payloadJson,
        promptTokens,
        completionTokens,
        isCompacted,
        now,
      ]
    );

    return {
      id: turn.id,
      tenantId: turn.tenantId,
      sessionId: turn.sessionId,
      turnIndex: turn.turnIndex,
      speaker: turn.speaker,
      language,
      content: turn.content,
      structuredPayload: turn.structuredPayload,
      tokensPrompt: promptTokens,
      tokensCompletion: completionTokens,
      isCompacted: !!turn.isCompacted,
      createdAt: now,
    };
  }

  public async listTurns(
    sessionId: string,
    tenantId: string,
    options?: { uncompactedOnly?: boolean; limit?: number }
  ): Promise<ConversationTurn[]> {
    let sql = 'SELECT * FROM conversation_turns WHERE session_id = ? AND tenant_id = ?';
    const params: unknown[] = [sessionId, tenantId];

    if (options?.uncompactedOnly) {
      sql += ' AND is_compacted = 0';
    }
    sql += ' ORDER BY turn_index ASC';

    if (options?.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    const rows = await this.client.query<any>(sql, params);
    return rows.map((r) => ({
      id: r.id,
      tenantId: r.tenant_id,
      sessionId: r.session_id,
      turnIndex: r.turn_index,
      speaker: r.speaker,
      language: r.language,
      content: r.content,
      structuredPayload: r.structured_payload_json ? JSON.parse(r.structured_payload_json) : {},
      tokensPrompt: r.tokens_prompt,
      tokensCompletion: r.tokens_completion,
      isCompacted: r.is_compacted === 1,
      createdAt: r.created_at,
    }));
  }

  public async markTurnsCompacted(sessionId: string, tenantId: string, turnIds: string[]): Promise<void> {
    if (turnIds.length === 0) return;
    const placeholders = turnIds.map(() => '?').join(', ');
    await this.client.execute(
      `UPDATE conversation_turns SET is_compacted = 1 WHERE session_id = ? AND tenant_id = ? AND id IN (${placeholders});`,
      [sessionId, tenantId, ...turnIds]
    );
  }

  // ============================================================================
  // Tier 1: Session State Persistence
  // ============================================================================

  public async getSessionState(sessionId: string, tenantId: string): Promise<Tier1SessionState | null> {
    const row = await this.client.queryOne<any>(
      'SELECT * FROM conversation_session_states WHERE session_id = ? AND tenant_id = ?;',
      [sessionId, tenantId]
    );
    if (!row) return null;

    return Tier1SessionStateSchema.parse({
      sessionId: row.session_id,
      tenantId: row.tenant_id,
      entities: JSON.parse(row.entities_json || '{}'),
      decisions: JSON.parse(row.decisions_json || '[]'),
      commitments: JSON.parse(row.commitments_json || '[]'),
      openItems: JSON.parse(row.open_items_json || '[]'),
      version: row.version,
      extractedAt: row.extracted_at,
    });
  }

  public async saveSessionState(state: Tier1SessionState): Promise<Tier1SessionState> {
    const now = new Date().toISOString();
    const validated = Tier1SessionStateSchema.parse(state);

    const existing = await this.getSessionState(validated.sessionId, validated.tenantId);
    const version = existing ? existing.version + 1 : 1;

    await this.client.execute(
      `INSERT INTO conversation_session_states (
        id, tenant_id, session_id, entities_json, decisions_json,
        commitments_json, open_items_json, version, extracted_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, session_id) DO UPDATE SET
        entities_json = excluded.entities_json,
        decisions_json = excluded.decisions_json,
        commitments_json = excluded.commitments_json,
        open_items_json = excluded.open_items_json,
        version = excluded.version,
        extracted_at = excluded.extracted_at,
        updated_at = excluded.updated_at;`,
      [
        `state-${validated.sessionId}`,
        validated.tenantId,
        validated.sessionId,
        JSON.stringify(validated.entities),
        JSON.stringify(validated.decisions),
        JSON.stringify(validated.commitments),
        JSON.stringify(validated.openItems),
        version,
        validated.extractedAt,
        now,
        now,
      ]
    );

    return (await this.getSessionState(validated.sessionId, validated.tenantId))!;
  }

  // ============================================================================
  // Token Budget Policies (§8.5)
  // ============================================================================

  public async getBudgetPolicy(tenantId: string): Promise<TokenBudgetPolicy> {
    const row = await this.client.queryOne<any>(
      'SELECT * FROM token_budget_policies WHERE tenant_id = ?;',
      [tenantId]
    );

    if (!row) {
      // Default policy
      return {
        id: `budget-${tenantId}`,
        tenantId,
        taskTokenBudget: 8000,
        sessionTokenBudget: 32000,
        compactionThresholdPct: 65.0,
        warnThresholdPct: 70.0,
        optimizeThresholdPct: 85.0,
        restrictThresholdPct: 95.0,
        stopThresholdPct: 100.0,
      };
    }

    return {
      id: row.id,
      tenantId: row.tenant_id,
      taskTokenBudget: row.task_token_budget,
      sessionTokenBudget: row.session_token_budget,
      compactionThresholdPct: row.compaction_threshold_pct,
      warnThresholdPct: row.warn_threshold_pct,
      optimizeThresholdPct: row.optimize_threshold_pct,
      restrictThresholdPct: row.restrict_threshold_pct,
      stopThresholdPct: row.stop_threshold_pct,
    };
  }

  public async upsertBudgetPolicy(policy: Partial<TokenBudgetPolicy> & { tenantId: string }): Promise<TokenBudgetPolicy> {
    const now = new Date().toISOString();
    const id = policy.id || `budget-${policy.tenantId}`;
    const taskBudget = policy.taskTokenBudget || 8000;
    const sessionBudget = policy.sessionTokenBudget || 32000;
    const compactionThreshold = policy.compactionThresholdPct || 65.0;
    const warnThreshold = policy.warnThresholdPct || 70.0;
    const optimizeThreshold = policy.optimizeThresholdPct || 85.0;
    const restrictThreshold = policy.restrictThresholdPct || 95.0;
    const stopThreshold = policy.stopThresholdPct || 100.0;

    await this.client.execute(
      `INSERT INTO token_budget_policies (
        id, tenant_id, task_token_budget, session_token_budget,
        compaction_threshold_pct, warn_threshold_pct, optimize_threshold_pct,
        restrict_threshold_pct, stop_threshold_pct, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id) DO UPDATE SET
        task_token_budget = excluded.task_token_budget,
        session_token_budget = excluded.session_token_budget,
        compaction_threshold_pct = excluded.compaction_threshold_pct,
        warn_threshold_pct = excluded.warn_threshold_pct,
        optimize_threshold_pct = excluded.optimize_threshold_pct,
        restrict_threshold_pct = excluded.restrict_threshold_pct,
        stop_threshold_pct = excluded.stop_threshold_pct,
        updated_at = excluded.updated_at;`,
      [
        id,
        policy.tenantId,
        taskBudget,
        sessionBudget,
        compactionThreshold,
        warnThreshold,
        optimizeThreshold,
        restrictThreshold,
        stopThreshold,
        now,
        now,
      ]
    );

    return this.getBudgetPolicy(policy.tenantId);
  }

  // ============================================================================
  // Language Cost Tracking (§8.6)
  // ============================================================================

  public async recordLanguageCost(record: {
    tenantId: string;
    sessionId: string;
    language: string;
    promptTokens: number;
    completionTokens: number;
    costUsd: number;
    costInr: number;
  }): Promise<LanguageCostRecord> {
    const now = new Date().toISOString();
    const id = `langcost-${record.sessionId}-${record.language}`;
    const multiplier = INDIC_TOKEN_MULTIPLIERS[record.language] || 1.0;
    const totalTokens = record.promptTokens + record.completionTokens;

    await this.client.execute(
      `INSERT INTO conversation_language_costs (
        id, tenant_id, session_id, language, prompt_tokens,
        completion_tokens, total_tokens, token_efficiency_multiplier,
        cost_usd, cost_inr, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, session_id, language) DO UPDATE SET
        prompt_tokens = prompt_tokens + excluded.prompt_tokens,
        completion_tokens = completion_tokens + excluded.completion_tokens,
        total_tokens = total_tokens + excluded.total_tokens,
        cost_usd = cost_usd + excluded.cost_usd,
        cost_inr = cost_inr + excluded.cost_inr,
        updated_at = excluded.updated_at;`,
      [
        id,
        record.tenantId,
        record.sessionId,
        record.language,
        record.promptTokens,
        record.completionTokens,
        totalTokens,
        multiplier,
        record.costUsd,
        record.costInr,
        now,
        now,
      ]
    );

    const row = await this.client.queryOne<any>(
      'SELECT * FROM conversation_language_costs WHERE session_id = ? AND tenant_id = ? AND language = ?;',
      [record.sessionId, record.tenantId, record.language]
    );

    return {
      id: row.id,
      tenantId: row.tenant_id,
      sessionId: row.session_id,
      language: row.language,
      promptTokens: row.prompt_tokens,
      completionTokens: row.completion_tokens,
      totalTokens: row.total_tokens,
      tokenEfficiencyMultiplier: row.token_efficiency_multiplier,
      costUsd: row.cost_usd,
      costInr: row.cost_inr,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  public async getLanguageCosts(sessionId: string, tenantId: string): Promise<LanguageCostRecord[]> {
    const rows = await this.client.query<any>(
      'SELECT * FROM conversation_language_costs WHERE session_id = ? AND tenant_id = ? ORDER BY total_tokens DESC;',
      [sessionId, tenantId]
    );

    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      sessionId: row.session_id,
      language: row.language,
      promptTokens: row.prompt_tokens,
      completionTokens: row.completion_tokens,
      totalTokens: row.total_tokens,
      tokenEfficiencyMultiplier: row.token_efficiency_multiplier,
      costUsd: row.cost_usd,
      costInr: row.cost_inr,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }
}
