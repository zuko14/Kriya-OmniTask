/**
 * Kriya Omnitask — Reach Browser Automation Types & Schemas (WP-5.5, Blueprint §10, §15, ADR-022)
 *
 * Defines contracts for isolated web automation, domain/action allowlists,
 * per-run session isolation, screenshot evidence, proof receipts, and emergency kill switches.
 */

import { z } from 'zod';
import { AppError } from '../../core/errors/errors.js';

export const BrowserActionTypeEnum = z.enum([
  'navigate',
  'click',
  'fill',
  'select',
  'extractText',
  'screenshot',
  'waitForSelector',
]);
export type BrowserActionType = z.infer<typeof BrowserActionTypeEnum>;

export const BrowserActionSchema = z.object({
  type: BrowserActionTypeEnum,
  target: z.string().optional(), // URL for 'navigate', CSS/XPath selector for interaction
  value: z.string().optional(), // Text for 'fill', value for 'select'
  timeoutMs: z.number().int().positive().max(60000).optional(),
  captureScreenshotAfter: z.boolean().optional(),
});
export type BrowserAction = z.infer<typeof BrowserActionSchema>;

export const ReachSessionConfigSchema = z.object({
  tenantId: z.string().min(1),
  runId: z.string().optional(),
  agentSlug: z.string().default('reach_worker'),
  allowedDomains: z.array(z.string().min(1)).min(1),
  allowedActions: z.array(BrowserActionTypeEnum).optional(),
  maxActionsPerSession: z.number().int().positive().max(100).default(25),
  sessionTimeoutMs: z.number().int().positive().max(120000).default(30000),
  recordScreenshots: z.boolean().default(true),
  headless: z.boolean().default(true),
  viewport: z
    .object({
      width: z.number().int().default(1280),
      height: z.number().int().default(800),
    })
    .default({ width: 1280, height: 800 }),
});
export type ReachSessionConfig = z.input<typeof ReachSessionConfigSchema>;

export interface ReachActionResult {
  action: BrowserAction;
  status: 'completed' | 'failed' | 'blocked';
  output?: string;
  screenshotBase64?: string;
  screenshotSha256?: string;
  durationMs: number;
  error?: string;
}

export interface ReachScreenshotEvidence {
  actionIndex: number;
  actionType: BrowserActionType;
  url: string;
  sha256: string;
  screenshotBase64: string;
  capturedAt: string;
}

export interface ReachSessionResult {
  sessionId: string;
  tenantId: string;
  runId?: string;
  status: 'completed' | 'failed' | 'killed' | 'security_blocked';
  results: ReachActionResult[];
  finalUrl: string;
  screenshotEvidence: ReachScreenshotEvidence[];
  proofReceiptId?: string;
  durationMs: number;
  error?: string;
}

export interface ReachSessionRecord {
  id: string;
  tenant_id: string;
  run_id: string | null;
  status: string;
  initial_url: string;
  final_url: string | null;
  actions_count: number;
  proof_receipt_id: string | null;
  evidence_sha256: string | null;
  error_message: string | null;
  duration_ms: number;
  created_at: string;
}

// ============================================================================
// Error Hierarchy
// ============================================================================

export class ReachSecurityViolationError extends AppError {
  public readonly code = 'REACH_SECURITY_VIOLATION';
  public readonly statusCode = 403;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details, true);
  }
}

export class ReachKillSwitchActiveError extends AppError {
  public readonly code = 'REACH_KILL_SWITCH_ACTIVE';
  public readonly statusCode = 503;

  constructor(message = 'Kriya Reach browser automation has been halted by an emergency kill switch.', details?: Record<string, unknown>) {
    super(message, details, true);
  }
}

export class ReachExecutionError extends AppError {
  public readonly code = 'REACH_EXECUTION_ERROR';
  public readonly statusCode = 502;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details, true);
  }
}

export class ReachTimeoutError extends AppError {
  public readonly code = 'REACH_TIMEOUT';
  public readonly statusCode = 504;

  constructor(message = 'Kriya Reach browser session exceeded execution timeout.', details?: Record<string, unknown>) {
    super(message, details, true);
  }
}
