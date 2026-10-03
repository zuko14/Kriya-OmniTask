/**
 * Kriya AI — Indic & Multilingual Text Normalizer
 * Unicode NFC canonical normalization, diacritic stripping, zero-width cleaning, and Hinglish standardization (§14, §19 of CLAUDE.md).
 */

import { NormalizationResult, SupportedScript } from '../types/multilingualTypes.js';
import { LanguageDetector } from '../detector/languageDetector.js';

export class IndicNormalizer {
  private static readonly HINGLISH_SLANG_MAP: Record<string, string> = {
    plz: 'kripya',
    pls: 'kripya',
    plzz: 'kripya',
    thx: 'dhanyavad',
    thanks: 'dhanyavad',
    dhanyawad: 'dhanyavad',
    shukriyaa: 'shukriya',
    kyun: 'kyu',
    kyu: 'kyu',
    kabtak: 'kab tak',
    karega: 'karega',
  };

  /**
   * Cleans, canonicalizes, and normalizes multilingual input strings.
   */
  public static normalize(text: string): NormalizationResult {
    if (!text) {
      return {
        originalText: '',
        normalizedText: '',
        script: 'Latin',
        tokens: [],
      };
    }

    // 1. Unicode NFC Canonical Normalization
    let normalized = text.normalize('NFC');

    // 2. Remove Zero-Width Non-Joiners / Format Characters that cause NLP fragmentation
    normalized = normalized.replace(/[\u200B-\u200D\uFEFF]/g, '');

    // 3. Normalize excessive whitespace & repeated punctuation
    normalized = normalized.replace(/\s+/g, ' ').trim();
    normalized = normalized.replace(/([!?.]){2,}/g, '$1');

    // 4. Detect Script
    const detection = LanguageDetector.detect(normalized);
    const script: SupportedScript = detection.script;

    // 5. Standardize Hinglish & slang phonetic tokens if script is Latin
    if (script === 'Latin') {
      const words = normalized.split(/\s+/);
      const replaced = words.map((w) => {
        const lower = w.toLowerCase();
        return this.HINGLISH_SLANG_MAP[lower] || w;
      });
      normalized = replaced.join(' ');
    }

    const tokens = normalized.split(/\s+/).filter((t) => t.length > 0);

    return {
      originalText: text,
      normalizedText: normalized,
      script,
      tokens,
    };
  }
}
