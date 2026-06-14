# Task Queue

Last updated: 2026-06-14

## Policy

- Execute tasks from top to bottom.
- Before executing a task, read its task file.
- After completing a task, update this queue, the task file, `recent.md`, relevant area files, and `handoff.md`.
- If a task is blocked, set `status: blocked` in the task file and list it under `Blocked` below.
- Stop before executing later tasks that depend on a blocked task.

## Next

No tasks queued.

<!-- Example:
1. `T-YYYYMMDD-01` - Short title
   File: `pending/T-YYYYMMDD-01-short-title.md`
-->

## Pending

No tasks pending.

## Blocked

None.

## Done recently

- `T-20260614-01` - P1-1 runnable `zxs new` projects
  File: `done/T-20260614-01-p1-1-runnable-zxs-new.md`
