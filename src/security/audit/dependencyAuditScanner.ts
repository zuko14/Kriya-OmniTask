/**
 * Kriya AI — Dependency & Native Code Execution Audit Scanner (WP-8.1, Blueprint §10, §14, ADR-028)
 *
 * Scans codebase files and dependency manifests for dangerous native functions
 * (eval, child_process.exec, vm.runInContext), prototype pollution vectors,
 * and insecure dependency configurations.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

export interface DangerousCodePattern {
  rule: string;
  category: 'dangerous_native_call' | 'prototype_pollution' | 'dynamic_code_execution';
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  regex: RegExp;
  description: string;
  remediation: string;
}

export interface DependencyRiskFinding {
  category: 'dangerous_native_call' | 'prototype_pollution' | 'dynamic_code_execution' | 'vulnerable_dependency' | 'unpinned_dependency';
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  rule: string;
  description: string;
  file?: string;
  line?: number;
  codeSnippet?: string;
  remediation: string;
}

export interface DependencyAuditReport {
  totalFilesScanned: number;
  totalFindings: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  riskScore: number;
  status: 'PASSED' | 'WARNING' | 'FAILED';
  findings: DependencyRiskFinding[];
  scannedAt: string;
}

export class DependencyAuditScanner {
  public static readonly DANGEROUS_PATTERNS: DangerousCodePattern[] = [
    {
      rule: 'NO_RAW_EVAL',
      category: 'dangerous_native_call',
      severity: 'CRITICAL',
      regex: /\beval\s*\(/g,
      description: 'Use of raw eval() allows arbitrary JavaScript code execution.',
      remediation: 'Replace eval() with safe JSON.parse() or deterministic parser logic.',
    },
    {
      rule: 'NO_FUNCTION_CONSTRUCTOR',
      category: 'dynamic_code_execution',
      severity: 'CRITICAL',
      regex: /\bnew\s+Function\s*\(|\bFunction\s*\([^)]*\)\s*\(/g,
      description: 'Dynamic code generation via Function constructor introduces injection risk.',
      remediation: 'Avoid dynamic runtime code generation from arbitrary strings.',
    },
    {
      rule: 'RESTRICTED_CHILD_PROCESS_EXEC',
      category: 'dangerous_native_call',
      severity: 'HIGH',
      regex: /\b(?:child_process|cp)\s*\.\s*(?:exec|execSync)\s*\(/g,
      description: 'child_process.exec executes commands via shell and is prone to command injection.',
      remediation: 'Use child_process.execFile() or spawn() with argument arrays and strict sanitization.',
    },
    {
      rule: 'NO_VM_UNSAFE_RUN',
      category: 'dynamic_code_execution',
      severity: 'CRITICAL',
      regex: /\bvm\s*\.\s*(?:runInThisContext|runInNewContext|runInContext)\s*\(/g,
      description: 'Node.js vm module does not provide a secure sandbox against host escape.',
      remediation: 'Use isolated execution environments (e.g. isolated worker processes or containers).',
    },
    {
      rule: 'PROTOTYPE_POLLUTION_ASSIGNMENT',
      category: 'prototype_pollution',
      severity: 'HIGH',
      regex: /\[\s*["'](?:__proto__|prototype|constructor)["']\s*\]\s*=/g,
      description: 'Direct assignment to __proto__ or prototype properties creates prototype pollution vulnerabilities.',
      remediation: 'Validate object keys and use Object.create(null) or Map data structures.',
    },
  ];

  /**
   * Scans a single code string for dangerous patterns.
   */
  public static scanCode(code: string, filePath?: string): DependencyRiskFinding[] {
    if (!code || typeof code !== 'string') return [];

    const findings: DependencyRiskFinding[] = [];
    const lines = code.split('\n');

    for (const pattern of DependencyAuditScanner.DANGEROUS_PATTERNS) {
      pattern.regex.lastIndex = 0;

      for (let i = 0; i < lines.length; i++) {
        const lineContent = lines[i];

        // Skip comments and import statements
        const trimmed = lineContent.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
          continue;
        }

        pattern.regex.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.regex.exec(lineContent)) !== null) {
          findings.push({
            category: pattern.category,
            severity: pattern.severity,
            rule: pattern.rule,
            description: pattern.description,
            file: filePath,
            line: i + 1,
            codeSnippet: trimmed.slice(0, 120),
            remediation: pattern.remediation,
          });
        }
      }
    }

    return findings;
  }

  /**
   * Scans package.json manifest for unpinned dependencies or risky configurations.
   */
  public static scanManifest(manifestContent: string, filePath?: string): DependencyRiskFinding[] {
    const findings: DependencyRiskFinding[] = [];
    let parsed: any;

    try {
      parsed = JSON.parse(manifestContent);
    } catch {
      return [{
        category: 'vulnerable_dependency',
        severity: 'MEDIUM',
        rule: 'INVALID_PACKAGE_JSON',
        description: 'Unable to parse package.json manifest as valid JSON.',
        file: filePath,
        remediation: 'Correct JSON syntax in package manifest.',
      }];
    }

    const checkDeps = (deps: Record<string, string> = {}, type: string) => {
      for (const [pkg, version] of Object.entries(deps)) {
        if (version === '*' || version === 'latest') {
          findings.push({
            category: 'unpinned_dependency',
            severity: 'HIGH',
            rule: 'UNPINNED_DEPENDENCY',
            description: `Package '${pkg}' uses wildcard or 'latest' version tag in ${type}.`,
            file: filePath,
            codeSnippet: `"${pkg}": "${version}"`,
            remediation: 'Pin exact or bounded semver range (e.g. ^1.2.3 or 1.2.3).',
          });
        }
      }
    };

    checkDeps(parsed.dependencies, 'dependencies');
    checkDeps(parsed.devDependencies, 'devDependencies');

    return findings;
  }

  /**
   * Runs an audit over a project directory.
   */
  public static async runAudit(projectRoot: string): Promise<DependencyAuditReport> {
    const findings: DependencyRiskFinding[] = [];
    let filesScanned = 0;

    const ignoreDirs = new Set(['node_modules', '.git', 'dist', 'coverage', '.gemini']);
    const codeExtensions = new Set(['.ts', '.js']);

    async function walk(currentDir: string): Promise<void> {
      let entries;
      try {
        entries = await fs.readdir(currentDir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);

        if (entry.isDirectory()) {
          if (!ignoreDirs.has(entry.name)) {
            await walk(fullPath);
          }
        } else if (entry.isFile()) {
          if (entry.name === 'package.json') {
            filesScanned++;
            try {
              const content = await fs.readFile(fullPath, 'utf-8');
              findings.push(...DependencyAuditScanner.scanManifest(content, fullPath));
            } catch {
              // Ignore read failure
            }
          } else {
            const ext = path.extname(entry.name).toLowerCase();
            if (codeExtensions.has(ext)) {
              filesScanned++;
              try {
                const content = await fs.readFile(fullPath, 'utf-8');
                findings.push(...DependencyAuditScanner.scanCode(content, fullPath));
              } catch {
                // Ignore read failure
              }
            }
          }
        }
      }
    }

    await walk(projectRoot);

    const criticalCount = findings.filter((f) => f.severity === 'CRITICAL').length;
    const highCount = findings.filter((f) => f.severity === 'HIGH').length;
    const mediumCount = findings.filter((f) => f.severity === 'MEDIUM').length;

    const riskScore = Math.min(100, criticalCount * 30 + highCount * 15 + mediumCount * 5);
    const status = criticalCount > 0 ? 'FAILED' : highCount > 0 ? 'WARNING' : 'PASSED';

    return {
      totalFilesScanned: filesScanned,
      totalFindings: findings.length,
      criticalCount,
      highCount,
      mediumCount,
      riskScore,
      status,
      findings,
      scannedAt: new Date().toISOString(),
    };
  }
}
