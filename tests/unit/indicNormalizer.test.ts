import { describe, it, expect } from 'vitest';
import { IndicNormalizer } from '../../src/multilingual/normalizer/indicNormalizer.js';

describe('Indic & Multilingual Normalizer Unit Tests', () => {
  it('should canonicalize Unicode NFC and strip zero-width format characters', () => {
    // String containing zero-width non-joiner \u200C and duplicate spaces/punctuation
    const raw = 'नमस्ते\u200C  दुनिया !!!   आप   कैसे हैं ???';
    const result = IndicNormalizer.normalize(raw);

    expect(result.normalizedText).toBe('नमस्ते दुनिया ! आप कैसे हैं ?');
    expect(result.script).toBe('Devanagari');
    expect(result.tokens.length).toBeGreaterThan(0);
  });

  it('should standardize phonetic Hinglish slang into canonical forms', () => {
    const rawHinglish = 'plz refund jaldi karega thx';
    const result = IndicNormalizer.normalize(rawHinglish);

    expect(result.normalizedText).toContain('kripya');
    expect(result.normalizedText).toContain('dhanyavad');
  });
});
