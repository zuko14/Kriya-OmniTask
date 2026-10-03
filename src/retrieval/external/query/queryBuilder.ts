/**
 * Kriya Omnitask — Deterministic Query Builder (§10.3)
 * Constructs constrained, deterministic search query strings from typed information needs.
 * Rejects free-form unbounded prompt query construction.
 */

import { TypedInformationNeed } from '../types/externalRetrievalTypes.js';

export interface BuiltQuery {
  queryString: string;
  keywords: string[];
  targetDomains: string[];
  entity: string;
}

export class QueryBuilder {
  /**
   * Deterministically transforms a TypedInformationNeed into an optimized, structured search query.
   */
  public static buildQuery(need: TypedInformationNeed): BuiltQuery {
    const cleanEntity = need.entityQuery.trim();
    const cleanTopic = need.topic.trim();
    const cleanObjective = need.objective.trim();

    const terms: string[] = [];

    if (cleanEntity) {
      terms.push(`"${cleanEntity}"`);
    }

    if (cleanTopic && cleanTopic.toLowerCase() !== cleanEntity.toLowerCase()) {
      terms.push(cleanTopic);
    }

    if (need.requiredFields && need.requiredFields.length > 0) {
      const fieldTerms = need.requiredFields
        .map((f) => f.trim())
        .filter((f) => f.length > 0)
        .slice(0, 3); // Bound keyword expansion
      if (fieldTerms.length > 0) {
        terms.push(fieldTerms.join(' '));
      }
    }

    // Site domain constraints if specified in need
    const domains = (need.targetDomains || []).map((d) => d.trim().toLowerCase()).filter(Boolean);
    if (domains.length === 1) {
      terms.push(`site:${domains[0]}`);
    }

    const queryString = terms.join(' ').trim();
    const keywords = queryString.split(/\s+/).filter(Boolean);

    return {
      queryString,
      keywords,
      targetDomains: domains,
      entity: cleanEntity,
    };
  }
}
