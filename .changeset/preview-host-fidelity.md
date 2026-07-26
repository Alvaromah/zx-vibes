---
"@zx-vibes/toolkit": minor
"zx-vibes": minor
---

Preview player host fidelity (ADR-0028): audible SAVE, full symbol keymap, real
raster border — parity with the emulator demos' host policies.

- **Audio — the weighted EAR+MIC speaker mix** (`BEEPER-PCM-MIX-001`): the audible
  drive is `0.8·b4 + 0.2·b3`, a fractional level through the existing continuous
  PCM grid. The ROM `SAVE`'s MIC-only tone is now audible (soft, as on hardware);
  game beepers toggling both bits in phase stay full-swing. `run --wav` keeps the
  1-bit `b4` capture unchanged.
- **Keyboard — printable symbol characters** (`KBD-BROWSERMAP-002`): `,` `.` `"`
  `;` `:` `-` `+` `=` `*` `/` `?` `'` `_` `<` `>` `!` … type as their 48K SYMBOL
  SHIFT chords, resolved from the produced character so any host layout works. A
  host Shift that produced a symbol keeps its CAPS suppressed for the rest of the
  hold, so staggered releases cannot trip EXTENDED mode. The whole pressed set is
  re-resolved from held physical keys, fixing chords stuck by asymmetric modifier
  release.
- **Keyboard — the quick-tap latch is scan-granular** (`KBD-LATCH-001`): the scan
  is the 50 Hz frame, not one IN read. The old per-read latch clearing hid a
  latched tap from every half-row the ROM reads after row 0 (a tap on B/N/M/SPACE
  could vanish); taps are now frozen into exactly one full frame's scan.
- **Border — the 320×240 bordered frame in-canvas** (`RT-PROD-PREVIEW-008`,
  `RASTER-GEOMETRY-001`): the 256×192 display inset by the standard 32-px/24-line
  visible border, rendered as canvas pixels with a per-scanline colour from the
  frame's border events — tape `SAVE`/`LOAD` paints its red/cyan bands
  (`RASTER-SAVE-PP-001`) instead of a small CSS-coloured page frame.
