<!-- Superseded by docs/kriya/ on 2026-10-01 -->

# Xylarc AI — Design Direction (Phase 1)

Written before any component code, per the frontend rebuild plan. Governs the `web/` app's design tokens and styling approach. Grows with later phases; doesn't get re-litigated per page.

## Why not the existing look

The current `/admin` mock page (`src/admin/ui/dashboardCss.ts`) is near-black (`#06080e`) with a single neon-cyan accent (`#00f0ff`). CLAUDE.md §31 explicitly names "a near-black theme with a single neon accent" as a generic-AI-dashboard cliché to avoid. The new palette below is deliberately warmer/graphite rather than blue-black, and uses a muted confident blue instead of neon cyan. It also avoids the other two clichés CLAUDE.md §31 names: a cream background with high-contrast serif ("we use dark neutrals + sans throughout") and a hairline-rule broadsheet layout ("we use card/panel surfaces, not rules").

## Palette

Two groups: **neutrals** (background system, not counted against the semantic budget) and **semantic accents** (the "4–6 named colors" CLAUDE.md §31 asks for).

| Token | Value | Role |
|---|---|---|
| `--color-void` | `#15171C` | app background |
| `--color-surface` | `#1E212A` | panels/cards |
| `--color-surface-raised` | `#262A35` | elevated surface (modals, popovers) |
| `--color-border` | `#333846` | hairline borders/dividers |
| `--color-ink` | `#E8E9ED` | primary text |
| `--color-ink-muted` | `#9AA0AE` | secondary text |
| `--color-signal` | `#4C86D6` | primary action / focus / links |
| `--color-verify` | `#3FA66B` | success / verified |
| `--color-caution` | `#D9973E` | warning / needs attention |
| `--color-critical` | `#D8574B` | error / critical |

Critical statuses are never conveyed by color alone — always paired with a label, icon, or text (e.g. "Critical" badge text, not just a red dot).

## Typography

Role-based, not one family stretched over everything:

| Role | Face | Used for |
|---|---|---|
| Display | IBM Plex Sans | headlines, hero KPI numbers |
| Body | Inter | UI text, tables, forms, nav |
| Mono | IBM Plex Mono | IDs, correlation IDs, cost/billing tables (digit alignment) |

Loaded via a single `<link>` in `web/index.html` (Google Fonts) — no font npm package yet. Self-hosting (`@fontsource/*`) is a real upgrade path (offline/CSP control) once that's an actual requirement, not built now.

## Spacing / radius / elevation

- Spacing: `--space-1: 4px`, `--space-2: 8px`, `--space-3: 12px`, `--space-4: 16px`, `--space-5: 24px`, `--space-6: 32px`, `--space-7: 48px`, `--space-8: 64px`
- Radius: `--radius-sm: 4px`, `--radius-md: 8px`, `--radius-lg: 16px`
- Elevation: exactly 2 levels (`--elevation-1`, `--elevation-2`) — no open-ended shadow/blur system, no glassmorphism.

## Styling approach

CSS Modules (built into Vite, zero new dependency) + one global `web/src/styles/tokens.css` of plain custom properties. Not Tailwind: the token set here is deliberately small and bounded, which is the opposite of what a utility-class framework with a large scale is for. Revisit only if hand-written `.module.css` per component becomes a measured bottleneck (unlikely before later phases add many more components).

## Status conventions

Every async UI region (KPI card, table, panel) supports four states explicitly: loading, data, empty, error — plus a fifth, access-denied (403), rendered in-page rather than as a redirect, since a 403 means "still logged in, not permitted" not "not authenticated." See `web/src/components/AsyncState.tsx`.
