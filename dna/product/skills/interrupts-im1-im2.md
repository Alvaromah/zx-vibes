# The frame heartbeat — IM 1 vs IM 2

Every 50 Hz game loop hangs off the ULA's once-per-frame maskable interrupt
([machine-execution.md](../reference/machine-execution.md) — when it fires,
how `HALT` resumes, the post-`EI` delay). You have two ways to service it.

## IM 1 — the ROM does it (default, fine for small games)

```
    im 1
    ei
main:
    halt            ; released once per frame by the ROM handler
    ; ... your frame ...
    jr main
```

The ROM handler at `0x0038` bumps FRAMES (`0x5C78`) and runs the ROM keyboard
scan. Costs: ~1k T-states a frame in ROM.

**Under `zxs` the ROM's start-up never runs.** `run`, `test`, `verify` and
`preview` start a built program at its `ORG` from the power-on state
([machine-execution.md](../reference/machine-execution.md): `IY = 0xFFFF`, RAM
zeroed), so every system variable is zero. The handler (and a plain `ei` in IM 0,
which takes the same `rst 0x38` here) still ticks FRAMES, but the ROM keyboard is
unusable: with KSTATE zero it registers no key for the first 256 frames (~5 s),
and after that it decodes keys in keyword mode, so a held `A` reaches `LAST_K`
as `0xE6` (`NEW`), not `a`. Read the keyboard ports yourself (`in a,(c)`, as the
starters' `lib/keys.asm` does; [keyboard-input.md](../reference/keyboard-input.md)).
ROM routines that need the system variables, such as `rst 0x10` printing, crash
(the run ends in a `pc-in-rom` hang); print with your own routine.

A program loaded from BASIC (a real machine, or a tape with a BASIC loader) gets
the ROM's set-up: `IY = 0x5C3A` and a working keyboard. The handler indexes the
system variables off `IY`, so if your code repurposes `IY` it scribbles wherever
`IY` points. There, keep `IY = 0x5C3A` or don't use IM 1.

## IM 2 — you own the frame (the game-shaped choice)

A 257-byte vector table of a single repeated byte makes the (open-bus) vectored
jump land on one address regardless of the data-bus byte:

```
IM2_TABLE  EQU 0xFE00       ; 257 bytes of 0xFD
IM2_VECTOR EQU 0xFDFD       ; JP isr lives here

setup_im2:
    ld hl, IM2_TABLE
    ld (hl), 0xFD
    ld de, IM2_TABLE+1
    ld bc, 256
    ldir
    ld a, 0xC3              ; JP nn
    ld (IM2_VECTOR), a
    ld hl, isr
    ld (IM2_VECTOR+1), hl
    ld a, IM2_TABLE/256
    ld i, a
    im 2
    ret

isr:
    push af
    push hl
    ld hl, frametick        ; your own 50 Hz counter
    inc (hl)
    pop hl
    pop af
    ei
    ret                     ; plain RET is fine after EI; RETI if you prefer
```

Why bother: the ROM (and its keyboard scan) leaves your frame entirely, `IY` is
yours, timing is exact and predictable — which is what raster effects and tight
frame budgets need. You then read the keyboard yourself
([keyboard-input.md](../reference/keyboard-input.md) — half-row ports, active-low
bits) and, if you support it, the Kempston port
([peripherals.md](../reference/peripherals.md)).

## Rules either way

- `EI` enables interrupts AFTER the following instruction — `ei / halt` is the
  canonical pair and never loses the frame interrupt.
- Keep the ISR short; it steals T-states from the same 69,888-per-frame budget
  ([ula-timing.md](../reference/ula-timing.md)) your game runs in.
- `DI` without a matching `EI` before `HALT` is the classic `di-halt` hang —
  see [debug-hangs.md](debug-hangs.md).
