/**
 * Kriya AI — Knowledge Document Parser & Normalizer
 * Parses raw text, markdown, HTML, structured JSON, FAQs, and SOPs into clean normalized format.
 */

import { KnowledgeSourceType } from '../types/knowledgeTypes.js';

export interface ParsedDocumentSection {
  heading: string;
  level: number;
  content: string;
}

export interface ParsedDocumentResult {
  normalizedContent: string;
  sections: ParsedDocumentSection[];
  summary?: string;
}

export class DocumentParser {
  /**
   * Normalizes raw content according to its source type.
   */
  public static parse(content: string, sourceType: KnowledgeSourceType): ParsedDocumentResult {
    switch (sourceType) {
      case 'markdown':
      case 'policy_sop':
        return this.parseMarkdown(content);
      case 'faq':
        return this.parseFaq(content);
      case 'structured_json':
        return this.parseJson(content);
      case 'web_crawl':
        return this.parseHtmlOrWeb(content);
      case 'text':
      case 'pdf':
      case 'docx':
      default:
        return this.parsePlainText(content);
    }
  }

  /**
   * Markdown parser breaking content into hierarchical sections.
   */
  private static parseMarkdown(raw: string): ParsedDocumentResult {
    const lines = raw.split(/\r?\n/);
    const sections: ParsedDocumentSection[] = [];
    let currentHeading = 'Overview';
    let currentLevel = 1;
    let currentLines: string[] = [];

    for (const line of lines) {
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        if (currentLines.length > 0) {
          const body = currentLines.join('\n').trim();
          if (body.length > 0) {
            sections.push({
              heading: currentHeading,
              level: currentLevel,
              content: body,
            });
          }
          currentLines = [];
        }
        currentLevel = headingMatch[1].length;
        currentHeading = headingMatch[2].trim();
      } else {
        currentLines.push(line);
      }
    }

    if (currentLines.length > 0) {
      const body = currentLines.join('\n').trim();
      if (body.length > 0) {
        sections.push({
          heading: currentHeading,
          level: currentLevel,
          content: body,
        });
      }
    }

    const normalizedContent = sections
      .map((s) => `${'#'.repeat(s.level)} ${s.heading}\n${s.content}`)
      .join('\n\n')
      .trim();

    return {
      normalizedContent: normalizedContent || raw.trim(),
      sections: sections.length > 0 ? sections : [{ heading: 'Content', level: 1, content: raw.trim() }],
      summary: sections[0]?.content.slice(0, 200),
    };
  }

  /**
   * FAQ parser supporting Q&A lists or JSON/Markdown FAQ patterns.
   */
  private static parseFaq(raw: string): ParsedDocumentResult {
    // Try JSON array first
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const sections: ParsedDocumentSection[] = parsed.map((item: any) => ({
          heading: item.question || item.q || 'FAQ Item',
          level: 2,
          content: item.answer || item.a || JSON.stringify(item),
        }));
        const normalized = sections.map((s) => `## ${s.heading}\n${s.content}`).join('\n\n');
        return {
          normalizedContent: normalized,
          sections,
        };
      }
    } catch {
      // Fallback to text matching Q: / A:
    }

    return this.parseMarkdown(raw);
  }

  /**
   * JSON structured content parser flattening properties into key-value sections.
   */
  private static parseJson(raw: string): ParsedDocumentResult {
    try {
      const data = JSON.parse(raw);
      const sections: ParsedDocumentSection[] = [];

      if (Array.isArray(data)) {
        data.forEach((item, idx) => {
          sections.push({
            heading: `Record ${idx + 1}`,
            level: 2,
            content: typeof item === 'object' ? JSON.stringify(item, null, 2) : String(item),
          });
        });
      } else if (typeof data === 'object' && data !== null) {
        for (const [key, value] of Object.entries(data)) {
          sections.push({
            heading: key,
            level: 2,
            content: typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value),
          });
        }
      }

      const normalized = sections.map((s) => `## ${s.heading}\n${s.content}`).join('\n\n');
      return {
        normalizedContent: normalized || raw,
        sections: sections.length > 0 ? sections : [{ heading: 'JSON Data', level: 1, content: raw }],
      };
    } catch {
      return this.parsePlainText(raw);
    }
  }

  /**
   * Web crawl/HTML text stripper.
   */
  private static parseHtmlOrWeb(raw: string): ParsedDocumentResult {
    // Basic HTML tag stripping and whitespace normalization
    const clean = raw
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return this.parsePlainText(clean);
  }

  /**
   * Plain text parser breaking paragraphs into sections.
   */
  private static parsePlainText(raw: string): ParsedDocumentResult {
    const clean = raw.trim();
    const paragraphs = clean.split(/\n\s*\n/).filter((p) => p.trim().length > 0);

    const sections: ParsedDocumentSection[] = paragraphs.map((p, idx) => ({
      heading: `Section ${idx + 1}`,
      level: 2,
      content: p.trim(),
    }));

    return {
      normalizedContent: clean,
      sections: sections.length > 0 ? sections : [{ heading: 'Content', level: 1, content: clean }],
    };
  }
}
