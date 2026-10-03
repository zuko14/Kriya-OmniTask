/**
 * Kriya AI — CI Evaluation & Regression Gate Repository (WP-6.2)
 * Persists and audits CI runs, model swap decisions, and charter update evaluations (§14, §18 of CLAUDE.md).
 */

import { DatabaseClient, db } from '../../../storage/db.js';
import { ReleaseGateVerdict } from '../types/evalCiTypes.js';

export interface EvaluationCiRunRecord {
  id: string;
  tenant_id: string;
  organization_id: string;
  suite_id: string;
  agent_slug: string;
  evaluation_type: 'standard_ci' | 'model_swap_gate' | 'charter_gate';
  baseline_model_id: string | null;
  candidate_model_id: string | null;
  baseline_pass_rate: number | null;
  candidate_pass_rate: number | null;
  pass_k_trials: number;
  safety_breaches: number;
  verdict: ReleaseGateVerdict;
  gate_notes_json: string;
  report_json: string;
  created_at: string;
}

export class EvaluationCiRepository {
  private customClient?: DatabaseClient;

  constructor(client?: DatabaseClient) {
    this.customClient = client;
  }

  private get client(): DatabaseClient {
    return this.customClient || db.getClient();
  }

  public async saveCiRun(record: Omit<EvaluationCiRunRecord, 'organization_id'> & { organization_id?: string }): Promise<EvaluationCiRunRecord> {
    const orgId = record.organization_id || 'default';
    const sql = `
      INSERT INTO evaluation_ci_runs (
        id, tenant_id, organization_id, suite_id, agent_slug, evaluation_type,
        baseline_model_id, candidate_model_id, baseline_pass_rate, candidate_pass_rate,
        pass_k_trials, safety_breaches, verdict, gate_notes_json, report_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    await this.client.execute(sql, [
      record.id,
      record.tenant_id,
      orgId,
      record.suite_id,
      record.agent_slug,
      record.evaluation_type,
      record.baseline_model_id,
      record.candidate_model_id,
      record.baseline_pass_rate,
      record.candidate_pass_rate,
      record.pass_k_trials,
      record.safety_breaches,
      record.verdict,
      record.gate_notes_json,
      record.report_json,
      record.created_at,
    ]);

    return {
      ...record,
      organization_id: orgId,
    };
  }

  public async getRunById(id: string, tenantId: string): Promise<EvaluationCiRunRecord | null> {
    const sql = 'SELECT * FROM evaluation_ci_runs WHERE id = ? AND tenant_id = ?';
    const rows = await this.client.query<EvaluationCiRunRecord>(sql, [id, tenantId]);
    return rows.length > 0 ? rows[0] : null;
  }

  public async listRuns(filter: {
    tenantId: string;
    agentSlug?: string;
    evaluationType?: string;
    verdict?: string;
    limit?: number;
  }): Promise<EvaluationCiRunRecord[]> {
    const conditions: string[] = ['tenant_id = ?'];
    const params: unknown[] = [filter.tenantId];

    if (filter.agentSlug) {
      conditions.push('agent_slug = ?');
      params.push(filter.agentSlug);
    }
    if (filter.evaluationType) {
      conditions.push('evaluation_type = ?');
      params.push(filter.evaluationType);
    }
    if (filter.verdict) {
      conditions.push('verdict = ?');
      params.push(filter.verdict);
    }

    const limit = filter.limit ?? 50;
    const sql = `
      SELECT * FROM evaluation_ci_runs
      WHERE ${conditions.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;

    return this.client.query<EvaluationCiRunRecord>(sql, params);
  }
}
