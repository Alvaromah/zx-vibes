# __NAME__ - ZX Spectrum 48K game (zx-vibes)

You are developing a Z80 assembly game with a real feedback loop. The
emulator runs headless and FAST (130× real hardware) — run it constantly.

## Tooling

This project expects the local `zx-vibes` devDependency. If `zxs` is not found,
run `npm install`; then use `npm run build`, `npm test`, or `npx zxs <cmd>`.
If the toolchain looks wrong, start with `zxs doctor --json`.

Before loading a domain skill, read `docs/agents/skills/INDEX.md`. It routes
assembler, screen/rendering, keyboard, timing, ROM, colour, sound, and debug
work to the smallest local context.

## The loop (non-negotiable)

After EVERY source change:

```bash
zxs build                     # uses zx.config.json, JSON errors with line + did-you-mean hints
zxs run --bin build/main.bin --org 0x8000 --frames 300 --json
```

Read the JSON. `status` must be `"ok"` and `loop.haltSynced` must be `true`.
Then LOOK at the result: `zxs screen --text` (free) or
`zxs run ... --screenshot s.png` and view the PNG. **Never report success
without having run and looked.** Exit codes: 0 ok · 1 build error ·
2 hang detected (the report names the PC and likely cause) · 3 environment.

Test input by scheduling keys: `zxs run --bin ... --keys "10:P*30,50:SPACE*5"`.
If the change includes sound, check `audio.beeperEdges` in `zxs run --json`
and add `{ "type": "beeperEdges", "min": 1 }` to a test.
For browser playback, use `zxs preview --watch --json`; hand the user the
reported URL. Use `zxs preview --detach --watch` for a background server,
`zxs preview --list` to recover the URL, and `zxs preview --stop` when done.
Without `--watch`, restart preview after source changes.

## When stuck

| Symptom | Do |
|---|---|
| exit 2, `di-halt` / `tight-loop` / `pc-in-rom` | Read the verdict's `likelyCause`; docs/reference/common-bugs.md |
| Garbage stripes when drawing | docs/reference/screen-layout.md — the bitmap is interleaved |
| Keys dead or inverted | docs/reference/keyboard-input.md — active-low, CPL first |
| Wrong colours | docs/reference/attributes-and-colour.md |
| Works then crashes | `zxs regs` after longer runs: SP drifting? docs/reference/common-bugs.md#stack-drift |
| Need to see inside | `zxs break add <label>` → `zxs run --until-break` → `zxs regs`, `zxs step`, `zxs disasm PC` |
| Where is the time going | `zxs trace --frames 5` |
| Need read-only investigation | `zxs run --no-save` or `zxs screen --z80 game.z80 --png s.png` |
| Need to inspect assets | docs/reference/reverse-engineering.md, `zxs gfx find --json` |

## Conventions

- `ORG 0x8000`; code, then data. One file (src/main.asm) until it hurts.
- Use `lib/` routines (CI-tested) before writing primitives from scratch:
  `clear_screen`, `cell_addr`, `sprite_xor_8x8`, `attr_addr`, `read_qaop`.
- Game loop shape: `EI` once → `HALT` → input → update → XOR-erase/draw →
  repeat. Keep `haltSynced` true; budget = 69,888 T-states/frame.
- Every routine documents in/out/clobbers in a comment.
- Controls: QAOP + Space unless told otherwise.

## Finish line

`zxs verify` must pass. When you add a mechanic, add an assertion to
`tests/smoke.test.json` (or a new spec) that would catch its regression.
