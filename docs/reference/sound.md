# Sound and beeper testing

The 48K Spectrum has a 1-bit speaker controlled through ULA port `0xFE`.
Bit 4 is the speaker level. Bits 0-2 of the same byte are the border colour,
so beeper code should preserve or deliberately set the border every time it
writes the port.

```asm
    ld a, 0x10          ; speaker high, border black
    out (0xFE), a
    xor a               ; speaker low, border black
    out (0xFE), a
```

## ROM BEEPER

ROM `BEEPER` at `0x03B5` is convenient but blocking. It disables interrupts
internally, busy-waits until the sound completes, and clobbers registers. Use
it for jingles or explicit pauses, not for long gameplay effects.

Inputs:

- `HL = tone period ~= 437500 / Hz - 30`
- `DE = duration cycles ~= seconds * Hz`

For short in-game effects, prefer `recipes/09-beeper-fx/`: one or two frames
of intentional stall is easier to test and tune than a long ROM call.

## Headless validation

`zxs run --json` reports aggregate and timed beeper data:

- `audio.portFEWrites`: writes to ULA port `0xFE`
- `audio.beeperEdges`: changes of bit 4
- `audio.edgeTimeline`: edge frame and T-state offsets
- `audio.toneSegments`: approximate tone runs derived from edge spacing
- `audio.dominantHz`: longest detected tone segment, when stable enough

Use `zxs run --wav out.wav` when you need an audible artifact from a headless
run. Keep tests numeric and deterministic:

```json
{ "type": "beeperEdges", "min": 2 }
```

`portFEWrites` is useful when a routine writes the same speaker level multiple
times. `beeperEdges` is better for proving a tone actually toggled.

## Gotchas

- Port `0xFE` also controls border colour. Audio can pass while border flicker
  is still wrong.
- ROM `BEEPER` blocks input, animation, redraw, and IM1 frame sync while it
  plays.
- Pitch assertions should allow tolerance. Exact pitch depends on instruction
  timing and loop overhead, not only the intended musical note.
- Tape loading audio is mixed into the browser player; headless tests should
  validate loader progress and port/tape state rather than listening by ear.
