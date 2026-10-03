/**
 * Kriya AI — Branch & Location Relational Repository
 * Persistence and operating hours evaluator for tenant branches (§14 of CLAUDE.md, docs/kriya WP-4.6).
 */

import { BaseRepository } from '../../storage/repositories/baseRepository.js';
import { DatabaseClient } from '../../storage/db.js';
import {
  BranchRecord,
  CreateBranchInput,
  CreateBranchSchema,
} from '../types/attentionTypes.js';
import { CryptoUtils } from '../../core/utils/crypto.js';
import { NotFoundError } from '../../core/errors/errors.js';

export const DAYS_SHORT = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type DayShort = (typeof DAYS_SHORT)[number];

export function normalizeDayKey(day: string): DayShort | null {
  const norm = day.trim().toLowerCase().slice(0, 3);
  return (DAYS_SHORT as readonly string[]).includes(norm) ? (norm as DayShort) : null;
}

export interface LocalBranchTime {
  day: DayShort;
  dateStr: string;
  timeStr: string;
  combinedLocal: string;
}

export function getLocalBranchTime(timezone: string, now = new Date()): LocalBranchTime {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  });

  const parts = Object.fromEntries(formatter.formatToParts(now).map((x) => [x.type, x.value]));
  const weekdayShort = normalizeDayKey(parts.weekday || 'mon') || 'mon';
  const dateStr = `${parts.year}-${parts.month}-${parts.day}`;
  const timeStr = `${parts.hour}:${parts.minute}`;

  return {
    day: weekdayShort,
    dateStr,
    timeStr,
    combinedLocal: `${dateStr} ${timeStr}`,
  };
}

export class BranchRepository extends BaseRepository<BranchRecord> {
  protected readonly tableName = 'branches';

  constructor(client?: DatabaseClient) {
    super(client);
  }

  /**
   * Creates a new branch for the tenant.
   */
  public async createBranch(input: CreateBranchInput): Promise<BranchRecord> {
    const validated = CreateBranchSchema.parse(input);
    const tenantId = this.getTenantId();
    const id = CryptoUtils.generateId();
    const now = new Date().toISOString();

    const record: BranchRecord = {
      id,
      tenant_id: tenantId,
      name: validated.name,
      code: validated.code || null,
      timezone: validated.timezone,
      working_hours_json: JSON.stringify(validated.workingHours),
      emergency_role: validated.emergencyRole,
      active: 1,
      created_at: now,
      updated_at: now,
    };

    await this.client.execute(
      `INSERT INTO branches (
        id, tenant_id, name, code, timezone, working_hours_json, emergency_role, active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        record.id,
        record.tenant_id,
        record.name,
        record.code,
        record.timezone,
        record.working_hours_json,
        record.emergency_role,
        record.active,
        record.created_at,
        record.updated_at,
      ]
    );

    return record;
  }

  /**
   * Updates an existing branch.
   */
  public async updateBranch(
    id: string,
    updates: Partial<CreateBranchInput> & { active?: number }
  ): Promise<BranchRecord> {
    const tenantId = this.getTenantId();
    const existing = await this.findById(id);
    if (!existing) throw new NotFoundError(`Branch '${id}' not found.`);

    const now = new Date().toISOString();
    const updated = {
      name: updates.name ?? existing.name,
      code: updates.code !== undefined ? updates.code : existing.code,
      timezone: updates.timezone ?? existing.timezone,
      working_hours_json: updates.workingHours ? JSON.stringify(updates.workingHours) : existing.working_hours_json,
      emergency_role: updates.emergencyRole ?? existing.emergency_role,
      active: updates.active !== undefined ? updates.active : existing.active,
    };

    await this.client.execute(
      `UPDATE branches SET
        name = ?, code = ?, timezone = ?, working_hours_json = ?, emergency_role = ?, active = ?, updated_at = ?
       WHERE id = ? AND tenant_id = ?;`,
      [
        updated.name,
        updated.code,
        updated.timezone,
        updated.working_hours_json,
        updated.emergency_role,
        updated.active,
        now,
        id,
        tenantId,
      ]
    );

    return (await this.findById(id))!;
  }

  /**
   * Finds a branch by business code (e.g. 'blr-koramangala').
   */
  public async findByCode(code: string): Promise<BranchRecord | null> {
    return this.client.queryOne<BranchRecord>(
      'SELECT * FROM branches WHERE tenant_id = ? AND code = ? LIMIT 1;',
      [this.getTenantId(), code]
    );
  }

  /**
   * Lists branches for the tenant.
   */
  public async listBranches(activeOnly = true): Promise<BranchRecord[]> {
    const tenantId = this.getTenantId();
    const sql = activeOnly
      ? 'SELECT * FROM branches WHERE tenant_id = ? AND active = 1 ORDER BY name ASC;'
      : 'SELECT * FROM branches WHERE tenant_id = ? ORDER BY name ASC;';
    return this.client.query<BranchRecord>(sql, [tenantId]);
  }

  /**
   * Checks if the branch is currently within operating hours.
   */
  public isWithinWorkingHours(branch: BranchRecord, now = new Date()): {
    inHours: boolean;
    localTime: LocalBranchTime;
  } {
    const local = getLocalBranchTime(branch.timezone, now);
    let workingHours: Record<string, Array<[string, string]>> = {};
    try {
      workingHours = JSON.parse(branch.working_hours_json || '{}');
    } catch {
      workingHours = {};
    }

    // Look up normalized day
    let intervals: Array<[string, string]> | undefined;
    for (const [key, val] of Object.entries(workingHours)) {
      if (normalizeDayKey(key) === local.day) {
        intervals = val;
        break;
      }
    }

    if (!intervals || intervals.length === 0) {
      return { inHours: false, localTime: local };
    }

    const inHours = intervals.some(([start, end]) => local.timeStr >= start && local.timeStr < end);
    return { inHours, localTime: local };
  }

  /**
   * Calculates the next available opening timestamp for a branch if currently outside working hours.
   * Returns a local formatted date-time string (e.g. "2026-10-02 09:00:00 (Asia/Kolkata)") or null if no hours configured.
   */
  public getNextAvailableTime(branch: BranchRecord, now = new Date()): string | null {
    let workingHours: Record<string, Array<[string, string]>> = {};
    try {
      workingHours = JSON.parse(branch.working_hours_json || '{}');
    } catch {
      return null;
    }

    const localNow = getLocalBranchTime(branch.timezone, now);

    // Check next 7 days in order
    for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
      const checkDate = new Date(now.getTime() + dayOffset * 24 * 60 * 60 * 1000);
      const checkLocal = getLocalBranchTime(branch.timezone, checkDate);

      let intervals: Array<[string, string]> | undefined;
      for (const [key, val] of Object.entries(workingHours)) {
        if (normalizeDayKey(key) === checkLocal.day) {
          intervals = val;
          break;
        }
      }

      if (!intervals || intervals.length === 0) continue;

      // Sort intervals by start time
      const sorted = [...intervals].sort((a, b) => a[0].localeCompare(b[0]));

      for (const [start, end] of sorted) {
        if (dayOffset === 0) {
          // Today: only valid if starts in future
          if (start > localNow.timeStr) {
            return `${checkLocal.dateStr} ${start}:00 (${branch.timezone})`;
          }
        } else {
          // Future day: first opening time
          return `${checkLocal.dateStr} ${start}:00 (${branch.timezone})`;
        }
      }
    }

    return null;
  }
}
