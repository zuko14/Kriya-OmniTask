/**
 * Kriya AI — Secret Leakage Scanner & Sanitizer (WP-8.1, Blueprint §10, §14, ADR-028)
 *
 * Scans code, logs, network traces, and payloads for leaked credentials, API tokens,
 * cryptographic keys, and high-entropy secrets, providing automated detection and redaction.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

export interface SecretPatternDefinition {
  type: string;
  name: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  regex: RegExp;
  description: string;
}

export interface SecretLeakageFinding {
  secretType: string;
  name: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  description: string;
  preview: string;
  line?: number;
  filePath?: string;
}

export class SecretLeakageScanner {
  public static readonly PATTERNS: SecretPatternDefinition[] = [
    {
      type: 'openai_api_key',
      name: 'OpenAI API Key',
      severity: 'CRITICAL',
      regex: /\bsk-[a-zA-Z0-9_-]{20,}\b/g,
      description: 'Exposed OpenAI secret API key (starts with sk-)',
    },
    {
      type: 'razorpay_key',
      name: 'Razorpay Key',
      severity: 'HIGH',
      regex: /\brzp_(?:test|live)_[a-zA-Z0-9]{14,}\b/g,
      description: 'Exposed Razorpay API key identifier or secret (rzp_test_ or rzp_live_)',
    },
    {
      type: 'github_token',
      name: 'GitHub Personal Access Token',
      severity: 'CRITICAL',
      regex: /\b(?:ghp_[a-zA-Z0-9]{36}|github_pat_[a-zA-Z0-9_]{50,})\b/g,
      description: 'Exposed GitHub Personal Access Token',
    },
    {
      type: 'private_key',
      name: 'Cryptographic Private Key Block',
      severity: 'CRITICAL',
      regex: /-----BEGIN (?:[A-Z0-9_-]+ )?PRIVATE KEY-----/g,
      description: 'Unencrypted PEM-encoded cryptographic private key',
    },
    {
      type: 'jwt_token',
      name: 'JSON Web Token (JWT)',
      severity: 'HIGH',
      regex: /\bey[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/g,
      description: 'Raw JWT Bearer authorization token',
    },
    {
      type: 'aws_access_key',
      name: 'AWS Access Key ID',
      severity: 'HIGH',
      regex: /\bAKIA[0-9A-Z]{16}\b/g,
      description: 'Exposed AWS Access Key ID',
    },
    {
      type: 'slack_token',
      name: 'Slack Bot or User Token',
      severity: 'HIGH',
      regex: /\bxox[baprs]-[0-9]{10,13}-[0-9]{10,13}-[a-zA-Z0-9]{24,}\b/g,
      description: 'Exposed Slack OAuth/API Token',
    },
    {
      type: 'stripe_key',
      name: 'Stripe Secret Key',
      severity: 'CRITICAL',
      regex: /\bsk_(?:test|live)_[0-9a-zA-Z]{24,}\b/g,
      description: 'Exposed Stripe API Secret Key',
    },
    {
      type: 'hardcoded_credential',
      name: 'Hardcoded Secret Assignment',
      severity: 'HIGH',
      regex: /(?:api[_-]?key|access[_-]?token|secret[_-]?key|auth[_-]?token|client[_-]?secret)\s*[:=]\s*["']([A-Za-z0-9+/=_\-]{24,})["']/gi,
      description: 'Hardcoded variable assignment containing high-entropy credential value',
    },
  ];

  /**
   * Scans a text string for secret leakage.
   */
  public static scanContent(content: string, filePath?: string): SecretLeakageFinding[] {
    if (!content || typeof content !== 'string') return [];

    const findings: SecretLeakageFinding[] = [];
    const lines = content.split('\n');

    for (const pattern of SecretLeakageScanner.PATTERNS) {
      // Reset state for global regex
      pattern.regex.lastIndex = 0;

      for (let i = 0; i < lines.length; i++) {
        const lineContent = lines[i];
        let match: RegExpExecArray | null;

        while ((match = pattern.regex.exec(lineContent)) !== null) {
          const matchedVal = match[0];
          const masked = SecretLeakageScanner.maskSecret(matchedVal);

          findings.push({
            secretType: pattern.type,
            name: pattern.name,
            severity: pattern.severity,
            description: pattern.description,
            preview: masked,
            line: i + 1,
            filePath,
          });
        }
      }
    }

    return findings;
  }

  /**
   * Redacts all detected secrets in the content, replacing them with a safe placeholder.
   */
  public static redactSecrets(content: string): string {
    if (!content || typeof content !== 'string') return content;

    let redacted = content;
    for (const pattern of SecretLeakageScanner.PATTERNS) {
      pattern.regex.lastIndex = 0;
      redacted = redacted.replace(pattern.regex, (match) => {
        return `[REDACTED_${pattern.type.toUpperCase()}]`;
      });
    }

    return redacted;
  }

  /**
   * Recursively scans an object for secret leakage in strings.
   */
  public static scanObject(obj: unknown, prefix: string = ''): SecretLeakageFinding[] {
    if (!obj) return [];
    const findings: SecretLeakageFinding[] = [];

    if (typeof obj === 'string') {
      const results = SecretLeakageScanner.scanContent(obj, prefix || 'object');
      findings.push(...results);
    } else if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        findings.push(...SecretLeakageScanner.scanObject(obj[i], `${prefix}[${i}]`));
      }
    } else if (typeof obj === 'object') {
      for (const [key, value] of Object.entries(obj)) {
        findings.push(...SecretLeakageScanner.scanObject(value, prefix ? `${prefix}.${key}` : key));
      }
    }

    return findings;
  }

  /**
   * Masks a secret string keeping only first 3 and last 3 characters.
   */
  public static maskSecret(secret: string): string {
    if (secret.length <= 8) {
      return '****';
    }
    const prefix = secret.slice(0, 3);
    const suffix = secret.slice(-3);
    return `${prefix}${'*'.repeat(Math.min(16, secret.length - 6))}${suffix}`;
  }

  /**
   * Scans a directory of files for exposed secrets.
   */
  public static async scanDirectory(
    dirPath: string,
    options: {
      extensions?: string[];
      ignoreDirs?: string[];
      maxFiles?: number;
    } = {}
  ): Promise<SecretLeakageFinding[]> {
    const extensions = options.extensions || ['.ts', '.js', '.json', '.env', '.yaml', '.yml', '.md'];
    const ignoreDirs = new Set(options.ignoreDirs || ['node_modules', '.git', 'dist', 'coverage', '.gemini']);
    const maxFiles = options.maxFiles || 500;

    const findings: SecretLeakageFinding[] = [];
    let fileCount = 0;

    async function walk(currentDir: string): Promise<void> {
      if (fileCount >= maxFiles) return;

      let entries;
      try {
        entries = await fs.readdir(currentDir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (fileCount >= maxFiles) break;

        const fullPath = path.join(currentDir, entry.name);

        if (entry.isDirectory()) {
          if (!ignoreDirs.has(entry.name)) {
            await walk(fullPath);
          }
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (extensions.includes(ext) || entry.name.startsWith('.env')) {
            fileCount++;
            try {
              const content = await fs.readFile(fullPath, 'utf-8');
              const fileFindings = SecretLeakageScanner.scanContent(content, fullPath);
              findings.push(...fileFindings);
            } catch {
              // Ignore unreadable files
            }
          }
        }
      }
    }

    await walk(dirPath);
    return findings;
  }
}
