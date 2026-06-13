# Arkanoid — the quickstart tutorial game

Built step by step in `docs/quickstart-arkanoid.md` (Spanish), every stage
verified with the zxs loop as it was written. Breakout core: 140 bricks in
5 colored rows, O/P paddle, cell-based ball, BCD score, 3 lives, win and
game-over screens, SPACE to restart.

```bash
zxs test examples/arkanoid-quickstart     # 2/2 specs
zxs build examples/arkanoid-quickstart/src/main.asm
zxs run --bin build/main.bin --org 0x8000 --frames 300 --keys "40:P*30"
```

Playable in the gallery. Uses recipes 01/02/04/06/10 via `lib/` copies,
plus a `print_at` helper born from re-hitting the classic zero-terminator
vs `AT 0,0` collision (the same bug the Pong agent met — see the tutorial).
