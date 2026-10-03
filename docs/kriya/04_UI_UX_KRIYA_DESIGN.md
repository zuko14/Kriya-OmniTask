# 04 — UI/UX: Moving the Consoles to the Kriya AI Design System

**Canonical source:** `KRIYA_AI_DESIGN_SYSTEM.md` (repo root; identical copy at
`../KriyaAI/docs/design/KRIYA_AI_DESIGN_SYSTEM.md`). Design language: **"Clinical Depth"**.
That document wins over `claude1.md` Part B (§11-§20) and over `CLAUDE.md` §31's generic
visual guidance wherever they conflict. Record this in ADR-009.

## 1. Current vs. target

| Aspect | Today (`web/src/styles/tokens.css`) | Kriya target |
|---|---|---|
| Page ground | `--ink #0E141B` (slate) | `--bg #040A11` (deep navy) + two radial auras (emerald `rgba(16,185,129,.18)`, sapphire `rgba(61,139,253,.16)`) |
| Surfaces | Opaque `#16202B` / `#1E2A38` | Glass: `--surface rgba(28,45,63,.72)` + `backdrop-filter: blur(20px) saturate(155%)` + inset `--rim`; opaque fallback via `@supports` |
| Borders | `--hairline #2A3745` | Mint rims `--border rgba(199,234,225,.13)`, `--border2 .22`, `--rim .24` |
| Accent | 7 "signal" colours | `--accent #3D8BFD` + semantic green `#10B981` / red `#F2555F` / amber `#F5A524` / blue / cyan / purple |
| Brand gradient | none | `--brand-grad: linear-gradient(135deg,#10B981 0%,#2FA8D8 55%,#3D8BFD 100%)`, used in **exactly 4 places**: logo, primary CTA, active nav bar (3px), stat-card top hairline (+ usage bar fill) |
| Type | per `claude1.md` | **IBM Plex Sans** 300-700, `letter-spacing:-0.011em`, tabular numbers in tables/stats; monospace = system mono for IDs/hashes |
| Light theme | "paper" tokens | `data-theme="light"`: mint-tinted white `#F2F7F7`, never neutral grey |
| Radius | — | 14 (stat) / 18 (card) / 22 (modal); 10 inputs/buttons; 20 badges; 8 small |
| Spacing | — | 4px base grid (4…36) |
| Icons | mixed | Inline SVG sprite, 24px grid, 1.75 stroke, `currentColor`, **no emoji** |
| Motion | — | `--motion-fast 150ms`, `--motion-base 250ms`, `--ease-out cubic-bezier(0.16,1,0.3,1)`; fadeUp / stagger 40ms / toast slide; full `prefers-reduced-motion` kill |
| Layout | — | Sidebar 260px (collapses ≤768px with hamburger), main max 1400px, modal max 520px, toast 380px top-right |

## 2. Migration strategy (no big bang)

1. **WP-7.1 tokens:** replace `tokens.css` with the Kriya `:root` block (DS §2.1) +
   `[data-theme="light"]` block (DS §2.2) + glass recipe + `@supports` fallback (DS §5.1).
   Add **temporary aliases** so existing CSS modules keep working:
   `--ink → var(--bg)`, `--surface-raised → var(--surface2)`, `--surface-sunken → var(--surface3)`,
   `--hairline → var(--border)`, `--hairline-strong → var(--border2)`, `--text-primary → var(--text)`,
   `--text-secondary → var(--text2)`, `--text-muted → var(--text3)`,
   `--signal-live → var(--green)`, `--signal-halt → var(--red)`, `--signal-attention → var(--amber)`,
   `--signal-info → var(--accent)`, `--signal-learning → #B98CF0`, `--signal-external → #22D3EE`,
   `--signal-idle → var(--text3)`.
   Load IBM Plex Sans in `web/index.html` (DS §12.2). Theme toggle persists to `localStorage['kriya-theme']` inside try/catch.
2. **WP-7.2 brand assets:** `KriyaMark` React component from the canonical SVG paths (DS §1.1:
   hexagon, stem, arm, diamond, with the specified gradients); sizes 36 (login), 24 (sidebar),
   26 (platform header), 32 (favicon). Always paired with the "Kriya AI" wordmark (Plex 600-700).
   Icon sprite with the DS §8 set plus any icons the consoles need, same grid and stroke.
3. **WP-7.3 primitives:** restyle shared components in `web/src/components/primitives`,
   `KpiCard`, `DataTable`, `AsyncState`, `CommandPalette`, `DecisionTraceDrawer` to DS §7
   (buttons, cards, stat cards with gradient hairline, tables with uppercase 0.72rem headers,
   pill badges with status dot, modals, toasts, nav with gradient active bar, segmented control,
   search, alerts, progress bars, scrollbar).
4. **WP-7.4 pages:** migrate each page's `.module.css` off the aliases, one page per commit,
   tests updated as you go. Remove the aliases when `grep -r "var(--signal-\|var(--ink\|var(--hairline" web/src` → 0.
5. **WP-7.6:** retire the legacy server-rendered admin (`src/admin/ui/*`, `adminUiRoutes.ts`) once the
   React console covers its screens (verify each route first).

## 3. Product rules that are design rules

These come from the blueprint and must be visible in the UI:

- **Outcome states are first-class UI.** Every action row shows the closed state from `02` §1
  with a badge: `verified` green · `submitted` blue ("awaiting confirmation") · `awaiting_approval` amber ·
  `blocked`/`failed`/`verification_failed` red · `compensated` neutral. A row never shows "Done" unless the state is `verified`.
- **Every metric is traceable** (CLAUDE.md §8): each stat card links to its definition, source,
  time window and drill-down. Numbers are neutral white; colour only for exceptions (DS §1.3).
- **Channel-plan-aware dashboards** (CLAUDE.md §8, §30): WhatsApp-only tenants never see voice metrics, and vice versa.
- **No unsupported claims in UI copy:** no "100%", no "certified/compliant" unless obtained.

## 4. New screens (WP-7.5)

| Screen | Console | Purpose | Data source |
|---|---|---|---|
| Run Trace | Admin | Graph view of one run: nodes, edges taken, per-node cost/latency, verification and receipt links | WP-2.6 trace API |
| Proof Receipts | Admin + Platform | List/search receipts; "Verify" button runs signature + chain check; export bundle for auditors | WP-3.3 |
| Mandates | Admin (owner role) | Create/revoke delegated authority; usage vs. limits; history | WP-3.1 |
| Verification Queue | Admin | Actions in `submitted` past due; mismatches | WP-3.4 |
| Cost per Outcome | Admin + Platform | Cost per verified outcome per workflow/agent/model; cascade level mix (L0-L3) | WP-6.1 |
| Brain (model supply) | Admin | Owner chooses certified models per tier; BYO key status; spend caps | existing `BrainConsole` + WP-1.4 |

Chart rules: trend lines for change over time, funnels for conversion, heatmaps for
hour-of-day density, graph views for runs and agent hierarchy (CLAUDE.md §31). No default bar charts.

## 5. Panels and themes (DS §12.1 adapted to Omnitask)

| Panel | Theme | Notes |
|---|---|---|
| Tenant admin console (`/app/*`) | Dark default + light toggle | Full design system |
| Platform owner console (`/platform/*`) | **Dark only** | Same tokens |
| Login | Dark, aura background (DS §6.1), glass card max 420px, mark at 62/36px | |
| Mobile (≤768px) | Alerts, approvals, attention queue, kill switches, key metrics | Not full desktop parity |

## 6. Accessibility floor (WP-7.6)

DS §11 contrast table must hold in both themes (re-measure light theme; DS only lists dark ratios);
`:focus-visible` 2px accent outline; checkbox borders at `--text3` for 3:1; `color-scheme`
declared; disabled at 0.45 opacity; full keyboard navigation; reduced motion respected. The
existing `web/src/shell/Accessibility.test.tsx` is extended rather than replaced.
