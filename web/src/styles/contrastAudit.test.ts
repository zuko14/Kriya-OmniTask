import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * WCAG 2.1 contrast audit for the Kriya tokens (KRIYA_AI_DESIGN_SYSTEM.md §2, §11).
 * Glass surfaces are translucent, so each is measured composited over the page ground,
 * and dark text is also checked against the opaque @supports fallback.
 */
type RGB = [number, number, number];

const hex = (h: string): RGB => {
  const c = h.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16)) as RGB;
};
const over = (fg: RGB, alpha: number, bg: RGB): RGB =>
  fg.map((v, i) => Math.round(v * alpha + bg[i] * (1 - alpha))) as RGB;

function luminance([r, g, b]: RGB): number {
  const [R, G, B] = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}
function ratio(a: RGB, b: RGB): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const dark = {
  bg: hex('#040A11'),
  surface: over([28, 45, 63], 0.72, hex('#040A11')),
  surfaceSolid: hex('#0E1926'),
  text: hex('#E4EFF1'),
  text2: hex('#9FB6BF'),
  text3: hex('#6E8794'),
  accent: hex('#3D8BFD'),
  green: hex('#10B981'),
  red: hex('#F2555F'),
  amber: hex('#F5A524'),
  purple: hex('#B98CF0'),
  cyan: hex('#22D3EE'),
};

const light = {
  bg: hex('#F2F7F7'),
  surface: over([255, 255, 255], 0.78, hex('#F2F7F7')),
  text: hex('#14262E'),
  text2: hex('#4C6570'),
  text3: hex('#6B838E'),
  accent: hex('#1668D6'),
  green: hex('#047857'),
  red: hex('#C62F3B'),
  amber: hex('#9A5B0B'),
  purple: hex('#7C3AED'),
  cyan: hex('#0E7490'),
};

describe('Kriya tokens — WCAG 2.1 contrast (DS §11.2)', () => {
  it('tokens.css carries the audited values (guards against silent drift)', () => {
    const css = readFileSync(resolve(__dirname, 'tokens.css'), 'utf8');
    for (const v of ['#040A11', '#E4EFF1', '#9FB6BF', '#6E8794', '#3D8BFD', '#10B981', '#F2555F', '#F5A524',
      '#F2F7F7', '#14262E', '#4C6570', '#6B838E', '#1668D6', '#047857', '#C62F3B', '#9A5B0B', '#7C3AED', '#0E7490']) {
      expect(css).toContain(v);
    }
  });

  it('dark: body and secondary text meet AA (4.5:1) on ground and glass surface', () => {
    for (const ground of [dark.bg, dark.surface, dark.surfaceSolid]) {
      expect(ratio(dark.text, ground)).toBeGreaterThanOrEqual(12);
      expect(ratio(dark.text2, ground)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('dark: tertiary text meets AA-large / non-text (3:1) only — never use it for small body copy', () => {
    for (const ground of [dark.bg, dark.surface, dark.surfaceSolid]) {
      expect(ratio(dark.text3, ground)).toBeGreaterThanOrEqual(3);
    }
  });

  it('dark: accent and semantic colours meet AA text contrast (4.5:1) on the glass surface', () => {
    for (const c of [dark.accent, dark.green, dark.red, dark.amber, dark.purple, dark.cyan]) {
      expect(ratio(c, dark.surface)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('light: body, secondary text and accent/semantic colours meet AA (4.5:1) on ground and surface', () => {
    for (const ground of [light.bg, light.surface]) {
      for (const c of [light.text, light.text2, light.accent, light.green, light.red, light.amber, light.purple, light.cyan]) {
        expect(ratio(c, ground)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('light: tertiary text meets 3:1 (non-text / large text) only', () => {
    for (const ground of [light.bg, light.surface]) {
      expect(ratio(light.text3, ground)).toBeGreaterThanOrEqual(3);
    }
  });

  it('badge/alert text meets AA (4.5:1) on its own 12% tint over the glass surface, both themes', () => {
    const tint = (c: RGB, surface: RGB) => over(c, 0.12, surface);
    // [text colour used by .badge-*/.alert-*, hue of the tint behind it]
    const darkPairs: Array<[RGB, RGB]> = [
      [dark.green, dark.green], [hex('#FF7A83'), dark.red], [dark.amber, dark.amber],
      [hex('#7DB2FF'), dark.accent], [dark.purple, dark.purple], [dark.cyan, dark.cyan],
    ];
    const lightPairs: Array<[RGB, RGB]> = [
      [light.green, light.green], [hex('#B42330'), light.red], [light.amber, light.amber],
      [hex('#1259BD'), light.accent], [light.purple, light.purple], [hex('#0B6278'), light.cyan],
    ];
    for (const [text, hue] of darkPairs) expect(ratio(text, tint(hue, dark.surface))).toBeGreaterThanOrEqual(4.5);
    for (const [text, hue] of lightPairs) expect(ratio(text, tint(hue, light.surface))).toBeGreaterThanOrEqual(4.5);
    const css = readFileSync(resolve(__dirname, 'tokens.css'), 'utf8');
    for (const v of ['#FF7A83', '#B42330', '#1259BD', '#0B6278']) expect(css).toContain(v);
  });
});
