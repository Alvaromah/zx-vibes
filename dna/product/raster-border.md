# Raster & Border — visible geometry + T-state → pixel (gallery)

The normative reference for the **gallery's visible raster rendering**: the canvas
geometry, the mapping from a frame T-state to a canvas border pixel, and the palette,
which together turn the emulator's port-`0xFE` **border event stream**
([`../domain/host-io-port-fe.md`](../domain/host-io-port-fe.md)
HOST-IO-PORTFE-BORDER-001, timestamped per HOST-IO-PORTFE-EVENT-CHRONO-001) into the
red/cyan tape bands a `SAVE` paints (C1).

Per ADR-0016 this is **gallery rendering policy** (`decision:ADR-0016`): the display
*timing* is anchored to documented 48K hardware, but the **visible-border margins**
and the canvas size are a rendering choice. It is the domain oracle for
`dna/conformance/raster/`.

> ⚠️ **FLAGGED FOR USER CONFIRMATION (ADR-0016 §4 default).** The geometry below — a
> **320×240** canvas with a **32 px** horizontal and **24 line** vertical visible
> border, the display anchored at frame T-state **14335** — is the *defaulted*
> resolution of `UNKNOWN:host-io:RASTER-GEOMETRY-001`, authored so W8 completes
> autonomously. It is **provisional and revisable**: a shell may use different exact
> margins/canvas constants. If you have the shell's exact values, only this slice's
> fixtures change. See the final report / `handoff.md` for the chosen geometry and the
> `SAVE "pp"` golden pixels.

## Visible geometry

<!-- provenance: decision:ADR-0016 -->
- [id: RASTER-GEOMETRY-001] The canvas is **320×240**: the **256×192** active display
  inset by a visible border of **32 px** left/right and **24 lines** top/bottom
  (`320 = 32 + 256 + 32`, `240 = 24 + 192 + 24`). A canvas pixel `(x, y)` is a
  **border** pixel iff it lies outside the active area — `x < 32`, `x ≥ 288`,
  `y < 24`, or `y ≥ 216`; otherwise it is display content. The **visible-line-start is
  derived**: it is the display start minus the 24-line top margin (the top border
  shows the 24 scan lines immediately before the first display line), and the
  visible-column-start is the display start minus the 32 px (16 T-state) left margin —
  not copied from any shell. The margins (`32` / `24`) and the canvas size are the
  gallery's rendering choice (the **FLAGGED** default above).

## T-state → border pixel

<!-- provenance: decision:ADR-0016 -->
- [id: RASTER-TSTATE-PIXEL-001] The ULA emits **2 pixels per T-state** (the 7 MHz pixel
  clock against the 3.5 MHz CPU clock — documented hardware). Canvas pixel `(x, y)` is
  drawn at frame T-state `pixelTState(x, y) = 14335 + (y − 24)·224 + ⌊(x − 32) / 2⌋`,
  where the display data of line `(y − 24)` starts at `14335 + (y − 24)·224` (the
  documented contended-display anchor, ULA-TIME-CONTENTION-WINDOW-001 / ADR-0010, with
  224 T-states per line over 192 display lines), and the left border maps to the
  negative column offsets before it. The **border colour shown at a border pixel is the
  colour in effect at that pixel's T-state** in the chronological border event stream
  (S1/S2) — so a single frame paints every border span the program wrote, at the
  raster position where the ULA was when it wrote it.

<!-- provenance: decision:ADR-0016 -->
- [id: RASTER-PALETTE-001] A border colour index `0..7` renders with the standard
  ZX Spectrum non-bright palette at the **205** level: `0` black `(0,0,0)`, `1` blue
  `(0,0,205)`, `2` red `(205,0,0)`, `3` magenta `(205,0,205)`, `4` green `(0,205,0)`,
  `5` cyan `(0,205,205)`, `6` yellow `(205,205,0)`, `7` white `(205,205,205)`. The
  exact level (205 vs other emulators' 215/0xD7) is a rendering choice.

## `SAVE "pp"` acceptance (C1)

<!-- provenance: decision:ADR-0016 -->
- [id: RASTER-SAVE-PP-001] During tape output (`SAVE`) the ROM toggles the border
  between **red (2)** and **cyan (5)** at the tape bit-rate, so a saved frame's border
  is a stack of red/cyan bands. The acceptance: rendering a SAVE frame's border event
  stream and sampling the canvas **border** pixels yields **both** red `(205,0,0)` and
  cyan `(0,205,205)`. A renderer that collapses the frame's border writes to one final
  colour shows no bands and **fails** — the exact host-visible defect the core
  CPU/ULA/machine gate did not catch (a shell passed the gate while rendering
  `SAVE "pp"` with no tape bands).

## Acceptance criteria

A gallery raster renderer satisfies this policy iff, through
`dna/conformance/raster/run-raster-fixtures.mjs` against the reference model
`dna/conformance/raster/raster-border-model.mjs`:

- `raster-geometry.json` (RASTER-GEOMETRY-001 / RASTER-TSTATE-PIXEL-001) — the canvas
  dimensions, the border-pixel classification, and the `pixelTState` mapping at sample
  points (e.g. `(32,24)→14335`, `(0,24)→14319`, `(160,120)→35903`); the self-test
  rejects a wrong visible geometry.
- `raster-save-pp.json` (RASTER-SAVE-PP-001) — a SAVE border stream's sampled border
  pixels contain exactly red `(205,0,0)` and cyan `(0,205,205)`; the self-test rejects
  a collapse-to-one-colour border (no tape bands).
