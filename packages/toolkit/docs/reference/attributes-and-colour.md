# Attributes and colour (and the clash)

Read this when colours come out wrong or sprites "stain" each other.

## The attribute byte

One byte per 8×8 cell, 768 bytes at `0x5800` (linear: `0x5800 + row*32 + col`):

```
bit 7    bit 6     bits 5-3   bits 2-0
FLASH    BRIGHT    PAPER      INK
```

Colours 0-7: black, blue, red, magenta, green, cyan, yellow, white.

Examples: `0x38` = black ink on white paper (boot default). `0x47` = BRIGHT
white on black. `0x4F` = BRIGHT white ink, blue paper... no: `0x4F` =
BRIGHT(0x40) + paper 1 (blue, 0x08) + ink 7 = bright white on blue ✓.
`0xC7` adds FLASH. Set pixels show INK; clear pixels show PAPER.

## The border

`OUT (0xFE), A` with the colour in bits 0-2 (also drives the beeper, bit 4 —
see interrupts-and-timing.md). The border can't do BRIGHT.

## Attribute clash — design with it, not against it

Two objects in the same 8×8 cell share one INK+PAPER. You cannot fix this;
1982 games were DESIGNED around it:

- **Mono sprites**: all moving objects in one ink colour; colour the
  background/zones instead (Manic Miner's approach per room).
- **Cell-aligned colour**: move objects in 8px steps, set the attr as you
  draw (no clash possible).
- **Attr-only effects**: explosions/flashes by writing attrs alone — 768
  bytes is cheap to repaint every frame (recipes/12-attr-effects, later).

## Gotchas

- Clearing the bitmap doesn't change colours; clearing attrs doesn't clear
  pixels. "My screen is blank but coloured wrong" → you cleared one, not both.
- Attr writes are visible immediately, even mid-frame — a full-screen attr
  repaint racing the beam can show a one-frame tear. HALT first.
- INK 7 on PAPER 7 = invisible text. After clearing attrs to a custom value,
  remember the ROM print routine uses ATTR-P (sysvar 0x5C8D) — set it or
  print "invisible" text. Simplest: write attrs yourself after printing.
- FLASH is a free animation channel (the ULA swaps ink/paper every 16
  frames) — also a classic accidental bug when bit 7 sneaks into your attr.
