# __NAME__ - ZX Spectrum 48K game (zx-vibes)

You are developing a Z80 assembly game with a real feedback loop. The
emulator runs headless and FAST (130× real hardware) — run it constantly.

## Tooling

This project expects the local `zx-vibes` devDependency. If `zxs` is not found,
run `npm install`; then use `npm run build`, `npm test`, or `npx zxs <cmd>`.
If the toolchain looks wrong, start with `zxs doctor --json`.

The knowledge pack (technique skills, hardware reference, tested recipes) is not
in this project until you install it: `npx zxs setup --agent claude` puts it under
`.claude/skills/zx-vibes/`, `--agent codex` under `.codex/zx-vibes/`. Start at its
`skills/INDEX.md`, which routes screen, keyboard, timing, interrupt, collision,
scrolling and debug work to the smallest context. Paths below that begin with
`skills/` or `reference/` are inside that pack.

## The loop (non-negotiable)

After EVERY source change:

```bash
zxs build                     # uses zx.config.json, JSON errors with line + did-you-mean hints
zxs run --bin build/main.bin --org 0x8000 --frames 300 --json
```

Read the JSON. `status` must be `"ok"`, `haltSynced` must be `true`, and
`frameBudget.overrunFrames` must be `0`. Measurement starts at the first `HALT`
that an interrupt resumes, and every later frame boundary counts, one-off work
such as drawing a title or building a level included: do slow set-up before
your first `HALT`, split it across frames, or anchor a spec with `waitFor`.
Then LOOK at the result: `zxs state reset`, `zxs run --state .zxs/state.zxstate`, then `zxs screen --text --state .zxs/state.zxstate` (free) or
`zxs run ... --screenshot s.png` and view the PNG. **Never report success
without having run and looked.** Exit codes: 0 ok · 1 build error ·
2 hang detected (the report names the PC and likely cause) · 3 environment.

Test input by scheduling keys: `zxs run --bin ... --keys "10:P*30,50:SPACE*5"`.
If the change includes sound, check `audio.beeperEdges` in `zxs run --json`
and add `{ "type": "beeperEdges", "min": 1 }` to a test.
For browser playback, use `zxs preview --watch --json`; hand the user the
reported URL. Use `zxs preview --detach --watch` for a background server,
`zxs preview --list` to recover the URL, and `zxs preview --stop` when done.
Click/press a key once to enable beeper audio. Emulation continues while the
tab is hidden; rendering resumes when visible. Without `--watch`, restart
preview after source changes.

## When stuck

| Symptom | Do |
|---|---|
| exit 2, `di-halt` / `tight-loop` / `pc-in-rom` | Read the verdict's `likelyCause`; `skills/debug-hangs.md` |
| Garbage stripes when drawing | `reference/memory-map.md` — the bitmap is interleaved |
| Keys dead or inverted | `reference/keyboard-input.md` — active-low, CPL first |
| Wrong colours | `reference/screen-render.md` — the attribute byte |
| Works then crashes | Run the session longer (`zxs run --state .zxs/state.zxstate --frames 600`), then `zxs regs --state .zxs/state.zxstate`: is SP drifting? |
| Need to see inside | `zxs break add <label>`, `zxs state reset`, `zxs run --state .zxs/state.zxstate --until-break`; then `zxs regs`, `zxs disasm PC`, `zxs step`, each with `--state .zxs/state.zxstate` (without it they show a fresh boot) |
| Where is the time going | `zxs trace --frames 5 --profile` |
| Need read-only investigation | `zxs run --state .zxs/state.zxstate --no-save` or `zxs screen --z80 game.z80 --png s.png` |
| Need to inspect your graphics data | `zxs gfx linear --addr <addr> --width 16 --height 16 --out sprite.png`, `zxs gfx attrs --out attrs.png` |

## Conventions

- `ORG 0x8000`; code, then data. One file (src/main.asm) until it hurts.
- Use `lib/` routines (CI-tested) before writing primitives from scratch:
  `clear_screen`, `cell_addr`, `sprite_xor_8x8`, `attr_addr`, `read_qaop`.
- Game loop shape: `EI` once → `HALT` → input → update → XOR-erase/draw →
  repeat. Keep `haltSynced` true **and** assert zero frame overruns; budget =
  69,888 T-states/frame.
- Put `ASSERT end_label - start_label == expected_width` around fixed-width
  `DEFM` artwork rows; ordinary text is variable-width, so intent belongs beside
  the asset.
- Every routine documents in/out/clobbers in a comment.
- Controls: QAOP + Space unless told otherwise.
- The program starts at its `ORG` from the power-on state, without the ROM's
  start-up. The system variables are zero, so the ROM's keyboard scan is
  unusable (no key for the first 256 frames, then wrong codes), and ROM
  routines that need the system variables (`rst 0x10` printing) crash. Read
  the keyboard ports (`lib/keys.asm`) and print with your own routine.

## Finish line

`zxs verify` must pass. When you add a mechanic, add an assertion to
`tests/smoke.test.json` (or a new spec) that would catch its regression.
Use declarative `setup` memory writes and `waitFor` readiness when a mechanic
would otherwise require playing through a long intro.
