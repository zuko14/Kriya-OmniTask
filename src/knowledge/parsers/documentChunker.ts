/**
 * Kriya AI — Recursive Knowledge Document Chunker
 * Chunks normalized documents with window overlap, token estimation, and heading context breadcrumbs (§10 of CLAUDE.md).
 */

import { ParsedDocumentSection } from './documentParser.js';

export interface ChunkOptions {
  maxTokensPerChunk?: number; // Default 384 tokens (~1500 chars)
  tokenOverlap?: number; // Default 40 tokens (~160 chars)
}

export interface GeneratedChunk {
  chunkIndex: number;
  headingContext: string;
  content: string;
  tokenCount: number;
}

export class DocumentChunker {
  /**
   * Approximate token count for English/code text (~4 chars per token).
   */
  public static estimateTokens(text: string): number {
    if (!text || text.length === 0) return 0;
    return Math.ceil(text.trim().length / 4);
  }

  /**
   * Chunks parsed document sections into windowed chunks.
   */
  public static chunkSections(
    sections: ParsedDocumentSection[],
    options: ChunkOptions = {}
  ): GeneratedChunk[] {
    const maxTokens = options.maxTokensPerChunk || 384;
    const overlap = options.tokenOverlap || 40;
    const maxChars = maxTokens * 4;
    const overlapChars = overlap * 4;

    const chunks: GeneratedChunk[] = [];
    let chunkIndex = 0;

    for (const section of sections) {
      const heading = section.heading;
      const content = section.content.trim();

      if (!content) continue;

      // If entire section fits within maxTokens, keep it as single chunk
      if (content.length <= maxChars) {
        chunks.push({
          chunkIndex: chunkIndex++,
          headingContext: heading,
          content,
          tokenCount: this.estimateTokens(content),
        });
        continue;
      }

      // Otherwise split into sliding window chunks on sentence or paragraph boundaries
      const sentences = content.split(/(?<=[.?!;\n])\s+/);
      let currentBuffer: string[] = [];
      let currentLength = 0;

      for (const sentence of sentences) {
        if (currentLength + sentence.length > maxChars && currentBuffer.length > 0) {
          const chunkText = currentBuffer.join(' ').trim();
          chunks.push({
            chunkIndex: chunkIndex++,
            headingContext: heading,
            content: chunkText,
            tokenCount: this.estimateTokens(chunkText),
          });

          // Retain overlapping sentences for continuity
          let retained: string[] = [];
          let retainedLength = 0;
          for (let i = currentBuffer.length - 1; i >= 0; i--) {
            if (retainedLength + currentBuffer[i].length <= overlapChars) {
              retained.unshift(currentBuffer[i]);
              retainedLength += currentBuffer[i].length;
            } else {
              break;
            }
          }

          currentBuffer = retained;
          currentLength = retainedLength;
        }

        currentBuffer.push(sentence);
        currentLength += sentence.length + 1;
      }

      if (currentBuffer.length > 0) {
        const chunkText = currentBuffer.join(' ').trim();
        if (chunkText.length > 0) {
          chunks.push({
            chunkIndex: chunkIndex++,
            headingContext: heading,
            content: chunkText,
            tokenCount: this.estimateTokens(chunkText),
          });
        }
      }
    }

    return chunks;
  }
}
