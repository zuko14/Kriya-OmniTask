/**
 * Xylarc AI — Multilingual System (Indic & Global Languages) Type Definitions
 * Typed contracts for language identification, Indic script normalization, sentiment, and translation (§14, §19 of CLAUDE.md).
 */

import { z } from 'zod';
import { BaseEntity } from '../../storage/repositories/baseRepository.js';

export const SupportedLanguageEnum = z.enum([
  'en',
  'hi',
  'hinglish',
  'es',
  'fr',
  'de',
  'ar',
  'te',
  'ta',
  'mr',
  'bn',
  'kn',
  'gu',
  'ml',
  'pt',
  'zh',
  'ja',
]);
export type SupportedLanguage = z.infer<typeof SupportedLanguageEnum>;

export const SupportedScriptEnum = z.enum([
  'Latin',
  'Devanagari',
  'Arabic',
  'Telugu',
  'Tamil',
  'Bengali',
  'Gujarati',
  'Kannada',
  'Malayalam',
  'Han',
]);
export type SupportedScript = z.infer<typeof SupportedScriptEnum>;

export interface LanguageDetectionResult {
  language: SupportedLanguage;
  script: SupportedScript;
  confidence: number;
  isCodeSwitched: boolean;
  detectedLanguages: Array<{ language: SupportedLanguage; confidence: number }>;
}

export interface NormalizationResult {
  originalText: string;
  normalizedText: string;
  script: SupportedScript;
  tokens: string[];
}

export interface MultilingualSentimentResult {
  sentiment: 'positive' | 'neutral' | 'negative';
  score: number; // -1.0 to +1.0
  urgencyLevel: 'low' | 'medium' | 'high' | 'critical';
  culturalMarkers: string[];
}

export interface TranslationResult {
  sourceText: string;
  sourceLanguage: SupportedLanguage;
  targetLanguage: SupportedLanguage;
  translatedText: string;
  qualityScore: number;
  latencyMs: number;
}

export interface LanguageProfileRecord extends BaseEntity {
  organization_id: string;
  customer_id: string;
  primary_language: SupportedLanguage;
  detected_languages_json: string;
  preferred_script: SupportedScript;
  is_code_switched: number; // 0 or 1
  confidence_score: number;
}

export interface MultilingualTranslationRecord extends BaseEntity {
  organization_id: string;
  source_text: string;
  source_language: string;
  target_language: string;
  translated_text: string;
  quality_score: number;
  latency_ms: number;
}

export const DetectLanguageRequestSchema = z.object({
  text: z.string().min(1),
});
export type DetectLanguageRequest = z.infer<typeof DetectLanguageRequestSchema>;

export const NormalizeTextRequestSchema = z.object({
  text: z.string().min(1),
  targetScript: SupportedScriptEnum.optional(),
});
export type NormalizeTextRequest = z.infer<typeof NormalizeTextRequestSchema>;

export const AnalyzeSentimentRequestSchema = z.object({
  text: z.string().min(1),
  language: SupportedLanguageEnum.optional(),
});
export type AnalyzeSentimentRequest = z.infer<typeof AnalyzeSentimentRequestSchema>;

export const TranslateTextRequestSchema = z.object({
  text: z.string().min(1),
  sourceLanguage: SupportedLanguageEnum.optional(),
  targetLanguage: SupportedLanguageEnum,
});
export type TranslateTextRequest = z.infer<typeof TranslateTextRequestSchema>;

export const UpdateLanguageProfileRequestSchema = z.object({
  customerId: z.string().min(1),
  primaryLanguage: SupportedLanguageEnum,
  preferredScript: SupportedScriptEnum.default('Latin'),
  isCodeSwitched: z.boolean().default(false),
});
export type UpdateLanguageProfileRequest = z.infer<typeof UpdateLanguageProfileRequestSchema>;
