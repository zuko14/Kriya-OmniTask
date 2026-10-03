/**
 * Kriya Omnitask — Frontend Branding Configuration
 * Commercial names, taglines, and identities live in this layer only (CLAUDE1.md §1).
 */

export interface BrandingConfig {
  productName: string;
  shortName: string;
  companyName: string;
  tagline: string;
  platformCategory: string;
  version: string;
  copyright: string;
}

export const BRANDING: BrandingConfig = Object.freeze({
  productName: 'Kriya Omnitask',
  shortName: 'Omnitask',
  companyName: 'Kriya AI',
  // Blueprint KAI-MSP-2040 §19 (mirrors src/core/config/branding.ts)
  tagline: 'Verified action. AI that acts, and proves it acted right.',
  platformCategory: 'Verified Action Infrastructure',
  version: '2.3',
  copyright: `© ${new Date().getFullYear()} Kriya AI. All rights reserved.`,
});

export function getBranding(): BrandingConfig {
  return BRANDING;
}
