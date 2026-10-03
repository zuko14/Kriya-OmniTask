# AGENTS.md — Kriya Omnitask

For any AI coding agent (Antigravity, Codex, Cursor, Claude Code, etc.):

0. **Full kickoff instructions: `docs/kriya/SESSION_KICKOFF_PROMPT.md`** (read and follow it first).

1. **Start with `docs/kriya/00_STATUS.md`**: the "Next up" block says what to work on.
2. Follow the session protocol in `docs/kriya/README.md`: one work package at a time; mark
   `DONE` only with test evidence; update `00_STATUS.md` before ending the session.
3. Engineering rules: `CLAUDE.md` (constitution) + `docs/kriya/02_TARGET_ARCHITECTURE.md`.
4. UI work: `KRIYA_AI_DESIGN_SYSTEM.md` + `docs/kriya/04_UI_UX_KRIYA_DESIGN.md`.

Verify before claiming: `npx tsc --noEmit` and `npx vitest run`.
