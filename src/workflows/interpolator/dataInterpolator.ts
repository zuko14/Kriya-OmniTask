/**
 * Xylarc AI — Workflow Data Interpolator
 * Resolves dynamic runtime expressions (${steps.stepId.output.property} and ${context.property}) across workflow payloads (§13 of CLAUDE.md).
 */

import { StepExecutionResult } from '../types/workflowTypes.js';

export interface InterpolationScope {
  context: Record<string, unknown>;
  steps: Record<string, StepExecutionResult>;
}

export class DataInterpolator {
  /**
   * Interpolates an arbitrary value (string, object, array, or primitive) using the scope.
   */
  public static interpolate<T = unknown>(value: T, scope: InterpolationScope): T {
    if (typeof value === 'string') {
      return this.interpolateString(value, scope) as unknown as T;
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.interpolate(item, scope)) as unknown as T;
    }

    if (value !== null && typeof value === 'object') {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        result[k] = this.interpolate(v, scope);
      }
      return result as unknown as T;
    }

    return value;
  }

  private static interpolateString(text: string, scope: InterpolationScope): unknown {
    const exactMatch = text.match(/^\$\{([^}]+)\}$/);
    if (exactMatch) {
      // Direct variable substitution (retaining data type like boolean, number, object)
      const path = exactMatch[1].trim();
      return this.resolvePath(path, scope);
    }

    // Embedded interpolation in string e.g. "Hello ${context.name}"
    return text.replace(/\$\{([^}]+)\}/g, (_, path) => {
      const resolved = this.resolvePath(path.trim(), scope);
      if (resolved === undefined || resolved === null) return '';
      if (typeof resolved === 'object') return JSON.stringify(resolved);
      return String(resolved);
    });
  }

  private static resolvePath(path: string, scope: InterpolationScope): unknown {
    const parts = path.split('.');
    const root = parts[0];

    let current: any;
    if (root === 'context') {
      current = scope.context;
    } else if (root === 'steps') {
      current = scope.steps;
    } else {
      // Fallback check in context
      current = scope.context;
      parts.unshift('context');
    }

    for (let i = 1; i < parts.length; i++) {
      if (current === undefined || current === null) return undefined;
      current = current[parts[i]];
    }

    return current;
  }
}
