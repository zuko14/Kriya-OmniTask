import { describe, it, expect } from 'vitest';
import { LanguageDetector } from '../../src/multilingual/detector/languageDetector.js';

describe('Multi-Script & Indic Language Detector Unit Tests', () => {
  it('should accurately detect Indic scripts (Hindi Devanagari, Telugu, Tamil, Bengali, Arabic)', () => {
    // Hindi Devanagari
    const hi = LanguageDetector.detect('नमस्ते, मेरा पार्सल कब तक पहुंचेगा?');
    expect(hi.language).toBe('hi');
    expect(hi.script).toBe('Devanagari');
    expect(hi.isCodeSwitched).toBe(false);

    // Telugu
    const te = LanguageDetector.detect('నమస్కారం, నా ఆర్డర్ ఎప్పుడు డెలివరీ అవుతుంది?');
    expect(te.language).toBe('te');
    expect(te.script).toBe('Telugu');

    // Tamil
    const ta = LanguageDetector.detect('வணக்கம், எனது ஆர்டர் எப்போது வரும்?');
    expect(ta.language).toBe('ta');
    expect(ta.script).toBe('Tamil');

    // Arabic
    const ar = LanguageDetector.detect('مرحبا، متى سيتم تسليم طلبي؟');
    expect(ar.language).toBe('ar');
    expect(ar.script).toBe('Arabic');
  });

  it('should detect Latin Hinglish code-switching', () => {
    const hinglish = LanguageDetector.detect('bhai mera refund kab aayega please batao jaldi');
    expect(hinglish.language).toBe('hinglish');
    expect(hinglish.script).toBe('Latin');
    expect(hinglish.isCodeSwitched).toBe(true);
    expect(hinglish.confidence).toBeGreaterThanOrEqual(0.90);
  });

  it('should detect European languages (Spanish, French, German)', () => {
    const es = LanguageDetector.detect('hola quiero ayuda con mi pedido por favor');
    expect(es.language).toBe('es');

    const fr = LanguageDetector.detect('bonjour je veux de l aide avec ma commande s il vous plait');
    expect(fr.language).toBe('fr');

    const de = LanguageDetector.detect('guten tag ich brauche hilfe mit meiner bestellung danke');
    expect(de.language).toBe('de');
  });
});
