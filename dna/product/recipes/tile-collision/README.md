# tile-collision — cell-map probe that stops a walker at a wall

The one collision primitive almost every Spectrum game reduces to: a flat
byte-per-cell map plus a "is the NEXT cell solid?" probe, tested before each
step so an actor can never tunnel. See the
[collision skill](../../skills/collision.md) for hitbox ranges, property bits
and the per-pixel stepping pattern this scales up to.

## The routine

```
; map_solid — is map cell C (0..31) of the one-row map solid?
; in:  C = column        out: NZ = solid, Z = empty. Clobbers A, HL, DE.
map_solid:
    ld l, c
    ld h, 0
    ld de, LEVELMAP
    add hl, de
    ld a, (hl)
    or a
    ret
```

Full games extend the address computation to `row*32 + col` and map tile ids to
property bits (`SOLID`/`DEADLY`/`PICKUP`) through a table — the probe shape
stays exactly this.

## The demo (`demo.asm`)

Builds a 32-cell map at `0xA000` (empty except a wall at column 20), then walks
an actor right from column 2, probing the NEXT cell before each step. The walker
must stop flush against the wall at column 19. It paints the wall and the
walker's final cell as attributes (visible in a screenshot), stores the final
column at `0x9001` and a `0x2A` sentinel at `0x9000`, then idles HALT-synced.

## The proof (`test.json`)

- the walker stopped exactly at column 19 (`memEquals 0x9001 = 13`) — probing
  `col+1` before stepping, never entering the wall;
- the sentinel confirms completion (`memEquals 0x9000 = 2A`);
- the run is healthy (`status ok`, `haltSynced true`, zero frame-budget overruns);
- the wall + walker attribute cells are on screen (`attrNonBlank >= 2`).
