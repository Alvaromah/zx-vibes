---
"@zx-vibes/toolkit": patch
"zx-vibes": patch
---

Run programs on a machine that behaves more like a real 48K Spectrum.

- The ROM is read-only in `zxs run`, `test`, the MCP session and resumed
  `.zxstate` sessions: a stray write or a stack that grows below `0x4000` no longer
  rewrites the ROM.
- A `.zxstate` saved mid-frame (at a breakpoint or after `step`) keeps the frame
  T-state and a pending `EI`, so the resumed session takes its next interrupt at
  the same point. Files without these fields still load (at T-state 0).
- `.z80` checks now come from the core reader, so every command and the preview
  player reject the same files.
- In `zxs preview`, `.tzx` files with archive info, messages, loops or other
  control blocks load instead of failing to parse.
