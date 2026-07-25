# Seeing and proving — the observation loop

A program that assembles is not a program that works. Close the loop after every
change: build, run, LOOK, then assert.

```
zxs build --json
zxs run --json                                  # 300 frames under the hang watchdog
zxs screen --text                               # 32x24 ROM-font OCR — cheap eyes
zxs run --frames 200 --keys "60:SPACE*4" --screenshot .zxs/shot.png --scale 3
zxs verify --json                               # the acceptance gate
```

## Reading the screen

- `zxs screen --text` decodes the display file against the ROM font — fast,
  diff-friendly, good for menus and score bars. Pixel art needs a PNG.
- `zxs screen --png out.png --scale 4` / `zxs run --screenshot out.png --scale 3`
  render through the one screenshot encoder. Use `--scale` 2–4 when you are
  judging sprite art; at 1:1 a 16x16 sprite is a thumbnail.
- The screen lives at `0x4000` (bitmap) / `0x5800` (attributes) with the
  Spectrum's interleaved line order — the decode is in
  [memory-map.md](../reference/memory-map.md), and the palette/FLASH rules in
  [screen-render.md](../reference/screen-render.md). When a screenshot looks
  wrong, `zxs mem read` the display file and compare against the decode before
  blaming your renderer.

For ASCII-authored sprite/tile rows, make geometry executable in the source:
put labels around each fixed-width block and use assembler `ASSERT` expressions
for its byte length (or define rows with fixed-size data). `DEFM` is also used
for ordinary variable-length text, so a universal row-width validator would
reject valid source; the asset's own width is the missing piece of intent.

```asm
sprite_row:
    DEFM "....####........"
sprite_row_end:
    ASSERT sprite_row_end - sprite_row == 16, "sprite row must be 16 bytes"
```

## When is a screenshot taken?

`zxs run` executes whole frames and stops at a frame BOUNDARY (or at a stop
condition / definite hang, which can land mid-frame). For a HALT-synced game the
boundary finds the CPU idling in HALT with the frame fully drawn, so captures are
clean and — because the emulator is deterministic — the same run always yields
byte-identical PNGs. If a capture shows a half-drawn sprite, your draw code is
still running at the frame edge (you are out of frame budget), or you stopped on
a breakpoint mid-draw. Check `frameBudget.overrunFrames` and
`worstFrame.busyTStates` before chasing a render bug; `haltSynced: true` alone is
only a majority cadence signal and can coexist with intermittent missed frames.

## Visual regression

```
zxs screen --png golden.png                     # once, reviewed by a human
zxs screen --diff golden.png --max-diff 0       # afterwards, in the loop
```

`screen --diff` and the `screenDiff` test assertion share one metric and one
codec, so a CLI-approved golden is exactly what the test suite enforces.

## Asserting from tests

`zxs test --list-assertions` prints the full vocabulary. The ones that carry
most proof-per-line:

- `screenIncludes` — ROM-font text landed on some row.
- `pixelAt` / `cellsNonBlank` / `attrNonBlank` — bitmap-level facts.
- `memEquals` / `memInRange` / `memDelta` — game-variable facts (addresses from
  your own `EQU` map; `zxs symbols get <label>` resolves them).
- `frameBudget` — require no missed frame deadlines; put
  `{ "type": "frameBudget", "maxOverrunFrames": 0 }` in every real-time smoke test.
- `at` — temporal checkpoints: assert mid-run state at a named frame, e.g. the
  apex of a jump.
- `beeperEdges` — sound actually reached port `0xFE` bit 4
  ([beeper-output.md](../reference/beeper-output.md)).

A good spec asserts one mechanic with 2–4 of these, driven by `keys`
(`"frame:KEY*hold"` — the same schedule `zxs run --keys` takes,
[keyboard-input.md](../reference/keyboard-input.md)).

When reaching the mechanic requires a long title/level-load sequence, inject the
scenario with `setup: [{ "mem": { "selected_level": "03" } }]` and anchor the
measured run with `waitFor: { "type": "memEquals", "addr": "game_ready",
"hex": "01" }`. Scheduled input, `at` frames, delta baselines, and observable
counters all restart at readiness.
