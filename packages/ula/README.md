# @zx-vibes/ula

48K ZX Spectrum ULA model for the zx-vibes toolchain.

Current package version in this repository: `0.1.0`.

A dependency-free JavaScript (ESM) model of the 48K ULA: frame/interrupt
timing constants, memory contention, screen address/attribute arithmetic,
`.scr` format helpers, floating-bus behavior, and Kempston joystick port
decoding. It is regenerated from the project DNA (`dna/domain/`) and decided
by the timing conformance fixtures.

## Usage

```js
import {
  FRAME_T_STATES,
  interruptActive,
  isContendedAddress,
  contentionDelay,
} from "@zx-vibes/ula";
```

`@zx-vibes/ula/timing` exposes the timing module directly. Type declarations
are generated from the source JSDoc (`.d.mts` alongside each module).

Most consumers want `@zx-vibes/machine`, which joins this model with the
`@zx-vibes/cpu` core.

## Testing

Tests are repo-only: the package is exercised by the `dna/conformance` fixture
suites in the [zx-vibes monorepo](https://github.com/Alvaromah/zx-vibes)
(`npm test` inside a published tarball is unsupported).

## License

MIT. See `LICENSE`.
