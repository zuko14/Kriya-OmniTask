# Kriya Omnitask — Engineering Program Docs

**Read this folder first.** It is the single source of truth for taking Kriya Omnitask from
its current state to production. It is written for any engineer or AI coding agent
(Claude Code, Antigravity, Cursor, Codex, etc.) picking up the work in a new session.

| Field | Value |
|---|---|
| Product | **Kriya Omnitask** — the autonomous-operations runtime of the Kriya AI platform |
| Master brand | **Kriya AI** — "Verified action. AI that acts, and proves it acted right." |
| Strategy source | `Kriya_AI_2040_Master_Strategy_Blueprint.pdf` (KAI-MSP-2040-V1, 30 Sep 2026) |
| Design source | `KRIYA_AI_DESIGN_SYSTEM.md` (repo root, v1.0.0) |
| Engineering constitution | `CLAUDE.md` (still says "Xylarc" — renaming is work package WP-0.1) |
| Program started | 2026-10-01 |

---

**Starting a new session?** Paste `SESSION_KICKOFF_PROMPT.md` into the new conversation.

## Reading order

| # | File | What it answers | Updated |
|---|---|---|---|
| 0 | [`00_STATUS.md`](00_STATUS.md) | **What's done, what's in progress, what's next.** The living tracker and session log. | Every session |
| 1 | [`01_CURRENT_STATE_AUDIT.md`](01_CURRENT_STATE_AUDIT.md) | What actually exists today, real vs. simulated, with file:line evidence | When reality changes |
| 2 | [`02_TARGET_ARCHITECTURE.md`](02_TARGET_ARCHITECTURE.md) | What we are building: Verified Action, graph runtime, loop engineering, cost architecture, Mandate, Proof, Reach | Rarely, via ADR |
| 3 | [`03_IMPLEMENTATION_PLAN.md`](03_IMPLEMENTATION_PLAN.md) | Every work package (WP): tasks, files, acceptance criteria, tests, dependencies | When scope changes |
| 4 | [`04_UI_UX_KRIYA_DESIGN.md`](04_UI_UX_KRIYA_DESIGN.md) | How the consoles move to the Kriya AI design system | When UI scope changes |
| 5 | [`05_REMOVALS_AND_CONSOLIDATION.md`](05_REMOVALS_AND_CONSOLIDATION.md) | What gets deleted, merged or frozen, and why | When removals happen |

Superseded documents (keep for history, do **not** treat as current truth):
`docs/implementation/EXECUTION_STATE.md`, `docs/implementation/progress.md`,
`docs/ui/XYLARC_*`, `docs/verification/*`, `docs/certification/*`, and the design sections
(Part B) of `claude1.md`. Several of them mark work "COMPLETED" or "certified" that runs on
simulated providers. See `01_CURRENT_STATE_AUDIT.md`.

---

## Session protocol (every agent, every session)

1. **Start:** read `00_STATUS.md` → the "Next up" block → the matching WP in `03_IMPLEMENTATION_PLAN.md`.
2. **Baseline:** run `npx tsc --noEmit` and `npx vitest run` before touching code. Record
   the counts if they differ from the last session log entry.
3. **Work one WP at a time.** Don't start a WP whose dependencies aren't `DONE`.
4. **A WP is `DONE` only with evidence:** acceptance criteria met, new tests written and
   passing, typecheck clean, and the commands' output summarized in the session log.
   "Code written" is `IN PROGRESS`, not `DONE`.
5. **End:** update `00_STATUS.md`: the WP table row, a new session-log entry, and the "Next up" block.
   If you discovered something that changes the plan, edit `03` and note it in the log.
6. **Never** mark something done that you didn't verify. **Never** delete a module listed in `05`
   without first proving it has no callers (grep + typecheck + tests).

## Non-negotiable engineering rules (from the blueprint + CLAUDE.md)

1. **Verified or not done.** An action that can't be confirmed in the target system is
   reported as `submitted_awaiting_confirmation`, never `completed`.
2. **Models propose, policies decide.** Any action above tier T0 passes the policy engine and
   Mandate check in code, never a prompt.
3. **Proof before confirmation.** The receipt is written before the user or counterparty is told "done".
4. **No fabricated success anywhere.** No invented IDs, no default confidence, no "sent" without a provider response.
5. **Sandbox can't leak into production.** Mock adapters load only when `APP_MODE` is `test` or `sandbox`.
6. **Model- and channel-portable.** No workflow depends on one model provider or on WhatsApp alone.
7. **Configuration, not code, per vertical.** Packs are ontology + policies + templates + connectors.
8. **Don't over-agent.** Five Phase-0 agents. Add one only when a workflow can't be policy + an existing agent.
9. **Honest claims.** No "100% accurate", no unobtained certifications. Publish measured rates per risk tier.
