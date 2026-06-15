---
name: zx-sound-beeper
description: Use for ZX Spectrum 1-bit beeper sound effects, ROM BEEPER calls, border-safe port writes, and audio timing tradeoffs.
---

# ZX Sound Beeper Skill

## When to Use

Use this skill when adding or debugging beeps, sound effects, ROM BEEPER calls,
border writes that touch port `0xFE`, or tests that assert audio activity.

## Key Rules

- The Spectrum beeper is bit 4 of port `0xFE`. Bits 0-2 of the same port set
  the border color, so every beeper `OUT` must preserve the intended border.
- A tone is a square wave made by toggling bit 4 with a steady delay. The CPU
  is busy during simple beeper effects.
- Keep gameplay sound effects short. Long busy-wait sounds stall input,
  animation, and redraw.
- ROM `BEEPER` at `0x03B5` is useful for simple tones and jingles, but it
  blocks and disables interrupts internally while playing.
- ROM `BEEPER` inputs are practical approximations:
  `HL = tone period ~= 437500 / Hz - 30`,
  `DE = duration cycles ~= seconds * Hz`.
- For in-game effects, prefer a tiny routine like the local beeper recipe and
  trigger it at points where a one-frame or two-frame stall is acceptable.
- Avoid beeper work inside an interrupt handler unless it is extremely short
  and all touched registers are preserved.

## Local Docs and Recipes to Load

- `docs/reference/rom-routines.md`
- `docs/reference/sound.md`
- `docs/reference/attributes-and-colour.md`
- `docs/reference/interrupts-and-timing.md`
- `packages/toolkit/recipes/09-beeper-fx/recipe.asm`
- `packages/toolkit/recipes/09-beeper-fx/test.json`

External cross-checks, when local docs are insufficient: ZX BASIC manual
chapter 24 for BASIC/ROM beeper behavior and SkoolKid ROM routine notes for
the ROM BEEPER entry point.

## Validation Expectations

- Run a sound path long enough to observe audio edges. Recipe-style tests can
  assert `beeperEdges` and a memory flag showing the effect returned.
- Use `zxs run --wav out.wav --json` when you need a playable artifact or
  `audio.edgeTimeline` / `audio.toneSegments` to reason about pitch.
- Verify border color after sound effects. Because border and beeper share
  port `0xFE`, a passing audio test can still hide border flicker.
- Confirm the main loop remains `haltSynced: true` unless the effect is
  explicitly allowed to stall.
- Keep tests deterministic by using fixed durations and frame counts rather
  than trying to validate musical pitch by ear.
- If using ROM `BEEPER`, document the blocking behavior at the call site or in
  the surrounding code comments when it affects gameplay.
