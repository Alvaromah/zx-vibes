# zx-vibes

Umbrella package for the zx-vibes ZX Spectrum 48K toolchain.

Current package version in this repository: `0.2.1`.

Install this package in generated or hand-written projects when you want the
standard user-facing command set without depending on implementation packages
directly.

## Install

```bash
pnpm add -D zx-vibes
pnpm exec zxs doctor
```

Node.js 20 or newer is required.

## Bins

| Bin | Delegates to | Purpose |
| --- | --- | --- |
| `zxs` | `@zx-vibes/toolkit` | Build, run, inspect, debug, verify, scaffold, and preview projects. |
| `zxs-mcp` | `@zx-vibes/toolkit` | MCP server for agent integrations. |
| `zxasm` | `@zx-vibes/asm` | Standalone embedded assembler/disassembler CLI. |
| `zx-vibes` | `@zx-vibes/toolkit` | Compatibility CLI alias. |

`zxs --version` reports the toolkit package version. `zxasm --version` reports
the assembler package version.

## Common Commands

```bash
pnpm exec zxs build
pnpm exec zxs run --bin build/main.bin --org 0x8000 --frames 300 --screenshot screen.png
pnpm exec zxs verify
pnpm exec zxs preview --watch
pnpm exec zxs boot
pnpm exec zxs play game.z80
pnpm exec zxasm assemble src/main.asm -I lib --out-dir build
```

The package is intentionally thin. The implementation lives in
`@zx-vibes/toolkit` and `@zx-vibes/asm`.

## Development

From the repository root:

```bash
pnpm --filter zx-vibes build
pnpm --filter zx-vibes typecheck
pnpm --filter zx-vibes lint
pnpm --filter zx-vibes test
```

The package has a prepack build smoke path so publishing catches broken shims or
metadata before npm packing.

## License

MIT. The delegated toolkit (`@zx-vibes/toolkit`) ships a ZX Spectrum 48K ROM
under the separate notice in that package's `assets/ROM-NOTICE.md`.
