---
name: zx-reverse-engineering
description: Use for inspecting existing ZX Spectrum snapshots, finding graphics/assets, tracing display writes, disassembling routines, and exporting RAM or sprites.
---

# ZX Reverse Engineering Skill

## When to Use

Use this skill for `.z80`/`.sna` snapshot triage, asset ripping, unknown code
inspection, display-memory watchpoints, sprite/font extraction, and static
searches for draw routines.

## First Commands

```bash
zxs snapshot info game.z80 --json
zxs screen --z80 game.z80 --png screen.png --json
zxs gfx find --z80 game.z80 --json
zxs disasm PC --z80 game.z80 --json
```

Stay read-only until you need a mutable session. Use `--z80`, `--sna`, or
`--bin --org` directly on `screen`, `regs`, `mem read`, `disasm`, `trace`,
`scan`, `xref`, and `gfx` commands.

## Asset Extraction

```bash
zxs snapshot ram game.z80 --out ram.bin
zxs gfx screen --z80 game.z80 --out screen.png
zxs gfx attrs --z80 game.z80 --out attrs.png
zxs gfx linear 0xc000 --z80 game.z80 --width-bytes 2 --height 16 --count 16 --columns 8 --out sprites.png
zxs gfx font 0x3d00 --fresh --glyphs 96 --out rom-font.png
```

If `gfx find --json` reports candidate ranges, inspect them with `gfx linear`
using plausible widths: 1 byte for fonts/8px tiles, 2 bytes for 16px sprites,
and 4 bytes for 32px title graphics.

## Code Following

```bash
zxs scan --z80 game.z80 --opcode "ED B0" --json
zxs scan --z80 game.z80 --imm-range 0x4000-0x5aff --json
zxs xref 0x4000 --z80 game.z80 --json
zxs run --z80 game.z80 --watch-write 0x4000-0x5aff --until-watch --read-only --json
```

The watchpoint hit reports PC, instruction, touched address, value, registers,
and nearby disassembly. Use that PC as the next `disasm` range.

## Local Docs

- `docs/reference/reverse-engineering.md`
- `docs/reference/screen-layout.md`
- `docs/reference/attributes-and-colour.md`
- `docs/reference/testing-assertions.md`
- `docs/reference/common-bugs.md`
