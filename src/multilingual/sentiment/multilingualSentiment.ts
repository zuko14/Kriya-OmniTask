/**
 * Xylarc AI — Cross-Lingual & Indic Sentiment Analyzer
 * Evaluates sentiment, urgency levels, and cultural politeness markers across languages (§14, §19 of CLAUDE.md).
 */

import { MultilingualSentimentResult, SupportedLanguage } from '../types/multilingualTypes.js';
import { LanguageDetector } from '../detector/languageDetector.js';

export class MultilingualSentiment {
  private static readonly POSITIVE_MARKERS = new Set([
    // English
    'great', 'excellent', 'awesome', 'helpful', 'thank', 'thanks', 'perfect', 'love', 'good', 'satisfied',
    // Hindi & Hinglish
    'dhanyavad', 'shukriya', 'shandar', 'badhiya', 'accha', 'shandar', 'khush', 'sahi',
    // Spanish
    'gracias', 'excelente', 'perfecto', 'bueno', 'maravilloso', 'ayuda',
    // French
    'merci', 'excellent', 'parfait', 'bon', 'satisfait',
    // German
    'danke', 'ausgezeichnet', 'perfekt', 'gut', 'zufrieden',
  ]);

  private static readonly NEGATIVE_MARKERS = new Set([
    // English
    'terrible', 'horrible', 'worst', 'angry', 'scam', 'fraud', 'useless', 'broken', 'disgusted', 'waste',
    // Hindi & Hinglish
    'kharab', 'bekar', 'bakwas', 'fraud', 'chor', 'lut', 'pareshaan', 'gussa', 'bura',
    // Spanish
    'terrible', 'horrible', 'estafa', 'fraude', 'inutil', 'roto', 'enojado', 'mal',
    // French
    'terrible', 'horrible', 'arnaque', 'fraude', 'inutile', 'casse', 'enerve', 'mauvais',
    // German
    'schrecklich', 'furchtbar', 'betrug', 'nutzlos', 'kaputt', 'wutend', 'schlecht',
  ]);

  private static readonly URGENCY_MARKERS = new Set([
    // English
    'urgent', 'urgently', 'emergency', 'asap', 'immediately', 'right now', 'crisis',
    // Hindi & Hinglish
    'jaldi', 'turant', 'abhi', 'fauran', 'emergency',
    // Spanish
    'urgente', 'urgencia', 'inmediatamente', 'ahora', 'ya',
    // French
    'urgent', 'urgence', 'immediatement', 'maintenant',
    // German
    'dringend', 'notfall', 'sofort', 'jetzt',
  ]);

  /**
   * Analyzes sentiment and urgency of multilingual text.
   */
  public static analyze(text: string, langHint?: SupportedLanguage): MultilingualSentimentResult {
    const trimmed = text.trim();
    if (!trimmed) {
      return {
        sentiment: 'neutral',
        score: 0.0,
        urgencyLevel: 'low',
        culturalMarkers: [],
      };
    }

    const detectedLang = langHint || LanguageDetector.detect(trimmed).language;
    const words = trimmed.toLowerCase().split(/\s+/).map((w) => w.replace(/[^\w]/g, ''));

    let positiveHits = 0;
    let negativeHits = 0;
    let urgencyHits = 0;
    const culturalMarkers: string[] = [];

    for (const word of words) {
      if (this.POSITIVE_MARKERS.has(word)) {
        positiveHits++;
        culturalMarkers.push(`pos:${word}`);
      }
      if (this.NEGATIVE_MARKERS.has(word)) {
        negativeHits++;
        culturalMarkers.push(`neg:${word}`);
      }
      if (this.URGENCY_MARKERS.has(word)) {
        urgencyHits++;
        culturalMarkers.push(`urg:${word}`);
      }
    }

    let score = 0.0;
    const totalHits = positiveHits + negativeHits;
    if (totalHits > 0) {
      score = Number(((positiveHits - negativeHits) / totalHits).toFixed(2));
    }

    let sentiment: 'positive' | 'neutral' | 'negative' = 'neutral';
    if (score >= 0.20) {
      sentiment = 'positive';
    } else if (score <= -0.20) {
      sentiment = 'negative';
    }

    let urgencyLevel: 'low' | 'medium' | 'high' | 'critical' = 'low';
    if (urgencyHits >= 2 || (urgencyHits >= 1 && sentiment === 'negative')) {
      urgencyLevel = 'critical';
    } else if (urgencyHits >= 1) {
      urgencyLevel = 'high';
    } else if (sentiment === 'negative') {
      urgencyLevel = 'medium';
    }

    return {
      sentiment,
      score,
      urgencyLevel,
      culturalMarkers,
    };
  }
}
