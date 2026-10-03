/**
 * Kriya Omnitask — Outbound PII Scrubber (§10.3, §10.4)
 * Deterministic detection of Personal Identifiable Information (PII) in outbound queries.
 *
 * HARD RULE (§10.3, §10.4):
 * A query containing PII is BLOCKED, never sanitized-and-sent.
 */

import { AppError } from '../../../core/errors/errors.js';
import { logger } from '../../../core/logger/logger.js';

export class PiiQueryBlockedError extends AppError {
  public readonly code = 'PII_QUERY_BLOCKED';
  public readonly statusCode = 400;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details, true);
  }
}

export interface PiiViolation {
  category: 'email' | 'phone' | 'aadhaar' | 'pan' | 'ssn' | 'credit_card' | 'address';
  patternName: string;
  matchedTextMasked: string;
}

export interface PiiScanResult {
  isClean: boolean;
  blocked: boolean;
  violations: PiiViolation[];
  blockReason?: string;
}

export class PiiScrubber {
  // Deterministic Regex Matchers for PII
  private static readonly PII_PATTERNS: Array<{
    category: PiiViolation['category'];
    name: string;
    regex: RegExp;
  }> = [
    // 1. Email addresses
    {
      category: 'email',
      name: 'Email Address',
      regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gi,
    },
    // 2. Indian Phone Numbers (E.164 and 10-digit mobile)
    {
      category: 'phone',
      name: 'Indian Phone Number',
      regex: /(?:\+91[\-\s]?)?[6-9]\d{9}\b/g,
    },
    // 3. International E.164 & standard phone formats
    {
      category: 'phone',
      name: 'International Phone Number',
      regex: /\b\+?[1-9]\d{0,2}[-.\s]?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}\b/g,
    },
    // 4. Indian Aadhaar Card (12 digits)
    {
      category: 'aadhaar',
      name: 'Aadhaar Number',
      regex: /\b\d{4}[\s-]\d{4}[\s-]\d{4}\b/g,
    },
    // 5. Indian PAN Card (5 letters, 4 numbers, 1 letter)
    {
      category: 'pan',
      name: 'Permanent Account Number (PAN)',
      regex: /\b[A-Z]{5}[0-9]{4}[A-Z]{1}\b/g,
    },
    // 6. US Social Security Number (SSN)
    {
      category: 'ssn',
      name: 'Social Security Number',
      regex: /\b\d{3}-\d{2}-\d{4}\b/g,
    },
    // 7. Credit Card / Debit Card Numbers (13-19 digits)
    {
      category: 'credit_card',
      name: 'Credit Card Number',
      regex: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
    },
    // 8. Specific Street Address patterns
    {
      category: 'address',
      name: 'Street Address Pattern',
      regex: /\b\d{1,5}\s+(?:street|st|avenue|ave|road|rd|lane|ln|drive|dr|nagar|colony|layout|sector|block)\b/gi,
    },
  ];

  /**
   * Scans text for any PII.
   * If PII is detected, returns blocked = true.
   */
  public static scan(text: string): PiiScanResult {
    if (!text || typeof text !== 'string') {
      return { isClean: true, blocked: false, violations: [] };
    }

    const violations: PiiViolation[] = [];

    for (const pattern of this.PII_PATTERNS) {
      pattern.regex.lastIndex = 0; // Reset stateful regexes
      const matches = text.match(pattern.regex);
      if (matches && matches.length > 0) {
        for (const match of matches) {
          violations.push({
            category: pattern.category,
            patternName: pattern.name,
            matchedTextMasked: this.mask(match),
          });
        }
      }
    }

    if (violations.length > 0) {
      const blockReason = `Outbound query contains sensitive PII (${violations.map((v) => v.patternName).join(', ')}). Query blocked per §10.3.`;
      return {
        isClean: false,
        blocked: true,
        violations,
        blockReason,
      };
    }

    return {
      isClean: true,
      blocked: false,
      violations: [],
    };
  }

  /**
   * Asserts that text has no PII.
   * THROWS PiiQueryBlockedError if PII is detected, ensuring execution halts immediately.
   */
  public static assertNoPii(text: string, context?: Record<string, unknown>): void {
    const result = this.scan(text);
    if (!result.isClean || result.blocked) {
      logger.warn(`PII Scrubber blocked outbound query: ${result.blockReason}`, {
        violations: result.violations,
        ...context,
      });
      throw new PiiQueryBlockedError(
        result.blockReason || 'Outbound query blocked due to PII detection.',
        { violations: result.violations, ...context }
      );
    }
  }

  private static mask(value: string): string {
    if (value.length <= 4) return '***';
    return `${value.substring(0, 2)}***${value.substring(value.length - 2)}`;
  }

  /**
   * Deterministically redacts sensitive PII from string inputs for logging, traces, and spans (WP-2.6).
   */
  public static redact(text: string): string {
    if (!text || typeof text !== 'string') return text;
    let redacted = text;

    // 1. Credit Cards (13-19 digits with separators)
    redacted = redacted.replace(/\b(?:\d{4}[-\s]?){3}\d{4}\b/g, '[REDACTED_CREDIT_CARD]');

    // 2. Aadhaar Numbers (12 digits with separators)
    redacted = redacted.replace(/\b\d{4}[\s-]\d{4}[\s-]\d{4}\b/g, '[REDACTED_AADHAAR]');

    // 3. Social Security Numbers
    redacted = redacted.replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[REDACTED_SSN]');

    // 4. Email addresses
    redacted = redacted.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gi, '[REDACTED_EMAIL]');

    // 5. PAN Cards
    redacted = redacted.replace(/\b[A-Z]{5}[0-9]{4}[A-Z]{1}\b/g, '[REDACTED_PAN]');

    // 6. Indian Phone Numbers (+91 or 10-digit mobile)
    redacted = redacted.replace(/(?:\+91[\-\s]?)?[6-9]\d{9}\b/g, '[REDACTED_PHONE]');

    // 7. General international phone formats
    redacted = redacted.replace(/\b\+?[1-9]\d{0,2}[-.\s]?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}\b/g, '[REDACTED_PHONE]');

    return redacted;
  }

  /**
   * Recursively traverses and sanitizes nested records, arrays, and primitive strings, ensuring no raw PII leaks into traces or spans.
   */
  public static redactObject<T>(input: T): T {
    if (input === null || input === undefined) return input;
    if (typeof input === 'string') {
      return this.redact(input) as unknown as T;
    }
    if (Array.isArray(input)) {
      return input.map((item) => this.redactObject(item)) as unknown as T;
    }
    if (typeof input === 'object') {
      const cloned: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
        cloned[key] = this.redactObject(value);
      }
      return cloned as T;
    }
    return input;
  }
}
