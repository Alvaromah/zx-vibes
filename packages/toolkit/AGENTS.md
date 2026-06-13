# Agent Instructions — Spectral

AI-agent toolchain for ZX Spectrum 48K game development (`zxs` CLI +
`zxs-mcp` MCP server over a headless emulator). Start with
`.harness/state.md` for what this is and where it stands.

## Commands

- `npm test` — builds dist + runs all vitest specs; `sjasmplus` compatibility
  specs are optional and skip when the binary is not on PATH
- `npm run typecheck` / `npm run build` (tsup → dist/)
- `node dist/cli/index.js <cmd>` — the zxs CLI; `zxs test recipes` must stay green

## Critical rules (do not relitigate — context in .harness/decisions.md)

- `zx-generation` pinned EXACT 1.0.1, deep imports confined to
  `src/core/machine.ts` + `src/types/zx-generation.d.ts`.
- `src/core/run-loop.ts` mirrors upstream `runFrame()` exactly; determinism
  is a test invariant (no Date.now/Math.random in src/core/).
- Frame = 69,888 T-states; runs stop right after interrupt acceptance, so
  never assert `iff1` at frame boundaries.
- Every CLI command: one JSON doc with `--json`; exit codes 0/1/2/3.
- sjasmplus writes version AND diagnostics to stderr. Golden PNGs:
  `UPDATE_GOLDEN=1 npm test`.

---

This repository uses a lightweight operational harness in `.harness/`.

Before working, classify the request as ASK or TASK.

## Source of truth

The codebase is the source of truth.

If the harness contradicts the codebase, trust the codebase and update the harness when appropriate. Stale harness memory is worse than no harness memory.

## ASK

ASK means the user wants to know, inspect, remember, list, or understand something without changing code or harness files.

Examples:

- "What was the last meaningful change?"
- "What libraries do we use for data access?"
- "Did we revert any users-related implementation?"
- "Which area owns the dashboard charts?"

ASK rules:

- Do not modify files.
- Read only the harness files needed to answer.
- Use repository inspection when the harness is incomplete or stale.
- Prefer `.harness/recent.md` for recent-change questions.
- Prefer `.harness/decisions.md`, `.harness/tasks/index.md`, and `.harness/tasks/archive/` for reverted or abandoned work.

## TASK

TASK means the user wants to change code, write a plan, queue work, execute pending work, or prepare a handoff.

TASK rules:

- Read `.harness/README.md` first.
- Read `.harness/state.md`.
- Read `.harness/tasks/queue.md` when executing queued work.
- Use a task file for non-trivial or multi-session work.
- Use the trivial-change fast path for small local changes.
- Update the harness after meaningful changes.

## Trivial-change fast path

For small, local changes, do not create heavy harness overhead.

A change can use the fast path when all are true:

- it affects one area only,
- it does not change architecture, API contracts, migrations, security, data models, or task ordering,
- it does not depend on queued work,
- it can be validated quickly,
- it does not create durable knowledge that future agents need.

Fast-path rules:

- No task file is required.
- Update `.harness/recent.md` only if the change is meaningful enough to help future work.
- Update `.harness/handoff.md` only if the session is ending or there is active follow-up work.
- Do not update `.harness/state.md` unless stable truth changed.

If during a fast-path change you discover any of the disqualifying triggers, stop and convert to a standard task before continuing.

## Session lifecycle

Use `open -> work -> close`.

Before ending meaningful TASK work, update only the relevant files:

- `.harness/handoff.md` when work remains or the session is being prepared for restart
- `.harness/recent.md` when a meaningful change was completed
- `.harness/tasks/queue.md` when queued tasks changed
- `.harness/tasks/index.md` when task status changed
- relevant task files
- `.harness/state.md` only when stable solution truth changed
- `.harness/decisions.md` only when an important decision was made

Do not store raw chat logs. Prefer concise summaries over long histories.
