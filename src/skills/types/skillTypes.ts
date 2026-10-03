import { z } from 'zod';

export type SkillCategory = 'extraction' | 'validation' | 'normalization' | 'calculation' | 'security' | 'compliance';
export type SkillTestStatus = 'passed' | 'failed' | 'untested';

export const SkillRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string().default('1.0.0'),
  category: z.enum(['extraction', 'validation', 'normalization', 'calculation', 'security', 'compliance']),
  description: z.string(),
  input_schema_json: z.string().default('{}'),
  output_schema_json: z.string().default('{}'),
  is_deterministic: z.union([z.boolean(), z.number()]).transform(v => Boolean(v)),
  test_status: z.enum(['passed', 'failed', 'untested']),
  last_tested_at: z.string().nullable().optional(),
  granted_dna_profiles_json: z.string().default('["*"]'),
  invocation_count: z.number().default(0),
  created_at: z.string(),
  updated_at: z.string(),
});

export type SkillRecord = z.infer<typeof SkillRecordSchema>;

export interface SkillDefinition<TInput = any, TOutput = any> {
  id: string;
  name: string;
  version: string;
  category: SkillCategory;
  description: string;
  isDeterministic: boolean;
  inputSchema: z.ZodType<any>;
  outputSchema: z.ZodType<any>;
  execute: (input: TInput) => Promise<TOutput> | TOutput;
  runUnitTests: () => Promise<SkillUnitTestResult>;
}

export interface SkillUnitTestResult {
  skillId: string;
  passed: boolean;
  assertionsCount: number;
  durationMs: number;
  errorMessage?: string;
  details?: Record<string, unknown>;
}

export interface SkillExecutionResult<T = unknown> {
  skillId: string;
  success: boolean;
  output?: T;
  error?: string;
  validationError?: string;
  durationMs: number;
}
