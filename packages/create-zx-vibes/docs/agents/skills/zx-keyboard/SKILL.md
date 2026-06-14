---
name: zx-keyboard
description: Use for ZX Spectrum keyboard matrix polling, QAOP/Space controls, ROM LAST-K input, and zxs scheduled-key validation.
---

# ZX Keyboard Skill

## When to Use

Use this skill when implementing or debugging keyboard input, gameplay controls,
menu input, key waits, or tests that drive a ZX Spectrum program with scheduled
keys.

## Key Rules

- The keyboard is an 8 half-row by 5 key matrix read through port `0xFE`.
  Select the half-row in the high byte of the port address.
- Keys are active-low: `0 = pressed`, `1 = released`. A normal poll does
  `CPL` so pressed keys become `1`.
- Mask with `AND 0x1F` after reading a row. Bits 5-7 are not key bits and can
  contain unrelated signal/noise.
- Prefer the canonical form:

  ```asm
      ld bc, 0xDFFE
      in a, (c)
      cpl
      and 0x1F
  ```

  Avoid ambiguous `IN A,(0xFE)` unless A was deliberately loaded with the
  row-select high byte.
- Multiple selected rows OR together electrically when several high-byte bits
  are cleared. Use that intentionally for "any key" only.
- Do not use Kempston joystick reads as a shortcut unless the runtime supports
  it. In the local tooling, unselected/unsupported ports can read as `0xFF`,
  which looks like every Kempston direction pressed.
- For menu-style input, ROM `LAST-K` at `0x5C08` is acceptable when IM 1 and
  interrupts are running. For gameplay, poll the matrix directly.

## Local Docs and Recipes to Load

- `docs/reference/keyboard-input.md`
- `docs/reference/common-bugs.md`
- `packages/toolkit/recipes/06-keyboard-qaop/recipe.asm`
- `packages/toolkit/recipes/06-keyboard-qaop/test.json`
- `packages/toolkit/templates/game/lib/keys.asm`
- `packages/toolkit/templates/platformer/lib/keys.asm`

External cross-checks, when local docs are insufficient: Sinclair Wiki keyboard
matrix notes and ZX BASIC manual chapter 24 for keyboard behavior.

## Validation Expectations

- Under `zxs`, schedule keys by frame: `zxs run --keys "10:O*20"` or use the
  `zx_keys` MCP tool with the same syntax.
- A tight keyboard wait with no scheduled key may correctly report
  `tight-loop`. Rerun with scheduled keys before treating it as a bug.
- Tests for gameplay controls should assert `haltSynced: true` and a visible
  state change, border change, memory flag, or object movement.
- Test at least one key from each half-row touched by the code. For QAOP,
  cover Q, A, O, P, and Space rather than only one direction.
- If controls appear inverted or always on, inspect for missing `CPL`, missing
  `AND 0x1F`, or a row constant that does not match the intended keys.
