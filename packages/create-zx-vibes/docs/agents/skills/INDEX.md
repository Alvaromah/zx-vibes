# ZX Spectrum Agent Skills

Use this router before loading topic skills. Load only the skills needed for
the current task, then prefer local reference docs, recipes, starters, and
tests over external sources.

## Start Here

- Assembly source, directives, macros, labels, or compatibility errors:
  `z80-asm-zx-vibes/SKILL.md`
- Screen bitmap, pixel addresses, sprites, or display corruption:
  `zx-screen/SKILL.md`
- Colour clash, ink/paper/bright/flash, or attribute effects:
  `zx-colour-attributes/SKILL.md`
- Keyboard matrix, QAOP/Space controls, or scheduled-key tests:
  `zx-keyboard/SKILL.md`
- 50Hz loops, `HALT`, IM 1/IM 2, frame budget, or trace triage:
  `zx-timing-interrupts/SKILL.md`
- Beeper sound effects or audio-edge tests:
  `zx-sound-beeper/SKILL.md`
- ROM printing, `RST 0x10`, `CHAN-OPEN`, `CLS`, or ROM `BEEPER`:
  `zx-rom-routines/SKILL.md`
- Hangs, crashes, bad PC, stack drift, watchdog reports, or debugging:
  `zx-debug-triage/SKILL.md`
- Dirty redraw, XOR sprites, masked sprites, or double-buffer tradeoffs:
  `zx-rendering-patterns/SKILL.md`
- Platformers, gravity, jump/collision, hazards, or room platform games:
  `zx-game-platformer/SKILL.md`
- Shooters, paddle games, score attacks, enemies, projectiles, or arcade loops:
  `zx-game-arcade-action/SKILL.md`
- Parser games, ROM text output, command tables, inventory, or transcripts:
  `zx-game-text-adventure/SKILL.md`

## Non-Negotiables

- Keep the project build/run/look loop from `AGENTS.md` or
  `AGENT_PLAYBOOK.md`. Do not report success after assembly alone.
- Use the embedded `@zx-vibes/asm` assembler unless the task explicitly needs
  an external sjasmplus-only feature.
- Prefer tested recipes under `recipes/` or `packages/toolkit/recipes/` before
  inventing new primitives.
- For generated projects, local files are the source of truth:
  `docs/reference/`, `docs/agents/skills/`, `src/`, `lib/`, and `tests/`.
- For repository work, the codebase and tests beat stale docs. Update docs
  when implementation truth changes.

## Validation Baseline

For project code changes:

```bash
zxs build
zxs run --bin build/main.bin --org 0x8000 --frames 300 --json
zxs screen --text
zxs verify
```

Read the JSON, confirm `status` is `"ok"` and the loop stays HALT-synced when
expected, then inspect screen text or a screenshot. Add or update `zxs test`
assertions for new behavior.
