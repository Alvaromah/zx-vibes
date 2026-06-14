# Agent Instructions

This repository uses a lightweight operational harness in `.harness/`.

Before working, classify the request as ASK or TASK.

## Language

Use English by default for technical content, including software, systems, AI,
architecture, code, comments, identifiers, debugging, and technical
explanations.

For non-technical conversation, respond in the language the user uses.

Respond in Spanish when the user explicitly asks for Spanish. This overrides
the English default for technical content.

## Response Closing

At the end of any non-trivial response that involved real work, append:

## Resumen

2-3 short paragraphs in Spanish describing what was done and why.

## Siguientes pasos

A numbered list in Spanish with concrete next actions.

Omit the entire `## Siguientes pasos` section if there is no meaningful
follow-up. Skip both sections for trivial exchanges, quick answers,
clarifications, single-line fixes, or purely conversational replies.

## Source of truth

The codebase is the source of truth.

If the harness contradicts the codebase, trust the codebase and update the
harness when appropriate. Stale harness memory is worse than no harness memory.

This root file is the only canonical `AGENTS.md` for the repository. Do not add
package-level `AGENTS.md` files; put area-specific guidance in
`.harness/areas/*.md`.

## ASK

ASK means the user wants to know, inspect, remember, list, or understand
something without changing code or harness files.

ASK rules:

- Do not modify files.
- Read only the harness files needed to answer.
- Use repository inspection when the harness is incomplete or stale.
- Prefer `.harness/recent.md` for recent-change questions.
- Prefer `.harness/areas/*.md` for area-specific knowledge.
- Prefer `.harness/decisions.md`, `.harness/tasks/index.md`, and
  `.harness/tasks/archive/` for reverted or abandoned work.

## TASK

TASK means the user wants to change code, write a plan, queue work, execute
pending work, or prepare a handoff.

TASK rules:

- Read `.harness/README.md` first.
- Read `.harness/state.md`.
- Read `.harness/map.md` to infer area scope.
- Read relevant area files under `.harness/areas/`.
- Read `.harness/tasks/queue.md` when executing queued work.
- Use a task file for non-trivial or multi-session work.
- Use the trivial-change fast path for small local changes.
- Update the harness after meaningful changes.

## Area inference

Use `.harness/map.md` to route ambiguous requests. Key boundaries:

- `toolkit`: `zxs` CLI, MCP server, runtime loop, verification, preview,
  recipes, examples.
- `assembler`: embedded Z80 assembler/disassembler and `zxasm` CLI.
- `emulator`: ZX Spectrum CPU, memory, display, tape, snapshot, ROM runtime.
- `scaffolding`: `create-zx-vibes`, root starter projects, copied templates.
- `reference-docs`: root reference docs and copied generated-project docs.
- `gallery`: public playable gallery and game artifacts.
- `distribution`: root workspace, CI, release, changesets, umbrella package.

If scope is ambiguous but low-risk, proceed with the most likely area and record
the assumption in the task file.

If scope is ambiguous and the wrong choice could cause significant rework, ask
before changing code.

## Trivial-change fast path

For small, local changes, do not create heavy harness overhead.

A change can use the fast path when all are true:

- it affects one area only,
- it does not change architecture, API contracts, release behavior, generated
  assets, security, data models, or task ordering,
- it does not depend on queued work,
- it can be validated quickly,
- it does not create durable knowledge that future agents need.

Fast-path rules:

- No task file is required.
- Update `.harness/recent.md` only if the change is meaningful enough to help
  future work.
- Update `.harness/handoff.md` only if the session is ending or there is active
  follow-up work.
- Do not update `.harness/state.md` unless stable solution truth changed.

If during a fast-path change you discover any disqualifying trigger, stop and
convert to a standard task before continuing.

## Session lifecycle

Use `open -> work -> close`.

Before ending meaningful TASK work, update only the relevant files:

- `.harness/handoff.md` when work remains or the session is being prepared for
  restart
- `.harness/recent.md` when a meaningful change was completed
- `.harness/tasks/queue.md` when queued tasks changed
- `.harness/tasks/index.md` when task status changed
- relevant task files
- relevant `.harness/areas/*.md`
- `.harness/state.md` only when stable solution truth changed
- `.harness/decisions.md` only when an important decision was made

Do not store raw chat logs. Prefer concise summaries over long histories.
