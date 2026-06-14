---
name: zx-rom-routines
description: Use for safe calls into ZX Spectrum 48K ROM printing, channel setup, CLS, LAST-K, FRAMES, and ROM BEEPER.
---

# ZX ROM Routines Skill

## When to Use

Use this skill when calling 48K ROM routines, printing through `RST 0x10`,
using ROM keyboard/system variables, clearing through ROM `CLS`, or diagnosing
unexpected ROM errors.

## Key Rules

- Treat the local ROM reference as the allowed surface. Do not jump into
  undocumented ROM internals unless the task explicitly requires research.
- Before ROM calls, preserve the ROM contract: IY should be `0x5C3A`,
  interrupts should normally be enabled, and registers should be assumed
  clobbered unless local docs say otherwise.
- Initialize screen printing once:

  ```asm
      ld a, 2
      call 0x1601
  ```

  Then use `RST 0x10` to print characters and control codes.
- Useful stable entries:
  `0x0DAF` CLS, `0x1601` CHAN-OPEN, `0x03B5` BEEPER,
  `0x5C08` LAST-K, `0x5C78` FRAMES.
- Keep ROM printing within safe screen rows. Printing past the bottom can
  trigger scroll/prompt behavior that is unsuitable for games.
- `LAST-K` is maintained by the IM 1 ROM ISR. Read it for menus, then write
  zero after consuming. Use matrix polling for real-time controls.
- ROM `BEEPER` blocks; do not use it for frequent gameplay sound effects.
- A watchdog `rom-error` usually means smashed stack, bad return address, or
  stray jump into ROM error handling, not a valid high-level error report.

## Local Docs and Recipes to Load

- `docs/reference/rom-routines.md`
- `docs/reference/keyboard-input.md`
- `docs/reference/interrupts-and-timing.md`
- `docs/reference/attributes-and-colour.md`
- `packages/toolkit/recipes/02-print-rom/recipe.asm`
- `packages/toolkit/recipes/09-beeper-fx/recipe.asm`

External cross-checks, when local docs are insufficient: SkoolKid ROM routine
documentation and World of Spectrum 48K reference for ROM entry points.

## Validation Expectations

- For printing, run with `zxs run --frames <n>` and inspect
  `zxs screen --text` plus a screenshot when colors matter.
- For ROM input, schedule keys with `--keys` or `zx_keys`; remember the ROM
  ISR must be running for `LAST-K`.
- For ROM calls around custom loops, verify `haltSynced: true` and no
  watchdog `rom-error`, `pc-in-rom`, or stack-corruption verdicts.
- Check IY and interrupt assumptions when a ROM call works after boot but
  fails after custom interrupt, stack, or register-heavy code.
- Prefer small recipe-level tests for reusable wrappers such as string print,
  CLS setup, or jingle calls.
