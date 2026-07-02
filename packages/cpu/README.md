# @zx-vibes/cpu

Z80 CPU core for the zx-vibes ZX Spectrum 48K toolchain.

Current package version in this repository: `0.1.0`.

A dependency-free, JavaScript (ESM) Z80 core exposing a single-instruction
`step` function over caller-provided registers, memory, IO, and clock hooks.
It is regenerated from the project DNA (`dna/domain/`) and decided by the FUSE
conformance oracle and the ZEX exercisers.

## Usage

```js
import { step } from "@zx-vibes/cpu";

const result = step({ registers, memory, io, clock });
// result.registers — updated register file
// result.tStates   — T-states consumed by the executed instruction
```

`@zx-vibes/cpu/step` exposes the same `step` entry directly. Type declarations
are generated from the source JSDoc (`.d.mts` alongside each module).

Most consumers want `@zx-vibes/machine`, which joins this core with the ULA
model, interrupt acceptance, and memory contention.

## Testing

Tests are repo-only: the package is exercised by the `dna/conformance` fixture
suites in the [zx-vibes monorepo](https://github.com/Alvaromah/zx-vibes)
(`npm test` inside a published tarball is unsupported).

## License

MIT. See `LICENSE`.
