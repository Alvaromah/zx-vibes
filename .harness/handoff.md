# Handoff

Last updated: 2026-06-14

## Mode for next session

ASK

## Next action

Use this root harness as the entry point for future work. There is no active
implementation task queued by this setup session.

## Read order

1. `.harness/README.md`
2. `.harness/state.md`
3. `.harness/map.md`
4. `.harness/tasks/queue.md` if executing queued work
5. Relevant area files under `.harness/areas/`

## Pointers

Current task:

- None.

Relevant recent entries:

- `recent.md` entry for 2026-06-14 root harness creation.

Relevant decisions:

- `decisions.md`: root harness uses package/product boundaries.
- `decisions.md`: preserve toolkit runtime invariants in the root harness.

Relevant areas:

- All areas were initialized during harness creation.

## Assumptions to verify

- The area map reflects the current README and workspace package layout.
- Root `starters/` and `docs/` remain the source assets for generator sync.

## Validation expectations

- For harness-only edits, inspect markdown and run `git diff --check`.
- For code changes, use the relevant area file plus root `pnpm run verify` when
  the blast radius crosses packages.

## Risks or warnings

- Package-level `AGENTS.md` files were removed. Use root `AGENTS.md` and
  `.harness/areas/*.md` for all area-specific instructions.
