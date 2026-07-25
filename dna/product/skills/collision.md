# Collision — tile maps and hitboxes that never tunnel

Almost every Spectrum game reduces collision to ONE cheap primitive: **"is this
tile solid?"** — then asks it for the handful of cells an actor's box overlaps.
Pixel-perfect masks are rarely worth the T-states; an 8x8-cell map with a small
AABB probe reads well and stays inside the frame budget.

Recipe (CI-tested, copy from it): [`recipes/tile-collision/`](../recipes/tile-collision/README.md).

## The map

Keep the level as a flat array of tile ids, one byte per 8x8 cell (32 wide):

```
tile_at:                    ; B = row, C = col -> A = tile id
    ld l, b
    ld h, 0
    add hl, hl              ; x32: five shifts
    add hl, hl
    add hl, hl
    add hl, hl
    add hl, hl
    ld e, c
    ld d, 0
    add hl, de
    ld de, LEVELMAP
    add hl, de
    ld a, (hl)
    ret
```

Treat off-map rows as solid so nothing ever leaves the play area. Map tile ids
to property bits (`SOLID`, `DEADLY`, `PICKUP`) through a small table rather than
comparing ids inline — one `AND mask` per query.

## The probe

For an actor box at pixel (x, y) of size (w, h): the overlapped cell range is
`col0 = x >> 3`, `col1 = (x+w-1) >> 3`, same for rows (the pixel→cell decode is
the display file's own geometry — [memory-map.md](../reference/memory-map.md)).
OR the property bits of every cell in that range; the result answers "solid?",
"deadly?", "standing on a pickup?" in one pass. Shrink the box a pixel or two
inside the sprite so brushing a wall does not read as a hit.

## Movement that cannot tunnel

Never add a velocity to a coordinate and then check. Step the actor **one pixel
at a time** along each axis, testing the leading edge before each step:

```
; move down by (vy) pixels, stopping at the first solid
fall:
    ld b, vy_pixels
.step:
    probe box at (x, y+1)   ; the row of cells under the feet
    jr solid, .land
    inc y
    djnz .step
    ; airborne
.land:
    ; grounded: zero vy, snap to the cell edge (y is already flush)
```

At Spectrum speeds (terminal velocity ≤ 4 px/frame) that is at most 4 probes a
frame per axis — cheap ([z80-opcodes.md](../reference/z80-opcodes.md) for the
shift/add costs), and platforms become impossible to fall through regardless of
frame spikes.

## Actor vs actor

AABB overlap on centres: `|x1-x2| < (w1+w2)/2` and same for Y — two subtractions,
two compares per pair. With ≤ 8 actors the naive all-pairs loop is nowhere near
the budget; do not build a grid you don't need.
