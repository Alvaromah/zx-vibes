# Safe ROM routines

Read this to print text, clear the screen, or beep without writing it all
yourself. The 16K ROM is full of routines; these are the stable, documented
entry points worth calling. Everything else: write your own.

## The contract for ALL ROM calls

- `IY = 0x5C3A` (the ROM addresses sysvars relative to IY). True after boot;
  if you clobber IY, restore it before calling.
- `IX` is also not sacred around ROM calls. Some ROM paths use indexed
  addressing internally; preserve IX/IY yourself when your game depends on them.
- Interrupts enabled (some routines assume the ISR keeps sysvars fresh).
- They clobber registers freely — assume AF/BC/DE/HL die unless noted.

## Printing

```asm
    ld a, 2
    call 0x1601         ; CHAN-OPEN: route RST 0x10 to the main screen (once)

    ld a, 'A'
    rst 0x10            ; print one character at the current position
```

Control codes through RST 0x10 (print them like characters):
`22,y,x` = AT row y col x · `16,n` = INK n · `17,n` = PAPER n ·
`19,n` = BRIGHT n · `13` = newline. Codes 32-127 are ASCII (`£` at 0x60,
`©` at 0x7F). Codes 0x90-0xA4 are UDGs.

A zero-terminated string printer: recipes/02-print-rom. Do not feed it strings
that intentionally contain `0x00`; ROM control codes are fine, but a zero byte
ends the string. For binary text tables or strings that may contain zero, store
a length byte and loop exactly that many characters through `RST 0x10`.

## Other keepers

| Address | Name | Use |
|---|---|---|
| `0x0DAF` | CLS | Clear screen + attrs from ATTR-P, home the print position |
| `0x1601` | CHAN-OPEN | A=2 screen, A=1 lower screen, A=3 printer |
| `0x03B5` | BEEPER | HL = tone period ≈ 437500/Hz - 30, DE = duration in cycles ≈ seconds × Hz. DI'd inside; blocks until done |
| `0x5C08` | LAST-K (sysvar) | Last key, maintained by the IM1 ISR — read, then write 0 |
| `0x5C78` | FRAMES (sysvar) | 50Hz counter, 3 bytes little-endian — cheap random seed |

BEEPER example (440Hz for ~0.25s — blocks ~12 frames!):

```asm
    ld hl, 965          ; 437500/440 - 30
    ld de, 110          ; 0.25 * 440
    call 0x03B5
```

## Gotchas

- Forgetting `CHAN-OPEN` once before the first `RST 0x10` prints to a
  closed channel → error or nothing. One call at startup is enough.
- Preserve IX/IY around ROM calls if you use them for game state. The ROM uses
  IY for sysvars and may not preserve your indexed-register conventions.
- BEEPER **freezes the game** while it plays (it busy-loops with DI). For
  game SFX make your own per-frame blips (recipes/09-beeper-fx, later) and
  keep BEEPER for jingles.
- The ROM error restart (`RST 0x08`) is how BASIC reports errors — if your
  code wanders into ROM and you see the watchdog's `rom-error`, you usually
  smashed the stack or jumped through a bad pointer, not "called" anything.
- Printing past the bottom of the screen triggers the ROM's "scroll?"
  prompt logic — keep prints inside rows 0-21 or own the screen yourself.
