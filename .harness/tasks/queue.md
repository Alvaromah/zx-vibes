# Task Queue

Last updated: 2026-06-15

## Policy

- Execute tasks from top to bottom.
- Before executing a task, read its task file.
- After completing a task, update this queue, the task file, `recent.md`, relevant area files, and `handoff.md`.
- If a task is blocked, set `status: blocked` in the task file and list it under `Blocked` below.
- Stop before executing later tasks that depend on a blocked task.

## Next

No queued tasks.

<!-- Example:
1. `T-YYYYMMDD-01` - Short title
   File: `pending/T-YYYYMMDD-01-short-title.md`
-->

## Pending

No other tasks pending.

## Blocked

None.

## Done recently

- `T-20260615-01` - Feedback-driven toolkit improvements backlog
  File: `done/T-20260615-01-feedback-driven-toolkit-improvements.md`
- `T-20260614-02` - Project-local agent skills documentation
  File: `done/T-20260614-02-agent-skills-docs.md`
- `T-20260614-01` - P1-1 runnable `zxs new` projects
  File: `done/T-20260614-01-p1-1-runnable-zxs-new.md`
