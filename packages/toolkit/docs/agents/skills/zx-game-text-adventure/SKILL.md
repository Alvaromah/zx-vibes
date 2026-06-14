---
name: zx-game-text-adventure
description: Build ZX Spectrum 48K text adventures in Z80 assembly with ROM printing, parser/state tables, memory discipline, and transcript-style zxs validation.
---

# ZX Game Text Adventure

Use this skill when the user asks for a text adventure, parser game, interactive
fiction, room/object/inventory system, command transcript, PAW/Quill-inspired
game, menu-driven story, or a mostly text ZX Spectrum 48K game.

## Key Rules

- Make the game table-driven. Keep rooms, exits, objects, vocabulary, messages,
  flags, and command handlers in explicit tables instead of writing one-off
  branches for every object.
- Keep the parser small and testable first: normalize input, split into verb
  and noun tokens, dispatch through command tables, then mutate state. Add
  adjectives, pronouns, prepositions, or multi-command parsing only after a
  simple transcript passes.
- Treat player-visible text as data. Use zero-terminated strings for ROM print
  helpers, stable message IDs, and compact tables. Avoid duplicating common
  responses.
- Preserve ROM-call requirements: `IY = 0x5C3A`, interrupts enabled, and system
  variables at `0x5C00-0x5CBF` left intact. Call `print_init` once before using
  `RST 0x10` text output.
- Use explicit game-state bytes: current room, inventory/object locations,
  flags, turn count, score, win/loss state, and parser result. This makes
  transcript tests and memory assertions possible.
- Be disciplined with memory. `ORG 0x8000` is fine for small games, but large
  text tables can grow quickly. Keep code, mutable state, and text regions
  separated and watch binary size.
- Do not busy-wait forever for input in automated runs. Provide deterministic
  scripted input paths for `zxs run --keys`, `zx_type`, or project tests.

## Load First

- `docs/reference/rom-routines.md`
- `docs/reference/memory-map.md`
- `docs/reference/keyboard-input.md`
- `docs/reference/common-bugs.md`
- `packages/toolkit/recipes/02-print-rom/recipe.asm`
- `packages/toolkit/recipes/10-score-bcd/recipe.asm` if the adventure tracks
  score or turns as decimal text.

There is no local text-adventure starter yet. For project structure, use
`starters/game/AGENT_PLAYBOOK.md` for the `zxs` loop and generated-project
conventions, then replace the real-time loop with a command/read/evaluate/print
turn loop.

## External Context

- World of Spectrum lists Professional Adventure Writer as a Gilsoft utility
  game editor for ZX Spectrum 48K/128K, also known as PAW/The Professional
  Adventure Writing System:
  https://worldofspectrum.org/archive/software/utilities/professional-adventure-writer-gilsoft-international
- CRASH's PAW review highlights full parser support, vocabulary handling,
  screen-format options, diagnostic flags, and process tables:
  https://www.crashonline.org.uk/40/paws.htm
- The Lighthouse of Doom Z80 adventure is a useful modern reference for
  table-based Z80 text-adventure structure: command table, item table, compact
  state, text wrapping, and a 48K Spectrum memory plan:
  https://github.com/skx/lighthouse-of-doom

Summarize these references only for design inspiration. Do not copy their text,
data, code, maps, or story content.

## Routing

- For parser/input work, load keyboard and ROM routine docs first.
- For output formatting, start with the ROM print recipe and control codes
  (`AT`, `INK`, `PAPER`, newline) before writing a custom renderer.
- For large story data or save/reset state, inspect memory layout and reserve
  high RAM deliberately. Consider a pristine-state block that can be copied back
  for restart, as table-based Z80 adventures often do.
- For generated-project validation, use the same `zxs build`, `zxs run`, and
  `zxs verify` workflow as arcade projects, but assert transcript state rather
  than animation.

## Validation

After every source change, run and inspect:

```bash
zxs build
zxs run --bin build/main.bin --org 0x8000 --frames 300 --json
zxs screen --text
```

For input flows, script a short transcript. Use the project's available tooling
for typed input (`zxs run --keys ...`, MCP `zx_type`, or JSON tests) and keep
commands simple enough to verify: `LOOK`, movement, `TAKE <object>`,
`DROP <object>`, inventory, invalid verb, and win/loss path.

Finish with `zxs verify`. Tests should assert `status`, `haltSynced` when the
program uses HALT while waiting, visible text/screen changes, current-room
bytes, object-location bytes, flags, turn count, and final win/loss state. If
the program waits for keyboard input, schedule input or design the wait so the
watchdog report is intentional and documented.
