# Interrupts, timing, and the frame budget

Read this for game loops, speed control, flicker, and IM2.

## The clock

50 frames/second. One frame = **69,888 T-states** (3.5MHz / 50). The ULA
raises a maskable interrupt at the start of every frame (top of the screen).

## The default game loop: HALT-synced

```asm
    ei                  ; interrupts ON — mandatory before HALT
main_loop:
    halt                ; sleep until the 50Hz interrupt → frame sync, free
    call read_input
    call update
    call erase_and_draw
    jr main_loop
```

`HALT` is your vsync. One HALT = one frame = consistent speed everywhere.
Too fast? Add a second `halt` (25fps movement) or move every Nth frame with
a counter. The Spectral watchdog reports `haltSynced: true` for this shape —
keep it true.

## Your frame budget

Everything between two HALTs must fit in 69,888 T-states (~9,000-17,000
simple instructions). Blow the budget and you drop to 25fps (every other
frame) — the classic "suddenly half speed" symptom. Profile with
`zxs trace`: the HALT count vs your code's hot spots tells you the headroom.

Costs to know: `LDIR` ≈ 21 T/byte (full screen clear ≈ 130K T = 2 frames!),
8×8 cell draw ≈ 200 T. Don't clear the whole screen every frame — erase and
redraw only what moved (dirty cells).

## IM 1 vs IM 2

- **IM 1** (default): interrupt jumps to ROM 0x0038, which scans the
  keyboard (LAST-K) and increments FRAMES. Your HALT loop rides on it. Use
  this unless you need a custom ISR.
- **IM 2**: your own ISR. Setup ritual (every step matters):

```asm
    di
    ld hl, 0xFE00       ; 257-byte table, page-aligned, above 0x8000
    ld a, 0xFD          ; every entry = 0xFD → vector 0xFDFD
    ld (hl), a
    ld de, 0xFE01
    ld bc, 256
    ldir                ; fill all 257 bytes with 0xFD
    ld a, 0xFE
    ld i, a             ; I = table page
    im 2
    ei
; at 0xFDFD: (put a JP my_isr there, or ORG your ISR at 0xFDFD)
my_isr:
    push af             ; preserve EVERYTHING you touch
    push hl
    ; ... your 50Hz work (music, counters) — keep it SHORT
    pop hl
    pop af
    ei                  ; ← re-enable before returning
    reti
```

Why 257 bytes, all the same: the data bus value during interrupt is
unpredictable on real hardware, so vector = I*256 + (any byte) must always
land on your ISR. Uniform fill is the only safe table.

## Gotchas

- `HALT` with interrupts disabled (`DI` without `EI`) hangs the CPU forever.
  The watchdog catches this as `di-halt` — the fix is `EI` before the loop.
- An ISR that forgets `EI` before `RETI` runs once and never again ("my
  music played one note").
- An ISR that clobbers registers without push/pop corrupts the main loop in
  ways that look random. Push everything you touch, including AF.
- ROM calls (RST 0x10 etc.) generally want interrupts ON and IY intact —
  don't call them from inside a DI region or an IM2 ISR.
- Long operations (decompression, full redraws) spanning multiple frames are
  fine — just expect HALT to "skip" the missed interrupts; don't count on
  FRAMES ticking once per loop iteration.
