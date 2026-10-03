/**
 * Kriya Omnitask — Branding Configuration Record
 * Central branding definition as mandated by CLAUDE1.md §1 & §2.
 * Commercial names, taglines, and identities live in this layer only.
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

export const BRANDING_CONFIG: BrandingConfig = Object.freeze({
  productName: 'Kriya Omnitask',
  shortName: 'Omnitask',
  companyName: 'Kriya AI',
  // Blueprint KAI-MSP-2040 §19: master brand promise; category = Verified Action Infrastructure.
  tagline: 'Verified action. AI that acts, and proves it acted right.',
  platformCategory: 'Verified Action Infrastructure',
  version: '2.3',
  copyright: `© ${new Date().getFullYear()} Kriya AI. All rights reserved.`,
});

export function getBrandingConfig(): BrandingConfig {
  return BRANDING_CONFIG;
}
