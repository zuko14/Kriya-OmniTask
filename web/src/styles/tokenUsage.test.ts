import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * WP-7.4 guard: the console uses only Kriya tokens (KRIYA_AI_DESIGN_SYSTEM.md), every token it uses is
 * defined, and no pre-Kriya alias name comes back. Before WP-7.1, 22 used names were never defined (S39).
 */
const SRC = resolve(__dirname, '..');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(tsx?|css)$/.test(f) && !/\.test\.tsx?$/.test(f) ? [p] : [];
  });
}

const sources = files(SRC).map((p) => ({ p, s: readFileSync(p, 'utf8') }));
const defined = new Set(sources.flatMap(({ s }) => [...s.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1])));

describe('Kriya token usage', () => {
  it('no pre-Kriya token names remain', () => {
    const legacy = /var\(--(signal-[a-z-]+|ink|hairline(-strong)?|color-[a-z-]+|text-(primary|secondary|muted)|surface-(raised|sunken)|foreground(-muted)?|elevation-\d|rail-width|content-max)(?![\w-])/;
    const hits = sources.filter(({ s }) => legacy.test(s)).map(({ p }) => p.slice(SRC.length));
    expect(hits).toEqual([]);
  });

  it('every var(--token) without a fallback is defined somewhere in web/src', () => {
    const undefinedUses = sources.flatMap(({ p, s }) =>
      [...s.matchAll(/var\((--[a-z0-9-]+)\s*\)/g)].map((m) => m[1]).filter((t) => !defined.has(t)).map((t) => `${p.slice(SRC.length)}: ${t}`)
    );
    expect(undefinedUses).toEqual([]);
  });
});
