# Debugging

When something looks wrong, use the CLI before guessing.

Inspect CPU registers:

```bash
zxs regs
```

Read memory:

```bash
zxs mem read 0x8000 --len 64
```

Add a breakpoint and run until it is hit:

```bash
zxs break add 0x8000
zxs run --until-break --json
zxs disasm PC --count 16
```

Watch screen attribute writes:

```bash
zxs watch add --write 0x5800-0x5aff
zxs run --until-watch --json
```

Trace hot spots:

```bash
zxs trace --frames 5
```

## Snapshot and File Inspection

Inspection commands can read a session, `.sna`, `.z80`, or raw `--bin` source
without mutating the project state.

```bash
zxs snapshot info game.z80
zxs snapshot ram game.z80 --out game.ram
zxs snapshot mem game.z80 0x4000 --len 32
zxs gfx screen --z80 game.z80 --out screen.png
zxs gfx attrs --z80 game.z80 --out attrs.png
zxs gfx find --z80 game.z80
zxs scan --z80 game.z80 --opcode "ED B0"
zxs xref 0x5c00 --z80 game.z80
```

If `zxs` is not installed globally, run advanced commands through the project
script:

```bash
npm run zxs -- regs
npm run zxs -- trace --frames 5
```

## Triage Order

Start with the cheapest signal:

1. Rebuild and capture the exact assembler error or run JSON.
2. Inspect `status`, `likelyCause`, registers, and the current PC.
3. Inspect the screen as text or PNG.
4. Use breakpoints or watches around the failing address or screen region.
5. Add a test that preserves the fix.

For Spectrum-specific details, read the generated project's local
`docs/reference/` files. The most common starting points are
`common-bugs.md`, `screen-layout.md`, `keyboard-input.md`, and
`attributes-and-colour.md`.
