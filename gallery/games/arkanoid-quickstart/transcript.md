# Provenance — Arkanoid (quickstart)

This game exists because the owner asked for a step-by-step tutorial
("how do I build an Arkanoid from scratch?"). Instead of writing the
tutorial from theory, Claude built the game live with the zxs loop,
verifying every stage, then wrote the tutorial from the verified code.
Full walkthrough: `packages/toolkit/docs/quickstart-arkanoid.md` in the zx-vibes repo.

## The stages (each one ran green before the next)

1. **El escenario** — clear screen, ROM-printed HUD, static paddle.
   Verified: `haltSynced: true`, HUD and paddle visible in `zxs screen --text`.
2. **La pala** — O/P movement with clean erase/redraw, clamped to edges.
   Verified with scheduled keys: `--keys "10:P*40,70:O*20"` parks the
   paddle deterministically at column 9.
3. **La bola** — XOR sprite, wall/ceiling/paddle bounces, 3 lives,
   game-over screen with SPACE restart. Verified: autopilot loses all
   lives by frame ~960; restart works; loop stays halt-synced.
4. **Ladrillos** — 140 bricks in 5 attribute-colored rows, pixel-presence
   collision (the screen is the data model), BCD score, win screen.
   Verified: first brick falls deterministically at row 7, col 19 on
   frame ~20 (SCORE 000010); the win path was exercised by poking
   `BRICKS=1` into live memory with `zxs mem write`.

## The bug story (history rhymes)

The HUD refused to print at `AT 0,0`: the zero-terminated string printer
eats the two `0` operand bytes as end-of-string — **the exact same bug
the Pong agent hit** in the Phase 4 milestone, rediscovered by Claude
while writing a tutorial about avoiding it. Fixed with a `print_at`
helper that sends the control bytes through registers, immune to the
terminator. The tutorial documents the trap.

## Verification

- `zxs test examples/arkanoid-quickstart` → 2/2 specs in CI.
- Deterministic: same boot + same keys ⇒ identical run, every time.
