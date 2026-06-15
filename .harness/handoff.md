# Handoff

Last updated: 2026-06-15

## Mode for next session

ASK for questions about the completed feedback work; TASK for follow-up
implementation, release preparation, or upload/push/PR work.

## Next action

`T-20260615-01` is complete on branch
`codex/feedback-driven-toolkit-improvements`. The repo is validated with
`pnpm run verify` and ready for upload/push when the user asks. Do not push
without explicit user instruction.

## Read order

1. `.harness/README.md`
2. `.harness/state.md`
3. `.harness/map.md`
4. `.harness/tasks/queue.md` if executing queued work
5. Relevant area files under `.harness/areas/`

## Pointers

Current task:

- `T-20260615-01` done:
  `.harness/tasks/done/T-20260615-01-feedback-driven-toolkit-improvements.md`

Relevant recent entries:

- `recent.md` entry for feedback-driven toolkit improvements implemented.
- `recent.md` entry for human-readable feedback report. The report is at
  `feedback/human.html`.
- `recent.md` entry for feedback consolidated into improvement backlog.
- `recent.md` entry for project-local agent skills docs.
- `recent.md` entry for P1-1 generated projects running without global `zxs`.
- `recent.md` entry for 2026-06-14 root harness creation.

Relevant decisions:

- `decisions.md`: root harness uses package/product boundaries.
- `decisions.md`: preserve toolkit runtime invariants in the root harness.

Relevant areas:

- The completed backlog spans toolkit, assembler, emulator, scaffolding,
  reference-docs, and distribution. Read the relevant area file before
  modifying a follow-up slice.
- Agent skills docs touched toolkit, assembler, emulator, scaffolding,
  reference-docs, and distribution.
- P1-1 touched toolkit, scaffolding, and distribution.

## Assumptions to verify

- The area map reflects the current README and workspace package layout.
- Root `starters/` and `docs/` remain the source assets for generator sync.
- Feedback claims are not automatically source of truth; verify against current
  code before any follow-up implementation.
- `pnpm --filter @zx-vibes/emulator lint test` is not a valid combined pnpm
  invocation here; it forwards `test` as an ESLint path. Run emulator `lint`
  and `test` separately.

## Validation expectations

- For harness-only edits, inspect markdown and run `git diff --check`.
- For code changes, use the relevant area file plus root `pnpm run verify` when
  the blast radius crosses packages.
- Current branch validation: `pnpm run verify` passed on 2026-06-15.

## Risks or warnings

- Package-level `AGENTS.md` files were removed. Use root `AGENTS.md` and
  `.harness/areas/*.md` for all area-specific instructions.
