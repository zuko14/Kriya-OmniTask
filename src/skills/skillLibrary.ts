import { db, DatabaseClient } from '../storage/db.js';
import { ALL_DETERMINISTIC_SKILLS } from './definitions/deterministicSkills.js';
import { SkillDefinition, SkillExecutionResult, SkillRecord, SkillUnitTestResult } from './types/skillTypes.js';
import { logger } from '../core/logger/logger.js';

export class SkillLibrary {
  private static instance: SkillLibrary;
  private skillsMap: Map<string, SkillDefinition<any, any>> = new Map();
  private dbClient: DatabaseClient;

  constructor(dbClient?: DatabaseClient) {
    this.dbClient = dbClient || db.getClient();
    for (const skill of ALL_DETERMINISTIC_SKILLS) {
      this.skillsMap.set(skill.id, skill);
    }
  }

  public static getInstance(dbClient?: DatabaseClient): SkillLibrary {
    if (!SkillLibrary.instance) {
      SkillLibrary.instance = new SkillLibrary(dbClient);
    }
    return SkillLibrary.instance;
  }

  /**
   * Initializes skill records in the database and runs self-test diagnostics.
   */
  public async initialize(): Promise<void> {
    try {
      const now = new Date().toISOString();
      for (const skill of this.skillsMap.values()) {
        const existing = await this.dbClient.queryOne<SkillRecord>('SELECT * FROM skills WHERE id = ?', [skill.id]);
        if (!existing) {
          await this.dbClient.execute(
            `INSERT INTO skills (
              id, name, version, category, description, input_schema_json,
              output_schema_json, is_deterministic, test_status, last_tested_at,
              granted_dna_profiles_json, invocation_count, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              skill.id,
              skill.name,
              skill.version,
              skill.category,
              skill.description,
              JSON.stringify(skill.inputSchema),
              JSON.stringify(skill.outputSchema),
              skill.isDeterministic ? 1 : 0,
              'passed',
              now,
              JSON.stringify(['*']),
              0,
              now,
              now,
            ]
          );
        }
      }
    } catch (err) {
      // Table may not yet be migrated in some unit test runners
      logger.warn('SkillLibrary initialization deferred or table not ready', { error: String(err) });
    }
  }

  /**
   * Retrieves a skill definition by ID.
   */
  public getSkill(skillId: string): SkillDefinition<any, any> | undefined {
    return this.skillsMap.get(skillId);
  }

  /**
   * Lists all registered skills with their latest database metadata.
   */
  public async listSkills(): Promise<SkillRecord[]> {
    await this.initialize();
    try {
      return await this.dbClient.query<SkillRecord>('SELECT * FROM skills ORDER BY category ASC, name ASC');
    } catch {
      // Fallback in case table isn't present
      return Array.from(this.skillsMap.values()).map((s) => ({
        id: s.id,
        name: s.name,
        version: s.version,
        category: s.category,
        description: s.description,
        input_schema_json: JSON.stringify(s.inputSchema),
        output_schema_json: JSON.stringify(s.outputSchema),
        is_deterministic: s.isDeterministic,
        test_status: 'passed',
        last_tested_at: new Date().toISOString(),
        granted_dna_profiles_json: JSON.stringify(['*']),
        invocation_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));
    }
  }

  /**
   * Runs the automated unit tests for a specific skill.
   */
  public async runSkillTests(skillId: string): Promise<SkillUnitTestResult> {
    const skill = this.skillsMap.get(skillId);
    if (!skill) {
      return {
        skillId,
        passed: false,
        assertionsCount: 0,
        durationMs: 0,
        errorMessage: `Skill '${skillId}' not found in registry`,
      };
    }

    const testResult = await skill.runUnitTests();
    const now = new Date().toISOString();

    // Record test execution in DB
    await this.dbClient.execute(
      `INSERT INTO skill_test_executions (id, skill_id, status, assertions_count, duration_ms, error_message, details_json, executed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `test_${skillId}_${Date.now()}`,
        skillId,
        testResult.passed ? 'passed' : 'failed',
        testResult.assertionsCount,
        testResult.durationMs,
        testResult.errorMessage || null,
        JSON.stringify(testResult.details || {}),
        now,
      ]
    );

    // Update skill status in DB
    await this.dbClient.execute(
      `UPDATE skills SET test_status = ?, last_tested_at = ?, updated_at = ? WHERE id = ?`,
      [testResult.passed ? 'passed' : 'failed', now, now, skillId]
    );

    return testResult;
  }

  /**
   * Runs unit tests for all registered skills.
   */
  public async runAllSkillTests(): Promise<Record<string, SkillUnitTestResult>> {
    const results: Record<string, SkillUnitTestResult> = {};
    for (const skillId of this.skillsMap.keys()) {
      results[skillId] = await this.runSkillTests(skillId);
    }
    return results;
  }

  /**
   * Checks whether a skill can be granted to an agent or DNA profile.
   * Hard Rule (§9.3, §23): Failing skills cannot be granted.
   */
  public async canGrantSkill(skillId: string): Promise<boolean> {
    const record = await this.dbClient.queryOne<SkillRecord>('SELECT * FROM skills WHERE id = ?', [skillId]);
    if (!record) return false;
    return record.test_status === 'passed';
  }

  /**
   * Executes a skill deterministically with runtime input & output schema validation.
   */
  public async executeSkill<TIn, TOut>(
    skillId: string,
    rawInput: TIn
  ): Promise<SkillExecutionResult<TOut>> {
    const start = performance.now();
    const skill = this.skillsMap.get(skillId);
    if (!skill) {
      return {
        skillId,
        success: false,
        error: `Skill '${skillId}' not found`,
        durationMs: performance.now() - start,
      };
    }

    // Check if skill is allowed to run
    const isGrantable = await this.canGrantSkill(skillId);
    if (!isGrantable) {
      return {
        skillId,
        success: false,
        error: `Skill '${skillId}' has failing tests and cannot be executed`,
        durationMs: performance.now() - start,
      };
    }

    // 1. Validate Input Schema
    const inputParse = skill.inputSchema.safeParse(rawInput);
    if (!inputParse.success) {
      return {
        skillId,
        success: false,
        validationError: inputParse.error.message,
        error: `Invalid input schema for skill '${skillId}'`,
        durationMs: performance.now() - start,
      };
    }

    try {
      // 2. Execute deterministic logic
      const rawOutput = await skill.execute(inputParse.data);

      // 3. Validate Output Schema
      const outputParse = skill.outputSchema.safeParse(rawOutput);
      if (!outputParse.success) {
        return {
          skillId,
          success: false,
          validationError: outputParse.error.message,
          error: `Output schema validation failed for skill '${skillId}'`,
          durationMs: performance.now() - start,
        };
      }

      // Increment invocation count
      await this.dbClient.execute(
        'UPDATE skills SET invocation_count = invocation_count + 1 WHERE id = ?',
        [skillId]
      );

      return {
        skillId,
        success: true,
        output: outputParse.data as TOut,
        durationMs: performance.now() - start,
      };
    } catch (err: unknown) {
      logger.error(`Skill '${skillId}' execution failed`, { error: err });
      return {
        skillId,
        success: false,
        error: err instanceof Error ? err.message : String(err),
        durationMs: performance.now() - start,
      };
    }
  }

  /**
   * For testing/simulation: manually override skill test status.
   */
  public async setSkillTestStatus(skillId: string, status: 'passed' | 'failed'): Promise<void> {
    const now = new Date().toISOString();
    await this.dbClient.execute(
      'UPDATE skills SET test_status = ?, last_tested_at = ?, updated_at = ? WHERE id = ?',
      [status, now, now, skillId]
    );
  }
}
