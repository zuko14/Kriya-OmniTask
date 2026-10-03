/**
 * Kriya Omnitask — Kriya Mandate: delegated authority (docs/kriya WP-3.1, 02 §6)
 *
 * A mandate says: principal P lets agent A perform action types X within scope S, up to a per-action
 * amount, a daily amount and a daily count, between valid_from and valid_until, unless revoked.
 *
 * `authorize()` checks AND consumes in one transaction, so two concurrent actions cannot both spend
 * the same remaining limit. Over a limit → `over_limit` (route to a human); never truncated or split.
 * ponytail: on Postgres the usage row needs SELECT … FOR UPDATE inside this transaction (WP-5.1).
 */

import { z } from 'zod';
import { DatabaseClient, db } from '../../storage/db.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import { CryptoUtils } from '../../core/utils/crypto.js';
import { auditLogger, AuditLogger } from '../../security/audit/auditLogger.js';
import { ValidationError, NotFoundError } from '../../core/errors/errors.js';

export const CreateMandateSchema = z
  .object({
    principalId: z.string().min(1),
    agentSlug: z.string().min(1), // '*' = any agent
    actionTypes: z.array(z.string().min(1)).min(1),
    resourceScope: z.record(z.string()).default({}),
    perActionLimit: z.number().nonnegative().optional(),
    dailyLimit: z.number().nonnegative().optional(),
    currency: z.string().length(3).default('INR'),
    maxCountPerDay: z.number().int().positive().optional(),
    validFrom: z.string().datetime().optional(),
    validUntil: z.string().datetime().optional(),
  })
  .refine((m) => !m.validFrom || !m.validUntil || m.validFrom < m.validUntil, { message: 'validFrom must be before validUntil' });
export type CreateMandateInput = z.input<typeof CreateMandateSchema>;

export interface MandateRecord {
  id: string;
  tenant_id: string;
  principal_id: string;
  agent_slug: string;
  action_types_json: string;
  resource_scope_json: string;
  per_action_limit: number | null;
  daily_limit: number | null;
  currency: string;
  max_count_per_day: number | null;
  valid_from: string;
  valid_until: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
  created_by: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface AuthorizeRequest {
  agentSlug: string;
  actionType: string;
  amount?: number;
  currency?: string;
  scope?: Record<string, string>;
}

export type MandateDecision =
  | { decision: 'allow'; mandateId: string; mandateVersion: number; remainingDaily: number | null }
  | { decision: 'over_limit'; mandateId: string; mandateVersion: number; reason: string }
  | { decision: 'denied'; reason: string };

export class MandateService {
  constructor(private readonly customClient?: DatabaseClient) {}

  private get client(): DatabaseClient {
    return this.customClient ?? db.getClient();
  }

  public async create(input: CreateMandateInput, createdBy: string): Promise<MandateRecord> {
    const m = CreateMandateSchema.parse(input);
    const tenantId = TenantContextManager.getTenantId();
    const now = new Date().toISOString();
    const id = `mdt_${CryptoUtils.generateId()}`;
    await this.client.execute(
      `INSERT INTO mandates (id, tenant_id, principal_id, agent_slug, action_types_json, resource_scope_json, per_action_limit,
         daily_limit, currency, max_count_per_day, valid_from, valid_until, created_by, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [id, tenantId, m.principalId, m.agentSlug, JSON.stringify(m.actionTypes), JSON.stringify(m.resourceScope), m.perActionLimit ?? null,
        m.dailyLimit ?? null, m.currency.toUpperCase(), m.maxCountPerDay ?? null, m.validFrom ?? now, m.validUntil ?? null, createdBy, now, now]
    );
    await new AuditLogger(this.client).logEvent({ action: 'mandate.created', resourceType: 'mandate', resourceId: id, details: { agentSlug: m.agentSlug, actionTypes: m.actionTypes, perActionLimit: m.perActionLimit, dailyLimit: m.dailyLimit, createdBy } });
    return (await this.get(id))!;
  }

  public async get(id: string): Promise<MandateRecord | null> {
    return this.client.queryOne<MandateRecord>('SELECT * FROM mandates WHERE id = ? AND tenant_id = ?', [id, TenantContextManager.getTenantId()]);
  }

  public async list(): Promise<MandateRecord[]> {
    return this.client.query<MandateRecord>('SELECT * FROM mandates WHERE tenant_id = ? ORDER BY created_at DESC', [TenantContextManager.getTenantId()]);
  }

  public async revoke(id: string, revokedBy: string): Promise<MandateRecord> {
    const existing = await this.get(id);
    if (!existing) throw new NotFoundError(`Mandate '${id}' not found.`);
    if (existing.revoked_at) return existing;
    const now = new Date().toISOString();
    await this.client.execute(
      'UPDATE mandates SET revoked_at = ?, revoked_by = ?, version = version + 1, updated_at = ? WHERE id = ? AND tenant_id = ?',
      [now, revokedBy, now, id, TenantContextManager.getTenantId()]
    );
    await auditLogger.logEvent({ action: 'mandate.revoked', resourceType: 'mandate', resourceId: id, details: { revokedBy } });
    return (await this.get(id))!;
  }

  /** Checks authority and, if allowed, consumes the limit — atomically. */
  public async authorize(req: AuthorizeRequest, now: Date = new Date()): Promise<MandateDecision> {
    if (req.amount !== undefined && (!Number.isFinite(req.amount) || req.amount < 0)) {
      throw new ValidationError(`Invalid action amount: ${req.amount}`);
    }
    const tenantId = TenantContextManager.getTenantId();
    const nowIso = now.toISOString();
    const day = nowIso.slice(0, 10);

    return this.client.transaction(async (tx) => {
      const candidates = (
        await tx.query<MandateRecord>(
          `SELECT * FROM mandates WHERE tenant_id = ? AND (agent_slug = ? OR agent_slug = '*') AND revoked_at IS NULL
             AND valid_from <= ? AND (valid_until IS NULL OR valid_until > ?) ORDER BY created_at ASC`,
          [tenantId, req.agentSlug, nowIso, nowIso]
        )
      ).filter((m) => (JSON.parse(m.action_types_json) as string[]).includes(req.actionType) && scopeMatches(m, req.scope ?? {}));

      if (candidates.length === 0) {
        return { decision: 'denied', reason: `No active mandate lets '${req.agentSlug}' perform '${req.actionType}' in this scope.` } as MandateDecision;
      }

      let firstOverLimit: MandateDecision | null = null;
      for (const m of candidates) {
        if (req.amount !== undefined && req.currency && req.currency.toUpperCase() !== m.currency) continue;
        const usage = (await tx.queryOne<{ total_amount: number; action_count: number }>(
          'SELECT total_amount, action_count FROM mandate_usage WHERE mandate_id = ? AND usage_date = ? FOR UPDATE',
          [m.id, day]
        )) ?? { total_amount: 0, action_count: 0 };
        const amount = req.amount ?? 0;

        const reason =
          m.per_action_limit !== null && amount > m.per_action_limit ? `amount ${amount} exceeds per-action limit ${m.per_action_limit} ${m.currency}`
          : m.daily_limit !== null && usage.total_amount + amount > m.daily_limit ? `daily limit ${m.daily_limit} ${m.currency} would be exceeded (used ${usage.total_amount})`
          : m.max_count_per_day !== null && usage.action_count + 1 > m.max_count_per_day ? `daily action count ${m.max_count_per_day} reached`
          : null;
        if (reason) {
          firstOverLimit ??= { decision: 'over_limit', mandateId: m.id, mandateVersion: m.version, reason };
          continue;
        }

        await tx.execute(
          `INSERT INTO mandate_usage (mandate_id, tenant_id, usage_date, total_amount, action_count, updated_at) VALUES (?, ?, ?, ?, 1, ?)
           ON CONFLICT(mandate_id, usage_date) DO UPDATE SET total_amount = total_amount + excluded.total_amount, action_count = action_count + 1, updated_at = excluded.updated_at`,
          [m.id, tenantId, day, amount, nowIso]
        );
        return {
          decision: 'allow',
          mandateId: m.id,
          mandateVersion: m.version,
          remainingDaily: m.daily_limit === null ? null : m.daily_limit - usage.total_amount - amount,
        } as MandateDecision;
      }
      return (firstOverLimit ?? { decision: 'denied', reason: `No mandate in currency ${req.currency} covers this action.` }) as MandateDecision;
    });
  }
}

function scopeMatches(m: MandateRecord, requestScope: Record<string, string>): boolean {
  const required = JSON.parse(m.resource_scope_json) as Record<string, string>;
  return Object.entries(required).every(([k, v]) => requestScope[k] === v);
}
