/**
 * Kriya Omnitask — Content Sanitizer & Prompt Injection Defense (§10.3, §10.4)
 * Strips active scripts, hidden HTML, zero-width characters, and embedded instruction injections.
 *
 * HARD RULE (§10.3, §10.4, Acceptance Criterion 3):
 * A page containing injection payloads produces a logged security event and NO behavior change.
 */

import { CryptoUtils } from '../../../core/utils/crypto.js';
import { auditLogger } from '../../../security/audit/auditLogger.js';
import { ExternalRetrievalRepository } from '../repositories/externalRetrievalRepository.js';
import { SanitizedWebContent } from '../types/externalRetrievalTypes.js';
import { logger } from '../../../core/logger/logger.js';

export interface SanitizationResult {
  sanitized: SanitizedWebContent;
  hasInjections: boolean;
  securityEventLogged: boolean;
}

export class ContentSanitizer {
  private repo: ExternalRetrievalRepository;

  // Heuristics for Indirect Prompt Injection in retrieved web data (§10.1, §10.3)
  private static readonly INJECTION_RULES: Array<{
    name: string;
    regex: RegExp;
    description: string;
  }> = [
    {
      name: 'system_prompt_override',
      regex: /(?:ignore|disregard|forget|bypass|override)\s+(?:all\s+)?(?:previous|prior|above)\s+(?:instructions|prompts|rules|commands|directives)/gi,
      description: 'Attempt to override prior system prompt or agent directives',
    },
    {
      name: 'role_jailbreak_initiation',
      regex: /(?:you\s+are\s+now|switch\s+to|enter)\s+(?:developer\s+mode|dan\s+mode|jailbreak|unrestricted\s+mode|god\s+mode)/gi,
      description: 'Attempt to initiate jailbreak or role escalation mode',
    },
    {
      name: 'system_prompt_exfiltration',
      regex: /(?:reveal|print|show|output|echo|display|leak|give|tell)\s+(?:me\s+)?(?:your\s+|the\s+)?(?:system\s+prompt|initial\s+instructions|system\s+message|core\s+directive|hidden\s+prompt)/gi,
      description: 'Attempt to exfiltrate core system prompt or instructions',
    },
    {
      name: 'instruction_delimiter_spoofing',
      regex: /<system_override>|\[SYSTEM\]|\[INST\]|\[ADMIN_OVERRIDE\]|`system_directive`|<<SYS>>/gi,
      description: 'Spoofed system or instruction delimiter markers',
    },
    {
      name: 'goal_hijack_directive',
      regex: /(?:your\s+new\s+(?:task|goal|objective)\s+is|you\s+must\s+now\s+(?:transfer|send|call|execute|delete|exfiltrate))/gi,
      description: 'Attempt to hijack agent objective and force mutative action',
    },
    {
      name: 'markdown_image_exfiltration',
      regex: /!\[[^\]]*\]\(\s*https?:\/\/[^\s\)]+(?:\?|&)(?:token|secret|key|pwd|password|data|exfil)=[^)]*\)/gi,
      description: 'Markdown image beacon tag for silent data exfiltration',
    },
  ];

  constructor(repo?: ExternalRetrievalRepository) {
    this.repo = repo || new ExternalRetrievalRepository();
  }

  /**
   * Sanitizes raw HTML or text content retrieved from an external source.
   */
  public async sanitize(
    rawContent: string,
    sourceUrl: string,
    context?: { tenantId?: string; correlationId?: string; agentSlug?: string }
  ): Promise<SanitizationResult> {
    const parsedUrl = new URL(sourceUrl);
    const domain = parsedUrl.hostname.toLowerCase();
    const retrievedAt = new Date().toISOString();

    let cleaned = rawContent || '';

    // 1. Strip script, style, iframe, object, embed, noscript tags and HTML comments
    cleaned = cleaned
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '')
      .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
      .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '')
      .replace(/<embed\b[^<]*(?:(?!<\/embed>)<[^<]*)*<\/embed>/gi, '')
      .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '');

    // 2. Strip hidden HTML elements (CSS display:none, visibility:hidden, font-size:0, hidden attributes)
    cleaned = cleaned
      .replace(/<[^>]+style=["'][^"']*(?:display:\s*none|visibility:\s*hidden|font-size:\s*0|opacity:\s*0)[^"']*["'][^>]*>[\s\S]*?<\/[^>]+>/gi, '')
      .replace(/<[^>]+(?:hidden|aria-hidden=["']true["'])[^>]*>[\s\S]*?<\/[^>]+>/gi, '');

    // 3. Strip HTML tags to convert to plain text
    cleaned = cleaned.replace(/<[^>]+>/g, ' ');

    // 4. Strip zero-width, invisible, and control Unicode characters
    cleaned = cleaned.replace(/[\u200B-\u200D\uFEFF\u2060\u00AD\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

    // 5. Decode basic HTML entities
    cleaned = cleaned
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");

    // 6. Detect and Neutralize Indirect Prompt Injection Payloads
    const injectionsDetected: string[] = [];

    for (const rule of ContentSanitizer.INJECTION_RULES) {
      rule.regex.lastIndex = 0;
      const matches = cleaned.match(rule.regex);
      if (matches && matches.length > 0) {
        injectionsDetected.push(rule.name);
        // Neutralize injection by replacing matched payload with [REDACTED_INJECTION_PAYLOAD]
        cleaned = cleaned.replace(rule.regex, '[REDACTED_INJECTION_PAYLOAD]');
      }
    }

    // Collapse whitespace
    cleaned = cleaned.replace(/\s+/g, ' ').trim();

    // 7. Compute deterministic content hash (SHA-256)
    const contentHash = `sha256:${CryptoUtils.hashSha256(cleaned)}`;

    const hasInjections = injectionsDetected.length > 0;
    let securityEventLogged = false;

    if (hasInjections) {
      securityEventLogged = true;
      logger.warn(
        `ContentSanitizer intercepted indirect prompt injection on domain '${domain}' (${sourceUrl})`,
        { injectionsDetected, domain, sourceUrl, ...context }
      );

      // A. Log Security Event to Immutable Audit Trail
      await auditLogger.logEvent({
        action: 'external_retrieval.injection_detected',
        resourceType: 'external_domain',
        resourceId: domain,
        details: {
          domain,
          sourceUrl,
          injectionsDetected,
          contentHash,
          tenantId: context?.tenantId,
          correlationId: context?.correlationId,
          agentSlug: context?.agentSlug,
        },
      });

      // B. Record Strike against Domain in Reputation Ledger (§10.4)
      await this.repo.recordInjectionStrike(
        domain,
        `Detected injection patterns: ${injectionsDetected.join(', ')}`
      );
    }

    const sanitizedContent: SanitizedWebContent = {
      sourceUrl,
      domain,
      textContent: cleaned,
      contentHash,
      injectionsDetected,
      retrievedAt,
    };

    return {
      sanitized: sanitizedContent,
      hasInjections,
      securityEventLogged,
    };
  }
}
