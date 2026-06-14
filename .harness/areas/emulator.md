# emulator

Last updated: 2026-06-14

## Paths

- `packages/emulator/`

## Role

JavaScript ZX Spectrum 48K emulator foundation consumed by the toolkit and
published as `@zx-vibes/emulator`.

## Owns

- Z80 CPU core, registers, flags, decoder, and instruction implementations.
- Spectrum memory, ULA/display, keyboard, sound, tape, snapshots, and ROM.
- Browser examples and distributable emulator bundle.
- Jest tests for core, instruction, spectrum, and integration behavior.

## Stack

- Language: JavaScript ESM.
- Package manager: pnpm.
- Build: Rollup.
- Tests: Jest.

## Important commands

```bash
pnpm --filter @zx-vibes/emulator build
pnpm --filter @zx-vibes/emulator typecheck
pnpm --filter @zx-vibes/emulator lint
pnpm --filter @zx-vibes/emulator test
pnpm --filter @zx-vibes/emulator start
```

## Important files or directories

- `packages/emulator/src/core/cpu.js`
- `packages/emulator/src/core/registers.js`
- `packages/emulator/src/core/flags.js`
- `packages/emulator/src/decoder/`
- `packages/emulator/src/instructions/`
- `packages/emulator/src/spectrum/`
- `packages/emulator/src/index.js`
- `packages/emulator/rom/48k.rom`
- `packages/emulator/tests/`
- `packages/emulator/rollup.config.js`

## External dependencies

- No service dependencies.
- Browser/Web Audio behavior matters for examples and gallery/player usage.
- ROM licensing is documented separately under emulator ROM notices.

## Known gotchas

- Toolkit imports emulator internals through exported deep paths. Renames or
  export changes can break `packages/toolkit/src/core/machine.ts`.
- CPU/display changes can affect screenshot/golden behavior in toolkit tests.
- Preserve ROM notice and licensing context when moving ROM assets.

## Validation expectations

- Run `pnpm --filter @zx-vibes/emulator test` for emulator behavior changes.
- Run `pnpm --filter @zx-vibes/emulator build` for bundle/export changes.
- If toolkit consumes the changed internals, run the relevant toolkit tests or
  root `pnpm run verify`.

## Recent area notes

- Root harness initialized this area on 2026-06-14.
