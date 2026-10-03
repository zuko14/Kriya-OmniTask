/**
 * Kriya AI — Policy Condition Evaluator
 * Pure deterministic condition tree evaluator supporting nested fields, operators, and boolean logic (§14 of CLAUDE.md).
 */

import {
  ConditionExpression,
  SimpleCondition,
  CompositeCondition,
} from '../types/policyTypes.js';

export class ConditionEvaluator {
  /**
   * Evaluates a condition expression against a target data context.
   * Returns true if the condition matches (trips), false otherwise.
   */
  public static evaluate(
    condition: ConditionExpression,
    context: Record<string, unknown>
  ): boolean {
    if ('logical' in condition) {
      return this.evaluateComposite(condition as CompositeCondition, context);
    }
    return this.evaluateSimple(condition as SimpleCondition, context);
  }

  private static evaluateComposite(
    composite: CompositeCondition,
    context: Record<string, unknown>
  ): boolean {
    if (composite.logical === 'AND') {
      return composite.conditions.every((c) => this.evaluate(c, context));
    }
    if (composite.logical === 'OR') {
      return composite.conditions.some((c) => this.evaluate(c, context));
    }
    if (composite.logical === 'NOT') {
      return !composite.conditions.some((c) => this.evaluate(c, context));
    }
    return false;
  }

  private static evaluateSimple(
    simple: SimpleCondition,
    context: Record<string, unknown>
  ): boolean {
    const fieldValue = this.resolveFieldPath(context, simple.field);

    switch (simple.operator) {
      case 'EQUALS':
        return fieldValue === simple.value;

      case 'NOT_EQUALS':
        return fieldValue !== simple.value;

      case 'GREATER_THAN':
        return (
          typeof fieldValue === 'number' &&
          typeof simple.value === 'number' &&
          fieldValue > simple.value
        );

      case 'GREATER_THAN_OR_EQUAL':
        return (
          typeof fieldValue === 'number' &&
          typeof simple.value === 'number' &&
          fieldValue >= simple.value
        );

      case 'LESS_THAN':
        return (
          typeof fieldValue === 'number' &&
          typeof simple.value === 'number' &&
          fieldValue < simple.value
        );

      case 'LESS_THAN_OR_EQUAL':
        return (
          typeof fieldValue === 'number' &&
          typeof simple.value === 'number' &&
          fieldValue <= simple.value
        );

      case 'IN':
        return Array.isArray(simple.value) && simple.value.includes(fieldValue);

      case 'NOT_IN':
        return Array.isArray(simple.value) && !simple.value.includes(fieldValue);

      case 'CONTAINS':
        if (typeof fieldValue === 'string' && typeof simple.value === 'string') {
          return fieldValue.toLowerCase().includes(simple.value.toLowerCase());
        }
        if (Array.isArray(fieldValue)) {
          return fieldValue.includes(simple.value);
        }
        return false;

      case 'NOT_CONTAINS':
        if (typeof fieldValue === 'string' && typeof simple.value === 'string') {
          return !fieldValue.toLowerCase().includes(simple.value.toLowerCase());
        }
        if (Array.isArray(fieldValue)) {
          return !fieldValue.includes(simple.value);
        }
        return true;

      case 'REGEX_MATCH':
        if (typeof fieldValue === 'string' && typeof simple.value === 'string') {
          try {
            const regex = new RegExp(simple.value, 'i');
            return regex.test(fieldValue);
          } catch {
            return false;
          }
        }
        return false;

      case 'EXISTS':
        return fieldValue !== undefined && fieldValue !== null;

      case 'NOT_EXISTS':
        return fieldValue === undefined || fieldValue === null;

      default:
        return false;
    }
  }

  /**
   * Resolves a nested field path like "customer.profile.email" from a context object.
   */
  public static resolveFieldPath(obj: Record<string, unknown>, path: string): unknown {
    if (!obj || typeof obj !== 'object') return undefined;
    if (!path.includes('.')) return obj[path];

    const parts = path.split('.');
    let current: any = obj;

    for (const part of parts) {
      if (current === undefined || current === null || typeof current !== 'object') {
        return undefined;
      }
      current = current[part];
    }

    return current;
  }
}
