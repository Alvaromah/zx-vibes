# {{PROJECT_NAME}} — regenerate a playable ZX Spectrum 48K emulator from a DNA

This repo is a **clean-room reconstruction experiment**. It contains only the
**genome** (`dna/`) — an executable specification plus its own conformance judge —
and the agent contract (`AGENTS.md`). From these, a coding agent (e.g. Codex) builds a
working ZX Spectrum 48K emulator: the code is correct **iff** it passes
`dna/conformance/`.

There is intentionally **no implementation here yet** and no reference to any previous
build. Everything (`packages/`, `web/`) is generated from the DNA.

## What the emulator must do

1. Boot the 48K ROM and run BASIC.
2. Produce stable, audible beeper sound.
3. Load and play games: `.z80` snapshots and `.tap` / `.tzx` tapes.

## Start here

1. Read **`AGENTS.md`** — the contract. It defines the three layers (conformant core,
   conformant host I/O, demonstrated shell) and what "correct" means for each.
2. Confirm the genome is intact:
   ```bash
   npm run conformance:self-test
   ```
3. Build the core, then the host I/O, then the shell — verifying against the gates as
   you go (see `AGENTS.md` → "Quick commands").

## Host assets you must supply (not in the DNA)

- `rom/48.rom` — the 16 KB 48K BASIC ROM (see `rom/README.md`).
- `tapes/` — sample `.z80` / `.tap` / `.tzx` files for testing (see `tapes/README.md`).

## Layout

```
dna/         the genome + the conformance judge (never edit)
packages/    the conformant core — generated (cpu, ula, machine)
web/         the host shell — generated (display, audio, keyboard, loaders, page)
rom/         host asset: the 48K ROM
tapes/       host assets: test snapshots / tapes
AGENTS.md    the agent contract — read first
NOTES.md     the agent's running log (created during work)
```

## Provenance

Generated from the `zx-vibes-dna` genome at commit `{{DNA_COMMIT}}`
({{DNA_COMMIT_DATE}}), on {{GENERATED_DATE}}, by `scripts/new-emulator-env.mjs`.
The exact source is recorded in `dna.provenance.json`. The `dna/` tree is a snapshot:
if the genome moves on, regenerate a fresh environment rather than hand-patching this
copy.
