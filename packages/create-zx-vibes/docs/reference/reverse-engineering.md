# Reverse engineering and asset extraction

Use read-only commands first. They avoid mutating `.zxs/state.zxstate` and make
property-style investigations repeatable.

## Snapshot triage

```bash
zxs snapshot info game.z80 --json
zxs snapshot ram game.z80 --out ram.bin
zxs snapshot mem game.z80 0x4000 --len 6912 --out screen.scr
```

Current first-class snapshot support is 48K `.sna`, `.z80` v1, and
48K-compatible `.z80` v2/v3 snapshots. 128K `.z80` paging is detected but not
loaded as a 48K machine.

## Look at memory

```bash
zxs screen --z80 game.z80 --png screen.png --json
zxs mem dump --z80 game.z80 --range 0x4000-0x5aff --out screen.bin
zxs gfx screen --z80 game.z80 --out screen.png --json
zxs gfx attrs --z80 game.z80 --out attrs.png
zxs gfx find --z80 game.z80 --json
```

For 1bpp linear sprites or fonts:

```bash
zxs gfx linear 0xc000 --z80 game.z80 --width-bytes 2 --height 16 --count 16 --columns 8 --out sprites.png
zxs gfx font 0xc000 --z80 game.z80 --glyphs 96 --out font.png
```

For browser-side inspection, use `zxs play game.z80` for snapshots/tapes or
`zxs boot` for a clean 48K ROM screen before returning to read-only extraction
commands.

## Follow code

```bash
zxs disasm 0xd600-0xd660 --z80 game.z80 --json
zxs scan --z80 game.z80 --opcode "ED B0" --json
zxs scan --z80 game.z80 --imm-range 0x4000-0x5aff --json
zxs xref 0x4000 --z80 game.z80 --json
```

Use run-attached temporary watchpoints when you need to prove which code writes
to display memory:

```bash
zxs run --z80 game.z80 --watch-write 0x4000-0x5aff --until-watch --read-only --json
```

The watchpoint JSON includes the touched address, value, PC, triggering
instruction, and a short disassembly window.

## Baseline workflow

When a workflow must mutate a session:

```bash
zxs state save baseline.zxstate
zxs mem load 0x8000 --bin patch.bin
zxs run --frames 50 --json
zxs state load baseline.zxstate
```

For investigative runs, prefer `--read-only` or `--no-save`. Set
`ZXS_STATE_DIR` if a managed checkout blocks `.zxs` writes.
