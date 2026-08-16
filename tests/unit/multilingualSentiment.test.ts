import { describe, it, expect } from 'vitest';
import { MultilingualSentiment } from '../../src/multilingual/sentiment/multilingualSentiment.js';

describe('Cross-Lingual & Indic Sentiment Analyzer Unit Tests', () => {
  it('should detect positive sentiment in English and Indic code-switched phrases', () => {
    const en = MultilingualSentiment.analyze('Thank you so much, your service is great and awesome!');
    expect(en.sentiment).toBe('positive');
    expect(en.score).toBeGreaterThan(0.5);

    const hi = MultilingualSentiment.analyze('Aapka response bahut badhiya aur shandar tha dhanyavad');
    expect(hi.sentiment).toBe('positive');
    expect(hi.score).toBeGreaterThan(0.3);
  });

  it('should detect negative sentiment and high urgency in complaints', () => {
    const complaint = MultilingualSentiment.analyze('Worst service ever, broken scam product, urgent refund needed now!');
    expect(complaint.sentiment).toBe('negative');
    expect(complaint.urgencyLevel).toBe('critical');

    const hinglishComplaint = MultilingualSentiment.analyze('Bahut bekar fraud service hai jaldi turant refund karo');
    expect(hinglishComplaint.sentiment).toBe('negative');
    expect(hinglishComplaint.urgencyLevel).toBe('critical');
  });
});
