/**
 * Xylarc AI — BM25 Sparse Lexical Search Engine
 * Implements Okapi BM25 ranking algorithm for keyword and alphanumeric exact matching (§11 of CLAUDE.md).
 */

export interface BM25Document {
  id: string;
  text: string;
}

export interface BM25ScoreResult {
  id: string;
  score: number;
}

export class BM25SearchEngine {
  private readonly k1: number = 1.5;
  private readonly b: number = 0.75;

  /**
   * Tokenizes text into lowercase terms.
   */
  public static tokenize(text: string): string[] {
    if (!text) return [];
    return text
      .toLowerCase()
      .replace(/[^\w\s-]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1);
  }

  /**
   * Scores a collection of documents against a search query using Okapi BM25.
   */
  public score(query: string, documents: BM25Document[]): BM25ScoreResult[] {
    const queryTerms = BM25SearchEngine.tokenize(query);
    if (queryTerms.length === 0 || documents.length === 0) {
      return documents.map((d) => ({ id: d.id, score: 0 }));
    }

    const N = documents.length;
    const docTokens = documents.map((d) => BM25SearchEngine.tokenize(d.text));
    const docLengths = docTokens.map((tokens) => tokens.length);
    const avgDocLength = docLengths.reduce((sum, len) => sum + len, 0) / Math.max(1, N);

    // Compute Document Frequency (DF) for each query term
    const docFrequency: Record<string, number> = {};
    for (const term of queryTerms) {
      docFrequency[term] = docTokens.filter((tokens) => tokens.includes(term)).length;
    }

    // Compute BM25 scores for each document
    const results: BM25ScoreResult[] = documents.map((doc, idx) => {
      const tokens = docTokens[idx];
      const docLen = docLengths[idx];
      let score = 0;

      // Count term frequencies in this document
      const tfMap: Record<string, number> = {};
      for (const t of tokens) {
        tfMap[t] = (tfMap[t] || 0) + 1;
      }

      for (const term of queryTerms) {
        const tf = tfMap[term] || 0;
        if (tf === 0) continue;

        const df = docFrequency[term] || 0;
        // Standard IDF with smoothing
        const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);

        const numerator = tf * (this.k1 + 1);
        const denominator = tf + this.k1 * (1 - this.b + this.b * (docLen / Math.max(1, avgDocLength)));

        score += idf * (numerator / denominator);
      }

      return { id: doc.id, score };
    });

    // Normalize scores to [0.0, 1.0]
    const maxScore = Math.max(...results.map((r) => r.score), 1.0);
    return results.map((r) => ({
      id: r.id,
      score: maxScore > 0 ? r.score / maxScore : 0,
    }));
  }
}
