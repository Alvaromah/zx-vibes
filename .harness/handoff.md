# Handoff

Last updated: 2026-06-14

## Mode for next session

TASK if continuing the `FEEDBACK.md` backlog; otherwise ASK.

## Next action

No active task. P1-1 from `FEEDBACK.md` and the project-local agent skills
docs task are complete. If continuing the backlog, start with P1-2
(`docs/reference/sound.md`) and keep one branch/PR per item.

## Read order

1. `.harness/README.md`
2. `.harness/state.md`
3. `.harness/map.md`
4. `.harness/tasks/queue.md` if executing queued work
5. Relevant area files under `.harness/areas/`

## Pointers

Current task:

- None active. Last completed: `T-20260614-02`.

Relevant recent entries:

- `recent.md` entry for project-local agent skills docs.
- `recent.md` entry for P1-1 generated projects running without global `zxs`.
- `recent.md` entry for 2026-06-14 root harness creation.

Relevant decisions:

- `decisions.md`: root harness uses package/product boundaries.
- `decisions.md`: preserve toolkit runtime invariants in the root harness.

Relevant areas:

- Agent skills docs touched toolkit, assembler, emulator, scaffolding,
  reference-docs, and distribution.
- P1-1 touched toolkit, scaffolding, and distribution.

## Assumptions to verify

- The area map reflects the current README and workspace package layout.
- Root `starters/` and `docs/` remain the source assets for generator sync.
- `pnpm --filter @zx-vibes/emulator lint test` is not a valid combined pnpm
  invocation here; it forwards `test` as an ESLint path. Run emulator `lint`
  and `test` separately.

## Validation expectations

- For harness-only edits, inspect markdown and run `git diff --check`.
- For code changes, use the relevant area file plus root `pnpm run verify` when
  the blast radius crosses packages.

## Risks or warnings

- Package-level `AGENTS.md` files were removed. Use root `AGENTS.md` and
  `.harness/areas/*.md` for all area-specific instructions.
