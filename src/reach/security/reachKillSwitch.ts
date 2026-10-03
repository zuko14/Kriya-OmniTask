/**
 * Kriya Omnitask — Reach Browser Emergency Kill Switch (WP-5.5, Blueprint §10, §15, ADR-022)
 *
 * Provides immediate platform-wide, tenant-scoped, and in-flight session
 * kill capabilities to stop rogue or anomalous browser automations instantly.
 */

import { logger } from '../../core/logger/logger.js';
import { ReachKillSwitchActiveError } from '../types/reachTypes.js';

interface KillStatus {
  active: boolean;
  reason?: string;
  activatedAt?: string;
}

interface ActiveSessionHandle {
  sessionId: string;
  tenantId: string;
  controller: AbortController;
  startedAt: string;
}

export class ReachKillSwitch {
  private static instance: ReachKillSwitch | null = null;

  private globalKill: KillStatus = { active: false };
  private tenantKills: Map<string, KillStatus> = new Map();
  private activeSessions: Map<string, ActiveSessionHandle> = new Map();

  public static getInstance(): ReachKillSwitch {
    if (!ReachKillSwitch.instance) {
      ReachKillSwitch.instance = new ReachKillSwitch();
    }
    return ReachKillSwitch.instance;
  }

  /**
   * Activates or deactivates the platform-wide global Reach browser kill switch.
   */
  public setGlobalKillSwitch(active: boolean, reason?: string): void {
    this.globalKill = {
      active,
      reason: active ? reason || 'Emergency platform administrative intervention' : undefined,
      activatedAt: active ? new Date().toISOString() : undefined,
    };

    if (active) {
      logger.warn(`[REACH KILL SWITCH] Global browser kill switch ACTIVATED: ${reason}`);
      this.killAllSessions(reason || 'Global kill switch activated');
    } else {
      logger.info('[REACH KILL SWITCH] Global browser kill switch DEACTIVATED.');
    }
  }

  /**
   * Checks global kill switch status.
   */
  public isGlobalKillSwitchActive(): KillStatus {
    return { ...this.globalKill };
  }

  /**
   * Activates or deactivates a tenant-scoped Reach browser kill switch.
   */
  public setTenantKillSwitch(tenantId: string, active: boolean, reason?: string): void {
    if (active) {
      const status: KillStatus = {
        active: true,
        reason: reason || 'Tenant-specific administrative intervention',
        activatedAt: new Date().toISOString(),
      };
      this.tenantKills.set(tenantId, status);
      logger.warn(`[REACH KILL SWITCH] Tenant '${tenantId}' browser kill switch ACTIVATED: ${reason}`);
      this.killTenantSessions(tenantId, reason || 'Tenant kill switch activated');
    } else {
      this.tenantKills.delete(tenantId);
      logger.info(`[REACH KILL SWITCH] Tenant '${tenantId}' browser kill switch DEACTIVATED.`);
    }
  }

  /**
   * Checks tenant kill switch status.
   */
  public isTenantKillSwitchActive(tenantId: string): KillStatus {
    const status = this.tenantKills.get(tenantId);
    return status ? { ...status } : { active: false };
  }

  /**
   * Asserts that neither the global nor the tenant kill switch is active.
   * Throws ReachKillSwitchActiveError if execution is blocked.
   */
  public assertNotKilled(tenantId: string): void {
    if (this.globalKill.active) {
      throw new ReachKillSwitchActiveError(
        `Reach browser automation blocked: Global kill switch is active (${this.globalKill.reason}).`
      );
    }

    const tenantStatus = this.tenantKills.get(tenantId);
    if (tenantStatus && tenantStatus.active) {
      throw new ReachKillSwitchActiveError(
        `Reach browser automation blocked for tenant '${tenantId}': Kill switch is active (${tenantStatus.reason}).`
      );
    }
  }

  /**
   * Registers an active in-flight browser session.
   */
  public registerSession(sessionId: string, tenantId: string, controller: AbortController): void {
    this.activeSessions.set(sessionId, {
      sessionId,
      tenantId,
      controller,
      startedAt: new Date().toISOString(),
    });
  }

  /**
   * Unregisters a completed or terminated browser session.
   */
  public unregisterSession(sessionId: string): void {
    this.activeSessions.delete(sessionId);
  }

  /**
   * Immediately aborts and terminates an in-flight session by ID.
   */
  public killSession(sessionId: string, reason = 'Administrative cancellation'): boolean {
    const session = this.activeSessions.get(sessionId);
    if (!session) return false;

    try {
      session.controller.abort(new Error(`Session killed: ${reason}`));
      this.activeSessions.delete(sessionId);
      logger.warn(`[REACH KILL SWITCH] Killed active session '${sessionId}': ${reason}`);
      return true;
    } catch (err) {
      logger.error(`Error aborting session '${sessionId}'`, err);
      return false;
    }
  }

  /**
   * Immediately terminates all active in-flight sessions for a specific tenant.
   */
  public killTenantSessions(tenantId: string, reason = 'Tenant kill switch activated'): number {
    let killed = 0;
    for (const [sessionId, session] of this.activeSessions.entries()) {
      if (session.tenantId === tenantId) {
        if (this.killSession(sessionId, reason)) {
          killed++;
        }
      }
    }
    return killed;
  }

  /**
   * Immediately terminates all active in-flight browser sessions platform-wide.
   */
  public killAllSessions(reason = 'Global kill switch activated'): number {
    let killed = 0;
    for (const sessionId of Array.from(this.activeSessions.keys())) {
      if (this.killSession(sessionId, reason)) {
        killed++;
      }
    }
    return killed;
  }

  /**
   * Cleans state for unit tests.
   */
  public resetForTesting(): void {
    this.globalKill = { active: false };
    this.tenantKills.clear();
    this.activeSessions.clear();
  }
}
