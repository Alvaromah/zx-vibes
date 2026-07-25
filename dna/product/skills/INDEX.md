# zx-vibes skills — hub

Per-technique guides for building ZX Spectrum 48K games with the `zxs` toolkit.
Each skill says **when/why** to apply a technique and points at the `reference/`
doc that carries the hardware truth and, where one exists, the CI-tested recipe
under `recipes/` you can copy from. One rule governs everything:

> **Never report success without running and looking.**

| Skill | Reach for it when |
| --- | --- |
| [seeing-and-proving.md](seeing-and-proving.md) | you need to see/diff output, enforce frame timing, validate fixed-width art, or anchor an injected test scenario |
| [persistent-session.md](persistent-session.md) | you need to read/poke game variables mid-run, or replay a scenario deterministically |
| [debug-hangs.md](debug-hangs.md) | `zxs run` reports a hang (`di-halt`, `tight-loop`, `pc-in-rom`, …) and you need to tell a real crash from a false alarm |
| [interrupts-im1-im2.md](interrupts-im1-im2.md) | choosing the frame heartbeat: ROM IM 1 vs your own IM 2 handler |
| [collision.md](collision.md) | actors must stand on platforms, hit walls, or pick things up |
| [scrolling.md](scrolling.md) | anything on screen has to move sideways/vertically as a block |

Ground truth for the hardware lives in `../reference/` (generated from the
toolkit's conformance-gated DNA — trust it over folklore):
[memory-map.md](../reference/memory-map.md) ·
[ula-timing.md](../reference/ula-timing.md) ·
[z80-opcodes.md](../reference/z80-opcodes.md) ·
[keyboard-input.md](../reference/keyboard-input.md) ·
[host-io-port-fe.md](../reference/host-io-port-fe.md) ·
[beeper-output.md](../reference/beeper-output.md) ·
[screen-render.md](../reference/screen-render.md) ·
[machine-execution.md](../reference/machine-execution.md) ·
[file-formats.md](../reference/file-formats.md) ·
[tape-loading.md](../reference/tape-loading.md) ·
[peripherals.md](../reference/peripherals.md) ·
[raster-border.md](../reference/raster-border.md)
