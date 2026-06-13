# ZX Spectrum 48K memory map

Read this when deciding where to put code, data, and the stack.

## The map

| Range | Size | What |
|---|---|---|
| `0x0000-0x3FFF` | 16K | ROM (BASIC + OS). Read-only; writes are silently ignored |
| `0x4000-0x57FF` | 6144 | Screen bitmap (see screen-layout.md) |
| `0x5800-0x5AFF` | 768 | Screen attributes (32×24 cells) |
| `0x5B00-0x5BFF` | 256 | Printer buffer (reusable as scratch if no printing) |
| `0x5C00-0x5CBF` | 192 | System variables — don't trample if you use ROM calls |
| `0x5CC0-~0x7FFF` | ~9K | BASIC program/workspace area (yours after takeover) |
| `0x8000-0xFF57` | ~32K | Free RAM — **put your code here** |
| `0xFF58-0xFFFF` | 168 | UDG area by default (reusable if you don't use UDGs) |

## Rules of thumb

- **`ORG 0x8000`** for code. The 0x4000-0x7FFF region is "contended" on real
  hardware (the ULA steals cycles); 0x8000+ runs at full speed. The Spectral
  emulator doesn't emulate contention, but keep the habit — your TAP will run
  on real machines.
- **Stack**: after boot, BASIC's SP (~0xFF40s) is fine and is what you get
  when `zxs run --bin` injects your code. If you take the machine over
  completely, `LD SP, 0xFFF0` is safe (below it, nothing of yours; UDGs only
  matter if you use them). Always know where your stack is — see
  common-bugs.md#stack-drift.
- **Data**: put tables/sprites after your code (same ORG flow). Page-align
  (`ALIGN 256` or `ORG 0xNN00`) tables you index with `LD L, A`-style tricks.
- Useful system variables (when ROM/interrupts are live):
  `0x5C78 FRAMES` (3-byte 50Hz counter), `0x5C08 LAST-K` (last key pressed),
  `0x5C3A` is where **IY must point** for ROM calls (see rom-routines.md).

## Gotchas

- Writing to `0x0000-0x3FFF` does nothing — no error. If your "variable" is
  mysteriously stuck, check it isn't below 0x4000.
- Code that grows past your data ORG overwrites it silently. sjasmplus
  assembles in order: keep `code → data → end` and you're safe.
- Don't put IM2 tables or the stack inside 0x4000-0x7FFF on real hardware
  (contention causes subtle timing bugs). 0x8000+ always.
- The 768 attr bytes at 0x5800 are NOT part of the bitmap — clearing the
  bitmap leaves the colours; clearing attrs leaves ghost pixels. Clear both
  (recipe 01-clear-screen).
