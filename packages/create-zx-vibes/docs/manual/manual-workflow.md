# Manual CLI Workflow

You can use zx-vibes as a normal command-line toolkit without an agent.

Edit the main program:

```bash
code src/main.asm
```

Build:

```bash
npm run build
```

Run for 300 frames and save a screenshot:

```bash
npm run run
```

Inspect the current session screen as text and PNG:

```bash
npm run screen
```

Schedule input when testing controls:

```bash
zxs run --bin build/main.bin --org 0x8000 --frames 300 --keys "10:P*30,60:SPACE*5" --json
```

Run declarative tests:

```bash
npm test
```

List supported assertions:

```bash
zxs test tests --list-assertions
```

Verify everything:

```bash
npm run verify
```

## Standalone Assembler

The default backend is `@zx-vibes/asm`, a TypeScript Z80 assembler and
disassembler that works without native dependencies. Use `zxasm` directly when
you want the standalone assembler CLI:

```bash
zxasm assemble src/main.asm -I lib --out-dir build
zxasm disasm build/main.bin --org 0x8000 --count 32
zxasm doctor
```

The embedded backend name in `zxs build --assembler` remains `spectral` for
compatibility with older configuration. `spectral-asm` also remains a bin alias
for `zxasm`.

For projects that need a `sjasmplus` feature, install `sjasmplus` separately
and select it with either:

```bash
ZXS_ASSEMBLER=sjasmplus zxs build
zxs build --assembler sjasmplus
```

The starter projects are designed to work with the embedded assembler by
default.
