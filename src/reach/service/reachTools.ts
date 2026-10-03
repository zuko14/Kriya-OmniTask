/**
 * Kriya Omnitask — Reach Browser Automation Tools (WP-5.5, Blueprint §10, §15, ADR-022)
 *
 * Registered tool contracts exposing secure, allowlisted, proof-verified
 * browser interactions to autonomous Kriya agents.
 */

import { z } from 'zod';
import { DatabaseClient } from '../../storage/db.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import { ValidationError, AppError } from '../../core/errors/errors.js';
import type { RegisteredTool } from '../../tools/registry/toolRegistry.js';
import { BrowserAction, BrowserActionSchema } from '../types/reachTypes.js';
import { ReachBrowserService } from './reachBrowserService.js';

export function reachTools(deps: {
  reachService?: ReachBrowserService;
  client?: DatabaseClient;
} = {}): RegisteredTool[] {
  const service = deps.reachService ?? new ReachBrowserService({ client: deps.client });

  const def = (slug: string, name: string, description: string, riskTier: 'LOW' | 'MEDIUM') => ({
    slug,
    name,
    description,
    category: 'custom' as const,
    riskTier,
    requiresApproval: false,
    inputSchema: {},
    outputSchema: {},
    isSystem: true,
  });

  return [
    {
      definition: def(
        'reach_browser_session',
        'Reach Web Browser Automation',
        'Executes an isolated, allowlisted web browser session with screenshot evidence and Ed25519 Proof linkage.',
        'MEDIUM'
      ),
      inputValidator: z.object({
        url: z.string().min(1),
        actions: z.array(BrowserActionSchema).default([]),
        allowedDomains: z.array(z.string().min(1)).min(1),
        mandateId: z.string().optional(),
        runId: z.string().optional(),
        recordScreenshots: z.boolean().default(true),
        timeoutMs: z.number().int().positive().max(120000).optional(),
      }),
      handler: async (input) => {
        const tenantId = TenantContextManager.get()?.tenantId;
        if (!tenantId) {
          throw new ValidationError('Tenant context is required to execute Reach browser sessions.');
        }

        const url = String(input.url);
        const allowedDomains = (input.allowedDomains as string[]) || [];
        const actions = (input.actions as BrowserAction[]) || [];
        const mandateId = input.mandateId ? String(input.mandateId) : undefined;
        const runId = input.runId ? String(input.runId) : undefined;
        const recordScreenshots = input.recordScreenshots !== false;
        const timeoutMs = typeof input.timeoutMs === 'number' ? input.timeoutMs : 30000;

        const result = await service.executeSession({
          config: {
            tenantId,
            runId,
            allowedDomains,
            recordScreenshots,
            sessionTimeoutMs: timeoutMs,
          },
          initialUrl: url,
          actions,
          mandateId,
        });

        return {
          sessionId: result.sessionId,
          status: result.status,
          finalUrl: result.finalUrl,
          actionsCount: result.results.length,
          proofReceiptId: result.proofReceiptId || null,
          evidenceCount: result.screenshotEvidence.length,
          evidenceSha256: result.screenshotEvidence[0]?.sha256 || null,
          durationMs: result.durationMs,
        };
      },
      verify: async (_input, output) => {
        if (output.status !== 'completed') {
          return {
            state: 'mismatch',
            reason: `Reach session did not complete successfully (status: ${output.status})`,
            observed: output,
          };
        }
        if (!output.proofReceiptId) {
          return {
            state: 'mismatch',
            reason: 'Reach session completed without issuing a cryptographic ProofReceipt.',
            observed: output,
          };
        }
        return {
          state: 'verified',
          observed: {
            sessionId: output.sessionId,
            proofReceiptId: output.proofReceiptId,
            finalUrl: output.finalUrl,
          },
        };
      },
      compensate: async (_input, _output) => {
        // Compensator executes session cleanup where applicable
      },
    },
  ];
}
