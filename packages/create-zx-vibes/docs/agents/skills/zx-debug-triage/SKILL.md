---
name: zx-debug-triage
description: Use for diagnosing zxs watchdog hangs, bad screen output, keyboard waits, ROM crashes, timing regressions, and ZX hardware symptoms.
---

# ZX Debug Triage Skill

## When to Use

Use this skill when a ZX program builds but hangs, returns to ROM, shows a
blank or corrupted screen, ignores keys, runs too fast/slow, flickers, or fails
`zxs` assertions.

## Key Rules

- Start from the symptom and map it to the hardware area:
  screen stripes usually mean bitmap interleave/address math;
  wrong colors mean attributes; inverted input means active-low keyboard logic;
  timing drift means missing HALT or excessive per-frame work.
- Read watchdog verdicts before editing:
  `di-halt` means HALT with interrupts disabled;
  `tight-loop` means a probable infinite loop or an unsatisfied input wait;
  `rom-error` often means stack/control-flow corruption;
  `pc-in-rom` can mean a bad return or falling back to BASIC.
- For keyboard waits, schedule keys before changing code:
  `zxs run --keys "10:SPACE*5"` or use `zx_keys`.
- For display bugs, distinguish bitmap from attributes. Bitmap is interleaved
  at `0x4000`; attributes are linear at `0x5800`.
- For position bugs, confirm whether x means pixel x (`0`-`255`) or screen
  byte/cell x (`0`-`31`). Clamp before memory writes.
- For performance bugs, avoid full clears in the frame loop and use
  `zxs trace` to find hot PCs.
- For ROM-related crashes, inspect stack, IY, interrupts, and accidental jumps
  through data or uninitialized pointers.

## Local Docs and Recipes to Load

- `docs/reference/common-bugs.md`
- `docs/reference/screen-layout.md`
- `docs/reference/keyboard-input.md`
- `docs/reference/attributes-and-colour.md`
- `docs/reference/interrupts-and-timing.md`
- `docs/reference/rom-routines.md`
- In a repository checkout: relevant recipe tests under
  `packages/toolkit/recipes/*/test.json` and recipe code under
  `packages/toolkit/recipes/*/recipe.asm`.

External cross-checks, when local docs are insufficient: World of Spectrum 48K
reference, Nocash ZX specs, Sinclair Wiki keyboard notes, ZX BASIC manual
chapter 24, and SkoolKid ROM routine documentation.

## Validation Expectations

- Reproduce with `zxs run --json` or the failing `zxs test` first. Keep the
  original verdict and frame count visible while debugging.
- Use `zxs regs`, `zxs disasm PC --count 8`, `zxs step`, and `zxs trace` when
  the run reaches a bad PC or hot loop.
- Use `zxs screen --text` for text/ROM output and screenshots for bitmap or
  color output.
- Add targeted assertions for the fixed failure: `status`, `haltSynced`,
  `borderColor`, memory bytes, beeper edges, or visible output as appropriate.
- After a fix, rerun the narrow failing test plus one adjacent smoke path that
  covers the same hardware area.
