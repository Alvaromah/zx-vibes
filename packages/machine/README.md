# @zx-vibes/machine

48K ZX Spectrum machine layer for the zx-vibes toolchain.

Current package version in this repository: `0.1.0`.

Joins `@zx-vibes/cpu` and `@zx-vibes/ula` into a runnable 48K machine with
interrupt acceptance, per-access memory contention, `.z80` snapshot
read/write, `.tap`/`.tzx` parsing and serialization, and tape loading (edge
and instant). It is regenerated from the project DNA and decided by the
machine conformance fixtures. This is the core the `@zx-vibes/toolkit` CLI
and MCP server run on.

## Usage

```js
import { createMachine, readZ80, writeZ80, parseTap } from "@zx-vibes/machine";

// memory is a caller-provided 64 KB address space with the 16 KB 48K ROM
// mapped at 0x0000 (the ROM is not bundled with this package)
const machine = createMachine({ memory });
machine.runFrame();
machine.stepInstruction();
```

`@zx-vibes/machine/interrupt` and `@zx-vibes/machine/machine` expose those
modules directly. Type declarations are generated from the source JSDoc
(`.d.mts` alongside each module).

The package does not ship the ZX Spectrum ROM; supply your own copy (the
toolkit ships one under its Amstrad redistribution notice).

## Testing

Tests are repo-only: the package is exercised by the `dna/conformance` fixture
suites in the [zx-vibes monorepo](https://github.com/Alvaromah/zx-vibes)
(`npm test` inside a published tarball is unsupported).

## License

MIT. See `LICENSE`.
