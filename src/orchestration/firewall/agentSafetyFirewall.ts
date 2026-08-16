/**
 * Xylarc AI — Agent Safety Firewall
 * Centralized, deterministic runtime policy firewall independent of LLMs (§26 of CLAUDE.md).
 * Enforces prompt injection defenses, PII leakage prevention, data scope boundaries,
 * and risk-based autonomy validation.
 */

import { AutonomyLevel, RiskTier } from '../../agents/types/agentTypes.js';
import { logger } from '../../core/logger/logger.js';

export interface FirewallScanRequest {
  tenantId: string;
  agentId?: string;
  agentSlug?: string;
  inputContent?: string;
  outputContent?: string;
  requestedTools?: string[];
  requestedDataScopes?: string[];
  allowedDataScopes?: string[];
  actionRiskTier?: RiskTier;
  agentAutonomyLevel?: AutonomyLevel;
}

export interface FirewallViolation {
  category: 'prompt_injection' | 'jailbreak' | 'pii_leakage' | 'secret_leakage' | 'scope_violation' | 'autonomy_violation';
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  description: string;
  detectedPattern?: string;
}

export interface FirewallScanResult {
  allowed: boolean;
  blockReason?: string;
  violations: FirewallViolation[];
  sanitizedInput?: string;
  sanitizedOutput?: string;
  requiresHumanApproval: boolean;
}

export class AgentSafetyFirewall {
  // Regex heuristics for prompt injection & jailbreak attempts
  private static readonly INJECTION_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
    {
      pattern: /(ignore|disregard|forget|bypass|override)\s+(all\s+)?(previous|prior|above)\s+(instructions|prompts|rules|commands|directives)/i,
      description: 'System prompt override instruction attempt',
    },
    {
      pattern: /(you\s+are\s+now|switch\s+to|enter)\s+(developer\s+mode|dan\s+mode|jailbreak|unrestricted\s+mode|god\s+mode)/i,
      description: 'Jailbreak mode initiation attempt',
    },
    {
      pattern: /(reveal|print|show|output|echo|display|leak|give|tell)\s+(me\s+)?(your\s+|the\s+)?(system\s+prompt|initial\s+instructions|system\s+message|core\s+directive|hidden\s+prompt)/i,
      description: 'System prompt exfiltration attempt',
    },
    {
      pattern: /<system_override>|\[SYSTEM\]|\[INST\]|\[ADMIN_OVERRIDE\]|`system_directive`/i,
      description: 'Delimiter / role injection marker spoofing',
    },
    {
      pattern: /(do\s+anything\s+now|disable\s+all\s+(safety|content)\s+filters)/i,
      description: 'Safety filter bypass attempt',
    },
  ];

  // Regex patterns for sensitive PII and secrets
  private static readonly SENSITIVE_PATTERNS: Array<{ pattern: RegExp; type: 'credit_card' | 'ssn' | 'api_key' | 'jwt' }> = [
    {
      // Standard Luhn-compatible 13-16 digit credit card patterns
      pattern: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|3(?:0[0-5]|[68][0-9])[0-9]{11}|6(?:011|5[0-9]{2})[0-9]{12}|(?:2131|1800|35\d{3})\d{11})\b/,
      type: 'credit_card',
    },
    {
      // US SSN pattern: XXX-XX-XXXX
      pattern: /\b\d{3}-\d{2}-\d{4}\b/,
      type: 'ssn',
    },
    {
      // API Key / Secret Key patterns
      pattern: /\b(?:sk-[a-zA-Z0-9]{20,}|AKIA[0-9A-Z]{16}|xylarc_sec_[a-zA-Z0-9]{24,})\b/,
      type: 'api_key',
    },
    {
      // JWT token format: eyJ...
      pattern: /\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/,
      type: 'jwt',
    },
  ];

  /**
   * Scans agent request and content before execution against deterministic safety policies.
   */
  public static scan(req: FirewallScanRequest): FirewallScanResult {
    const violations: FirewallViolation[] = [];
    let sanitizedInput = req.inputContent;
    let sanitizedOutput = req.outputContent;

    // 1. Inbound Prompt Injection & Jailbreak Scanning
    if (req.inputContent) {
      for (const { pattern, description } of this.INJECTION_PATTERNS) {
        if (pattern.test(req.inputContent)) {
          violations.push({
            category: 'prompt_injection',
            severity: 'CRITICAL',
            description,
            detectedPattern: pattern.source,
          });
        }
      }
    }

    // 2. Sensitive Data & Secret Leakage Inspection
    if (req.outputContent) {
      for (const { pattern, type } of this.SENSITIVE_PATTERNS) {
        if (pattern.test(req.outputContent)) {
          violations.push({
            category: type === 'api_key' || type === 'jwt' ? 'secret_leakage' : 'pii_leakage',
            severity: 'HIGH',
            description: `Potential unmasked ${type.toUpperCase()} detected in output content.`,
          });
          // Sanitize/mask output
          sanitizedOutput = sanitizedOutput?.replace(pattern, '[REDACTED_SENSITIVE_DATA]');
        }
      }
    }

    // 3. Data Access Scope Validation
    if (req.requestedDataScopes && req.allowedDataScopes) {
      for (const scope of req.requestedDataScopes) {
        if (!req.allowedDataScopes.includes(scope) && !req.allowedDataScopes.includes('*')) {
          violations.push({
            category: 'scope_violation',
            severity: 'HIGH',
            description: `Data access scope '${scope}' is not permitted for agent '${req.agentSlug || 'unknown'}'. Allowed scopes: [${req.allowedDataScopes.join(', ')}]`,
          });
        }
      }
    }

    // 4. Autonomy Level vs Action Risk Control (§15 of CLAUDE.md)
    let requiresHumanApproval = false;

    if (req.actionRiskTier && req.agentAutonomyLevel !== undefined) {
      const autonomy = req.agentAutonomyLevel;
      const risk = req.actionRiskTier;

      // Level 0: Observe only - cannot perform any mutations
      if (autonomy === 0 && risk !== 'LOW') {
        violations.push({
          category: 'autonomy_violation',
          severity: 'HIGH',
          description: `Agent is at Autonomy Level 0 (Observe Only) and cannot perform '${risk}' risk actions.`,
        });
      }

      // Level 1: Suggest only - all actions require explicit human approval
      if (autonomy === 1 && (risk === 'MEDIUM' || risk === 'HIGH' || risk === 'CRITICAL')) {
        requiresHumanApproval = true;
      }

      // Level 2: Low-risk autonomous - requires approval for HIGH and CRITICAL
      if (autonomy === 2 && (risk === 'HIGH' || risk === 'CRITICAL')) {
        requiresHumanApproval = true;
      }

      // Level 3: Conditional autonomous - CRITICAL always requires human approval (§15 & §37)
      if (autonomy === 3 && risk === 'CRITICAL') {
        requiresHumanApproval = true;
      }

      // Level 4 & 5: CRITICAL actions still flag approval if explicit policy demands it
      if (risk === 'CRITICAL') {
        requiresHumanApproval = true;
      }
    }

    const hasCriticalViolation = violations.some((v) => v.severity === 'CRITICAL' || v.category === 'prompt_injection');
    const isAllowed = !hasCriticalViolation && violations.length === 0;

    if (!isAllowed) {
      logger.warn(`Agent Safety Firewall intercepted violation for agent '${req.agentSlug || req.agentId}':`, {
        tenantId: req.tenantId,
        violations,
      });
    }

    return {
      allowed: isAllowed,
      blockReason: violations.length > 0 ? violations.map((v) => v.description).join('; ') : undefined,
      violations,
      sanitizedInput,
      sanitizedOutput,
      requiresHumanApproval,
    };
  }

  /**
   * Sanitizes text to remove control characters and delimiter injection attempts.
   */
  public static sanitizeInput(text: string): string {
    return text
      .replace(/[\u0000-\u0008\u000B-\u000C\u000E-\u001F\u007F]/g, '') // remove ASCII control chars
      .replace(/`{3,}/g, '```') // normalize code backticks
      .trim();
  }
}
