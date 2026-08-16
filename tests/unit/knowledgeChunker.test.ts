/**
 * Xylarc AI — Knowledge Document Chunker Unit Tests
 */

import { describe, it, expect } from 'vitest';
import { DocumentParser } from '../../src/knowledge/parsers/documentParser.js';
import { DocumentChunker } from '../../src/knowledge/parsers/documentChunker.js';

describe('Knowledge Document Chunker Unit Tests', () => {
  it('should parse markdown into structured sections', () => {
    const markdown = `
# Company Overview
Xylarc AI provides autonomous workforce intelligence for high-growth enterprises.

## Pricing & Packages
Enterprise plan starts at $2,000/mo with dedicated WhatsApp SLA.
Standard tier starts at $500/mo.

## Return Policy
All subscription cancellations must be requested 30 days in advance.
    `.trim();

    const parsed = DocumentParser.parse(markdown, 'markdown');
    expect(parsed.sections.length).toBe(3);
    expect(parsed.sections[0].heading).toBe('Company Overview');
    expect(parsed.sections[1].heading).toBe('Pricing & Packages');
    expect(parsed.sections[2].heading).toBe('Return Policy');
  });

  it('should chunk parsed sections with token estimation and breadcrumbs', () => {
    const longSectionText = Array(20)
      .fill('Xylarc AI agents execute multi-step deterministic business workflows safely.')
      .join(' ');

    const sections = [
      { heading: 'Workflow Automation SOP', level: 1, content: longSectionText },
      { heading: 'Security Guidelines', level: 2, content: 'All API keys must be stored in AES-256 vault.' },
    ];

    const chunks = DocumentChunker.chunkSections(sections, {
      maxTokensPerChunk: 50,
      tokenOverlap: 10,
    });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].headingContext).toBe('Workflow Automation SOP');
    expect(chunks[chunks.length - 1].headingContext).toBe('Security Guidelines');
    expect(chunks[0].tokenCount).toBeGreaterThan(0);
  });

  it('should parse FAQ format cleanly', () => {
    const faqJson = JSON.stringify([
      { question: 'What is Xylarc AI?', answer: 'An autonomous workforce platform.' },
      { question: 'Does it support WhatsApp?', answer: 'Yes, via official Cloud API.' },
    ]);

    const parsed = DocumentParser.parse(faqJson, 'faq');
    expect(parsed.sections.length).toBe(2);
    expect(parsed.sections[0].heading).toBe('What is Xylarc AI?');
    expect(parsed.sections[1].content).toBe('Yes, via official Cloud API.');
  });
});
