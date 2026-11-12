---
"@zx-vibes/toolkit": patch
"zx-vibes": patch
---

Make `zxs preview` load tapes the way a real Spectrum does and fail loudly.

- A BASIC-loader `.tap`/`.tzx` now really types `LOAD ""`: the player waits until
  the ROM reads the keyboard, primes it with CAPS SHIFT, and releases each key
  before the next. It keeps serving later tape blocks, and gives the keyboard back
  as soon as the typing ends, so held keys work in loaded games.
- A corrupt `.z80`/`.tap`/`.tzx`, an empty tape, or an image that does not fit in
  RAM is a user error (exit 1) before the server starts, instead of a page stuck on
  "loading…". The page shows any decode error.
- `--watch` follows the build's real dependencies (INCLUDEs such as `../lib/*.asm`
  and INCBIN data). A failed rebuild shows its assembler errors in the page, on
  stderr and in `.zxs/preview-server.log`, while the last good build keeps running.
- `--detach` fails at once with the real build error, reports a server that is
  already running instead of starting a second one, and only recognises its own
  server.
- The player paints only when a new frame ran and no longer allocates on every
  keyboard read.
