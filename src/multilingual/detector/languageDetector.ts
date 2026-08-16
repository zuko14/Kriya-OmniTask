/**
 * Xylarc AI — Multi-Script & Indic Language Detector
 * Detects scripts, ISO languages, and Latin code-switched dialects (Hinglish) (§14, §19 of CLAUDE.md).
 */

import {
  LanguageDetectionResult,
  SupportedLanguage,
  SupportedScript,
} from '../types/multilingualTypes.js';

export class LanguageDetector {
  private static readonly HINGLISH_MARKERS = new Set([
    'kya', 'hai', 'kab', 'aayega', 'aayegi', 'mujhe', 'chahiye', 'aapka', 'aapki',
    'dhanyavad', 'namaste', 'shukriya', 'bhai', 'karo', 'karega', 'karna', 'kardo',
    'hoga', 'hogi', 'nahi', 'kripya', 'kaise', 'accha', 'mera', 'meri', 'batao',
    'dekh', 'raha', 'rahi', 'jaldi', 'turant', 'plz', 'pls', 'thx', 'yaar', 'ji',
  ]);

  private static readonly SPANISH_MARKERS = new Set([
    'hola', 'gracias', 'por', 'favor', 'como', 'estas', 'buenos', 'dias', 'tardes',
    'noches', 'ayuda', 'donde', 'esta', 'quiero',
  ]);

  private static readonly FRENCH_MARKERS = new Set([
    'bonjour', 'merci', 's\'il', 'vous', 'plait', 'comment', 'allez', 'bonne',
    'journee', 'aide', 'ou', 'est', 'je', 'veux',
  ]);

  private static readonly GERMAN_MARKERS = new Set([
    'hallo', 'danke', 'bitte', 'guten', 'tag', 'morgen', 'abend', 'hilfe', 'wo',
    'ist', 'ich', 'mochte',
  ]);

  private static readonly ARABIC_REGEX = /[\u0600-\u06FF]/;
  private static readonly DEVANAGARI_REGEX = /[\u0900-\u097F]/;
  private static readonly BENGALI_REGEX = /[\u0980-\u09FF]/;
  private static readonly GUJARATI_REGEX = /[\u0A80-\u0AFF]/;
  private static readonly TAMIL_REGEX = /[\u0B80-\u0BFF]/;
  private static readonly TELUGU_REGEX = /[\u0C00-\u0C7F]/;
  private static readonly KANNADA_REGEX = /[\u0C80-\u0CFF]/;
  private static readonly MALAYALAM_REGEX = /[\u0D00-\u0D7F]/;
  private static readonly HAN_REGEX = /[\u4E00-\u9FFF]/;

  /**
   * Detects the primary language, script, and code-switching status of a text string.
   */
  public static detect(text: string): LanguageDetectionResult {
    const trimmed = text.trim();
    if (!trimmed) {
      return {
        language: 'en',
        script: 'Latin',
        confidence: 1.0,
        isCodeSwitched: false,
        detectedLanguages: [{ language: 'en', confidence: 1.0 }],
      };
    }

    // 1. Script-based detection
    if (this.DEVANAGARI_REGEX.test(trimmed)) {
      return {
        language: 'hi',
        script: 'Devanagari',
        confidence: 0.98,
        isCodeSwitched: false,
        detectedLanguages: [{ language: 'hi', confidence: 0.98 }],
      };
    }

    if (this.TELUGU_REGEX.test(trimmed)) {
      return {
        language: 'te',
        script: 'Telugu',
        confidence: 0.98,
        isCodeSwitched: false,
        detectedLanguages: [{ language: 'te', confidence: 0.98 }],
      };
    }

    if (this.TAMIL_REGEX.test(trimmed)) {
      return {
        language: 'ta',
        script: 'Tamil',
        confidence: 0.98,
        isCodeSwitched: false,
        detectedLanguages: [{ language: 'ta', confidence: 0.98 }],
      };
    }

    if (this.BENGALI_REGEX.test(trimmed)) {
      return {
        language: 'bn',
        script: 'Bengali',
        confidence: 0.98,
        isCodeSwitched: false,
        detectedLanguages: [{ language: 'bn', confidence: 0.98 }],
      };
    }

    if (this.GUJARATI_REGEX.test(trimmed)) {
      return {
        language: 'gu',
        script: 'Gujarati',
        confidence: 0.98,
        isCodeSwitched: false,
        detectedLanguages: [{ language: 'gu', confidence: 0.98 }],
      };
    }

    if (this.KANNADA_REGEX.test(trimmed)) {
      return {
        language: 'kn',
        script: 'Kannada',
        confidence: 0.98,
        isCodeSwitched: false,
        detectedLanguages: [{ language: 'kn', confidence: 0.98 }],
      };
    }

    if (this.MALAYALAM_REGEX.test(trimmed)) {
      return {
        language: 'ml',
        script: 'Malayalam',
        confidence: 0.98,
        isCodeSwitched: false,
        detectedLanguages: [{ language: 'ml', confidence: 0.98 }],
      };
    }

    if (this.ARABIC_REGEX.test(trimmed)) {
      return {
        language: 'ar',
        script: 'Arabic',
        confidence: 0.98,
        isCodeSwitched: false,
        detectedLanguages: [{ language: 'ar', confidence: 0.98 }],
      };
    }

    if (this.HAN_REGEX.test(trimmed)) {
      return {
        language: 'zh',
        script: 'Han',
        confidence: 0.98,
        isCodeSwitched: false,
        detectedLanguages: [{ language: 'zh', confidence: 0.98 }],
      };
    }

    // 2. Latin Script Sub-Classification (English, Hinglish, Spanish, French, German)
    const words = trimmed.toLowerCase().split(/\s+/).map((w) => w.replace(/[^\w]/g, ''));
    let hinglishCount = 0;
    let spanishCount = 0;
    let frenchCount = 0;
    let germanCount = 0;

    for (const word of words) {
      if (this.HINGLISH_MARKERS.has(word)) hinglishCount++;
      if (this.SPANISH_MARKERS.has(word)) spanishCount++;
      if (this.FRENCH_MARKERS.has(word)) frenchCount++;
      if (this.GERMAN_MARKERS.has(word)) germanCount++;
    }

    const totalWords = Math.max(1, words.length);

    if (hinglishCount >= 1 && (hinglishCount / totalWords >= 0.15 || hinglishCount >= 2)) {
      return {
        language: 'hinglish',
        script: 'Latin',
        confidence: 0.92,
        isCodeSwitched: true,
        detectedLanguages: [
          { language: 'hinglish', confidence: 0.92 },
          { language: 'hi', confidence: 0.85 },
          { language: 'en', confidence: 0.70 },
        ],
      };
    }

    if (spanishCount >= 1 && (spanishCount / totalWords >= 0.20 || spanishCount >= 2)) {
      return {
        language: 'es',
        script: 'Latin',
        confidence: 0.90,
        isCodeSwitched: false,
        detectedLanguages: [{ language: 'es', confidence: 0.90 }],
      };
    }

    if (frenchCount >= 1 && (frenchCount / totalWords >= 0.20 || frenchCount >= 2)) {
      return {
        language: 'fr',
        script: 'Latin',
        confidence: 0.90,
        isCodeSwitched: false,
        detectedLanguages: [{ language: 'fr', confidence: 0.90 }],
      };
    }

    if (germanCount >= 1 && (germanCount / totalWords >= 0.20 || germanCount >= 2)) {
      return {
        language: 'de',
        script: 'Latin',
        confidence: 0.90,
        isCodeSwitched: false,
        detectedLanguages: [{ language: 'de', confidence: 0.90 }],
      };
    }

    // Default to English
    return {
      language: 'en',
      script: 'Latin',
      confidence: 0.95,
      isCodeSwitched: false,
      detectedLanguages: [{ language: 'en', confidence: 0.95 }],
    };
  }
}
