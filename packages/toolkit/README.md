# @zx-vibes/toolkit

Main implementation package for the zx-vibes ZX Spectrum 48K toolchain.

`@zx-vibes/toolkit` provides the `zxs` CLI, the `zxs-mcp` MCP server, project
templates, recipes, generated-project reference docs, and the headless/browser
feedback loop used by coding agents and humans.

Current package version in this repository: `0.3.1`.

## Install

Most users should install the umbrella package:

```bash
pnpm add -D zx-vibes
pnpm exec zxs --help
```

Use this package directly when embedding or testing toolkit internals:

```bash
pnpm add -D @zx-vibes/toolkit
pnpm exec zxs doctor
```

The package requires Node.js 20 or newer.

## Bins

| Bin | Purpose |
| --- | --- |
| `zxs` | Build, run, inspect, debug, verify, scaffold, and preview ZX Spectrum projects. |
| `zxs-mcp` | MCP server exposing the toolkit to agent clients. |
| `zx-vibes` | Compatibility alias for the toolkit CLI. |

`zxs --version` reports the `@zx-vibes/toolkit` package version.

## CLI Surface

Common project loop:

```bash
pnpm exec zxs doctor
pnpm exec zxs build
pnpm exec zxs run --bin build/main.bin --org 0x8000 --frames 300 --screenshot screen.png
pnpm exec zxs screen --text --png screen.png
pnpm exec zxs test tests
pnpm exec zxs verify
pnpm exec zxs preview --watch
```

Browser playback:

```bash
pnpm exec zxs boot
pnpm exec zxs play game.z80
pnpm exec zxs play game.tap
pnpm exec zxs play game.tzx
```

`zxs boot` opens a clean ZX Spectrum 48K boot screen. `zxs play` opens `.z80`,
`.sna`, `.tap`, and `.tzx` files without requiring a project. TAP/TZX playback
preserves the served filename so the emulator can select the correct parser.

Preview lifecycle:

```bash
pnpm exec zxs preview --port 5173 --watch
pnpm exec zxs preview --detach
pnpm exec zxs preview --list
pnpm exec zxs preview --stop
```

Detached preview records include a local ownership token. `--stop` asks the
tracked preview server to stop instead of killing arbitrary PIDs.

Inspection and reverse-engineering helpers:

```bash
pnpm exec zxs regs
pnpm exec zxs mem read 0x8000 --len 64
pnpm exec zxs snapshot info game.z80
pnpm exec zxs snapshot ram game.z80 --out game.ram
pnpm exec zxs snapshot mem game.z80 0x4000 --len 32
pnpm exec zxs gfx screen --z80 game.z80 --out screen.png
pnpm exec zxs gfx attrs --z80 game.z80 --out attrs.png
pnpm exec zxs gfx find --z80 game.z80
pnpm exec zxs disasm PC --count 12 --json
pnpm exec zxs scan --z80 game.z80 --opcode "ED B0"
pnpm exec zxs xref 0x5c00 --z80 game.z80
```

The toolkit supports `.z80` v1 48K snapshots and 48K-compatible `.z80` v2/v3
snapshots using pages 8, 4, and 5. 128K paging is outside the current emulator
support.

## Assembler Backends

The default backend is the embedded `@zx-vibes/asm` package. It emits the raw
`.bin`, SLD symbols, and additional `SAVEBIN` artifacts consumed by toolkit
debugging and preview workflows.

The backend name in `zxs build --assembler` is still `spectral` for
configuration compatibility:

```bash
pnpm exec zxs build --assembler spectral
```

Advanced projects can opt into an external `sjasmplus` binary:

```bash
ZXS_ASSEMBLER=sjasmplus pnpm exec zxs build
pnpm exec zxs build --assembler sjasmplus
```

Starter projects, templates, and recipes are expected to work with the embedded
assembler unless a change explicitly targets optional `sjasmplus` usage.

## Scaffolding

`zxs new` creates the same project contract as `create-zx-vibes`:

```bash
pnpm exec zxs new my-game --template game
pnpm exec zxs new my-platformer --template platformer --no-install
```

Generated projects include:

- `src/main.asm`, helper routines, `zx.config.json`, and smoke tests.
- npm scripts for `build`, `run`, `test`, `verify`, and `preview`.
- `AGENTS.md` and `CLAUDE.md` generated from the shared playbook.
- `.mcp.json` and `docs/agents/codex-mcp.toml` for MCP clients.
- local `docs/reference/` and `docs/agents/skills/` copies.

Dependencies install by default. Use `--no-install` for offline work or local
checkout testing.

## MCP Server

Generate local MCP config snippets with:

```bash
pnpm exec zxs setup --agent codex
pnpm exec zxs setup --agent claude
```

The MCP server runs as:

```bash
pnpm exec zxs-mcp
```

It exposes structured build, run, screen, inspect, debug, keyboard, and state
tools over stdio.

## Package Contents

The npm package publishes:

- `bin/` CLI shims.
- `dist/` built toolkit and MCP modules.
- `docs/reference/` and `docs/agents/`.
- `recipes/`.
- `templates/`.

Gallery assets and examples exist in the repository, but they are not part of
this package's current `files` list.

## Development

From the repository root:

```bash
pnpm --filter @zx-vibes/toolkit build
pnpm --filter @zx-vibes/toolkit typecheck
pnpm --filter @zx-vibes/toolkit lint
pnpm --filter @zx-vibes/toolkit test
```

Use root `pnpm run verify` when changes affect generated assets, CLI/MCP
contracts, assembler integration, emulator integration, or package publishing.

## License

MIT. The toolkit depends on `@zx-vibes/emulator`, which includes a ZX Spectrum
48K ROM under the separate notice in the emulator package's `rom/README.md`.
