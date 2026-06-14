# Provenance — Pong by agent

Full session transcript pending publication; this is the verified summary
recorded at the time of the run (2026-06-11). The complete source, tests
and provenance live in `packages/toolkit/examples/pong-by-agent/` in the zx-vibes repo.

## The run

- **Agent**: Claude (general-purpose subagent), driven only by the
  scaffold's AGENTS.md/CLAUDE.md playbook, the `docs/` references, and the `zxs` CLI.
- **Starting point**: `zxs new pong` (the stock QAOP skeleton — no game code).
- **Effort**: ~8 build/run cycles, 40 tool calls, ~11 minutes wall clock.

## The bug story

The agent's only real bug was a zero-terminated string printer colliding
with the `0x00` row operand inside an `AT 0,3` control sequence — the ROM
was left mid-command and the program crashed into the BASIC editor. The
hang watchdog could NOT flag it at the time (the BASIC editor is itself
HALT-synced); the cheap screen observability did: `nonBlankCells: 1` and a
lone "K" cursor in `zxs screen --text`. The agent then diagnosed it with
`zxs break add print_score`, `zxs run --until-break` and `zxs mem read` of
the channel sysvars — no guessing.

(That blind spot has since been closed: the watchdog now emits a
`pc-in-rom` verdict for exactly this crash shape.)

## Verification

- `zxs test examples/pong-by-agent` → 2/2 specs green in CI.
- HALT-synced loop, XOR drawing, 23 non-blank cells steady.
