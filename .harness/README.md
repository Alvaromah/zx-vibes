# Harness

This directory stores lightweight operational memory for `zx-vibes`.

The harness supports two modes:

- ASK: answer questions without changing files.
- TASK: plan, queue, execute, or prepare work.

The harness follows a simple session lifecycle: `open -> work -> close`.

## Core files

- `state.md`: stable current truth about the solution.
- `map.md`: area routing rules.
- `recent.md`: recent meaningful changes.
- `handoff.md`: restart and continuation pointers.
- `decisions.md`: important accepted, rejected, superseded, or reverted decisions.

## Area files

Area files live in `areas/` and describe ownership, commands, libraries, gotchas, and validation rules for each area:

- `areas/toolkit.md`
- `areas/assembler.md`
- `areas/emulator.md`
- `areas/scaffolding.md`
- `areas/reference-docs.md`
- `areas/gallery.md`
- `areas/distribution.md`

## Task files

Task files live in `tasks/`.

- `tasks/queue.md`: ordered executable queue.
- `tasks/index.md`: task index and tags.
- `tasks/plans/`: planning outputs that propose tasks but don't execute them.
- `tasks/pending/`: tasks ready to execute, including blocked tasks with `status: blocked`.
- `tasks/done/`: completed tasks that still provide useful context.
- `tasks/archive/`: old, abandoned, superseded, or reverted tasks.

## Size budgets

- `state.md`: 800-1500 words.
- `handoff.md`: 200-500 words.
- `recent.md`: 5-10 useful entries or about 30 days.
- `areas/*.md`: 600-1500 words each.
- task file: 500-1500 words.
- `tasks/queue.md`: 10-20 visible pending items.

## Rules

- The codebase is the source of truth. Codebase beats harness when they disagree.
- ASK mode does not modify files.
- `state.md` is not a diary.
- `recent.md` is not an infinite changelog.
- `handoff.md` points to tasks and recent entries instead of duplicating them.
- `queue.md` is the source of truth for what to execute next.
- Archived task files preserve useful context for future questions.
- Add more structure only when the current structure is not enough.

For the full design rationale, see `references/harness_contract.md` in the skill that generated this harness (or the design guide it ships with).
