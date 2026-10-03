/**
 * Kriya Omnitask — Reach Browser Automation Service (WP-5.5, Blueprint §10, §15, ADR-022)
 *
 * Orchestrates isolated worker execution, enforces security and action allowlists,
 * bounds execution time, captures screenshot evidence, links Ed25519 Proof receipts,
 * and responds to emergency kill switches.
 */

import { randomUUID, createHash } from 'node:crypto';
import { DatabaseClient, db } from '../../storage/db.js';
import { logger } from '../../core/logger/logger.js';
import { config } from '../../core/config/config.js';
import { ProofService } from '../../trust/proof/proofService.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import {
  BrowserAction,
  ReachSessionConfig,
  ReachSessionResult,
  ReachActionResult,
  ReachScreenshotEvidence,
  ReachSecurityViolationError,
  ReachKillSwitchActiveError,
  ReachExecutionError,
  ReachTimeoutError,
} from '../types/reachTypes.js';
import { ReachSecurityPolicy } from '../security/reachSecurityPolicy.js';
import { ReachKillSwitch } from '../security/reachKillSwitch.js';
import { ReachBrowserDriver, HermeticMockBrowserDriver, PlaywrightBrowserDriver } from '../driver/browserDriver.js';
import { ReachSessionRepository } from '../repositories/reachSessionRepository.js';

export interface ReachBrowserServiceOptions {
  driver?: ReachBrowserDriver;
  killSwitch?: ReachKillSwitch;
  proofService?: ProofService;
  repository?: ReachSessionRepository;
  client?: DatabaseClient;
}

export class ReachBrowserService {
  private readonly driver: ReachBrowserDriver;
  private readonly killSwitch: ReachKillSwitch;
  private readonly proofService: ProofService;
  private readonly repository: ReachSessionRepository;

  constructor(options: ReachBrowserServiceOptions = {}) {
    const isTest = config.get('NODE_ENV') === 'test' || config.get('APP_MODE') === 'test';

    const client = options.client ?? db.getClient();
    this.driver = options.driver || (isTest ? new HermeticMockBrowserDriver() : new PlaywrightBrowserDriver());
    this.killSwitch = options.killSwitch || ReachKillSwitch.getInstance();
    this.proofService = options.proofService || new ProofService(client);
    this.repository = options.repository || new ReachSessionRepository(client);
  }

  /**
   * Executes a bounded, isolated browser session with domain allowlists and screenshot evidence.
   */
  public async executeSession(params: {
    config: ReachSessionConfig;
    initialUrl: string;
    actions: BrowserAction[];
    mandateId?: string;
  }): Promise<ReachSessionResult> {
    const startTime = Date.now();
    const sessionId = randomUUID();
    const { config: sessionConfig, initialUrl, actions } = params;
    const tenantId = sessionConfig.tenantId;

    // 1. Pre-flight Emergency Kill Switch Check
    this.killSwitch.assertNotKilled(tenantId);

    // 2. Pre-flight Initial URL Security Validation
    const { normalizedUrl } = ReachSecurityPolicy.validateUrl(initialUrl, sessionConfig.allowedDomains);

    // 3. Enforce Action Count Bounds
    const maxActions = sessionConfig.maxActionsPerSession || 25;
    if (actions.length > maxActions) {
      throw new ReachSecurityViolationError(
        `Action count (${actions.length}) exceeds maximum permitted actions per session (${maxActions}).`
      );
    }

    // 4. Record Initial Session in Repository
    try {
      await this.repository.create({
        id: sessionId,
        tenant_id: tenantId,
        run_id: sessionConfig.runId || null,
        status: 'executing',
        initial_url: normalizedUrl,
        actions_count: actions.length,
        duration_ms: 0,
      });
    } catch (err: any) {
      logger.warn(`Could not persist initial reach_session record '${sessionId}': ${err?.message}`);
    }

    // 5. Setup Abort Signal and Timeout
    const abortController = new AbortController();
    const timeoutMs = sessionConfig.sessionTimeoutMs || 30000;
    const timeoutTimer = setTimeout(() => {
      abortController.abort(new ReachTimeoutError(`Reach browser session exceeded ${timeoutMs}ms timeout.`));
    }, timeoutMs);

    this.killSwitch.registerSession(sessionId, tenantId, abortController);

    const actionResults: ReachActionResult[] = [];
    const screenshotEvidence: ReachScreenshotEvidence[] = [];
    let finalUrl = normalizedUrl;
    let sessionStatus: ReachSessionResult['status'] = 'completed';
    let sessionError: string | undefined;

    let driverSession: any;

    try {
      // 6. Launch Ephemeral Isolated Browser Context
      driverSession = await this.driver.createSession(sessionConfig, abortController.signal);

      // 7. Initial Navigation
      const navStart = Date.now();
      const navRes = await driverSession.navigate(normalizedUrl);
      finalUrl = navRes.url;
      actionResults.push({
        action: { type: 'navigate', target: normalizedUrl },
        status: 'completed',
        output: navRes.title,
        durationMs: Date.now() - navStart,
      });

      // Capture initial page evidence if enabled
      if (sessionConfig.recordScreenshots !== false) {
        const shot = await driverSession.captureScreenshot();
        screenshotEvidence.push({
          actionIndex: 0,
          actionType: 'navigate',
          url: finalUrl,
          sha256: shot.sha256,
          screenshotBase64: shot.base64,
          capturedAt: new Date().toISOString(),
        });
      }

      // 8. Sequential Action Execution
      for (let i = 0; i < actions.length; i++) {
        const action = actions[i];
        const actionStart = Date.now();

        // Re-check kill switch between actions
        this.killSwitch.assertNotKilled(tenantId);

        if (abortController.signal.aborted) {
          throw new ReachTimeoutError(abortController.signal.reason?.message || 'Session aborted.');
        }

        // Validate action against allowlist
        ReachSecurityPolicy.validateAction(action, sessionConfig.allowedActions);

        let output: string | undefined;

        try {
          switch (action.type) {
            case 'navigate': {
              const res = await driverSession.navigate(action.target!);
              finalUrl = res.url;
              output = res.title;
              break;
            }
            case 'click': {
              await driverSession.click(action.target!, action.timeoutMs);
              output = 'clicked';
              break;
            }
            case 'fill': {
              await driverSession.fill(action.target!, action.value || '', action.timeoutMs);
              output = 'filled';
              break;
            }
            case 'select': {
              await driverSession.select(action.target!, action.value || '', action.timeoutMs);
              output = `selected ${action.value}`;
              break;
            }
            case 'extractText': {
              output = await driverSession.extractText(action.target!, action.timeoutMs);
              break;
            }
            case 'waitForSelector': {
              const found = await driverSession.waitForSelector(action.target!, action.timeoutMs);
              output = found ? 'found' : 'not_found';
              break;
            }
            case 'screenshot': {
              const shot = await driverSession.captureScreenshot();
              output = `sha256:${shot.sha256}`;
              screenshotEvidence.push({
                actionIndex: i + 1,
                actionType: 'screenshot',
                url: driverSession.getCurrentUrl(),
                sha256: shot.sha256,
                screenshotBase64: shot.base64,
                capturedAt: new Date().toISOString(),
              });
              break;
            }
          }

          finalUrl = driverSession.getCurrentUrl();

          // Capture screenshot after consequential interaction if requested
          if (
            (action.captureScreenshotAfter || action.type === 'click') &&
            sessionConfig.recordScreenshots !== false &&
            action.type !== 'screenshot'
          ) {
            const shot = await driverSession.captureScreenshot();
            screenshotEvidence.push({
              actionIndex: i + 1,
              actionType: action.type,
              url: finalUrl,
              sha256: shot.sha256,
              screenshotBase64: shot.base64,
              capturedAt: new Date().toISOString(),
            });
          }

          actionResults.push({
            action,
            status: 'completed',
            output,
            durationMs: Date.now() - actionStart,
          });
        } catch (actErr: any) {
          const actDuration = Date.now() - actionStart;
          actionResults.push({
            action,
            status: 'failed',
            error: actErr.message,
            durationMs: actDuration,
          });
          throw actErr;
        }
      }

      // 9. Capture Final State Evidence Screenshot
      if (sessionConfig.recordScreenshots !== false && screenshotEvidence.length === 0) {
        const finalShot = await driverSession.captureScreenshot();
        screenshotEvidence.push({
          actionIndex: actions.length,
          actionType: 'screenshot',
          url: finalUrl,
          sha256: finalShot.sha256,
          screenshotBase64: finalShot.base64,
          capturedAt: new Date().toISOString(),
        });
      }
    } catch (err: any) {
      if (err instanceof ReachSecurityViolationError) {
        sessionStatus = 'security_blocked';
      } else if (err instanceof ReachKillSwitchActiveError) {
        sessionStatus = 'killed';
      } else {
        sessionStatus = 'failed';
      }
      sessionError = err.message;
      throw err;
    } finally {
      clearTimeout(timeoutTimer);
      this.killSwitch.unregisterSession(sessionId);

      // Forceful ephemeral session destruction
      if (driverSession) {
        try {
          await driverSession.close();
        } catch (closeErr) {
          logger.error('Error closing driver session', closeErr);
        }
      }

      // Compute Combined Evidence Hash
      const combinedEvidenceHash = createHash('sha256')
        .update(screenshotEvidence.map((e) => e.sha256).join(':') || 'no_screenshots')
        .digest('hex');

      const totalDuration = Date.now() - startTime;
      let proofReceiptId: string | undefined;

      // 10. Record Cryptographic Proof Receipt
      if (sessionStatus === 'completed') {
        try {
          await TenantContextManager.withTenant(tenantId, 'default', async () => {
            const receipt = await this.proofService.issue({
              runId: sessionConfig.runId,
              actionType: 'reach.browser_interaction',
              riskTier: 'T2',
              actor: {
                agentSlug: sessionConfig.agentSlug || 'reach_worker',
              },
              mandate: params.mandateId
                ? { id: params.mandateId, decision: 'approved' }
                : undefined,
              target: {
                system: 'external_web_portal',
                externalRef: finalUrl,
              },
              verification: {
                method: 'screenshot_evidence',
                state: 'verified',
                observed: {
                  evidenceSha256: combinedEvidenceHash,
                  screenshotCount: screenshotEvidence.length,
                  actionsExecuted: actionResults.length,
                },
                verifiedAt: new Date().toISOString(),
              },
              input: {
                initialUrl: normalizedUrl,
                actionsRequested: actions.length,
              },
              output: {
                finalUrl,
                actionsCompleted: actionResults.filter((r) => r.status === 'completed').length,
                evidenceCount: screenshotEvidence.length,
              },
            });
            proofReceiptId = receipt.body.receiptId;
          });
        } catch (proofErr) {
          logger.error('Failed to issue ProofReceipt for Reach session', proofErr);
        }
      }

      // 11. Update Repository Record
      try {
        await this.repository.update(
          sessionId,
          {
            status: sessionStatus,
            final_url: finalUrl,
            actions_count: actionResults.length,
            proof_receipt_id: proofReceiptId || null,
            evidence_sha256: combinedEvidenceHash,
            error_message: sessionError || null,
            duration_ms: totalDuration,
          },
          tenantId
        );
      } catch (repoErr: any) {
        logger.warn(`Could not update reach_session record '${sessionId}': ${repoErr?.message}`);
      }

      return {
        sessionId,
        tenantId,
        runId: sessionConfig.runId,
        status: sessionStatus,
        results: actionResults,
        finalUrl,
        screenshotEvidence,
        proofReceiptId,
        durationMs: totalDuration,
        error: sessionError,
      };
    }
  }
}
