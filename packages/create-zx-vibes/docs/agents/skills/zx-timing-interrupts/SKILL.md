---
name: zx-timing-interrupts
description: Use for ZX Spectrum 50Hz frame loops, HALT synchronization, interrupt mode choices, frame-budget issues, and zxs trace analysis.
---

# ZX Timing and Interrupts Skill

## When to Use

Use this skill when implementing or reviewing a game loop, speed control,
animation timing, interrupt setup, IM 2 handlers, music ticks, or performance
triage.

## Key Rules

- A 48K Spectrum frame is 50Hz: one frame is 69,888 T-states.
- The default loop should be HALT-synced:

  ```asm
      ei
  main_loop:
      halt
      call read_input
      call update
      call erase_and_draw
      jr main_loop
  ```

- `HALT` requires interrupts enabled. `DI` followed by `HALT` hangs forever
  and should be treated as a real bug unless it is a deliberate trap.
- IM 1 is the default and is usually right for games. It lets the ROM ISR scan
  keyboard state and update `FRAMES`.
- Use IM 2 only when there is a clear need. Build a 257-byte vector table,
  preserve every register touched by the ISR, keep the ISR short, and `EI`
  before `RETI`.
- Everything between two HALTs must fit in one 69,888 T-state frame. Full
  bitmap clears and large `LDIR` operations can exceed the budget; prefer
  dirty redraws and small per-frame updates.
- Do not assume one game-loop iteration equals one tick if work can exceed a
  frame. Long operations may skip interrupts before execution resumes.
- ROM calls generally expect interrupts on and IY intact. Avoid calling ROM
  routines inside DI regions or custom ISRs.

## Local Docs and Recipes to Load

- `docs/reference/interrupts-and-timing.md`
- `docs/reference/common-bugs.md`
- `docs/reference/keyboard-input.md`
- `docs/reference/rom-routines.md`
- In a repository checkout: `packages/toolkit/recipes/01-clear-screen/recipe.asm`
  and `packages/toolkit/recipes/09-beeper-fx/recipe.asm`.

External cross-checks, when local docs are insufficient: Nocash ZX specs and
World of Spectrum 48K reference for timing and interrupt details.

## Validation Expectations

- Run with `zxs run --frames <n> --json` or project tests and check
  `loop.haltSynced` / `haltSynced` where available.
- Use `zxs trace --frames <n> --json` after a run to identify hot loops, full
  clears, or unexpected code paths.
- Treat watchdog results seriously: `di-halt` means interrupts are disabled
  before HALT; `tight-loop` may be a busy wait or an input wait without
  scheduled keys; `rom-error` often means bad stack or control flow.
- For input waits, rerun with `--keys "frame:KEY*hold"` before changing loop
  structure.
- If sound, scrolling, or redraw work changes timing, verify both visual output
  and frame-loop health, not just successful assembly.
