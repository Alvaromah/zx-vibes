# zx-vibes

ZX Spectrum vibe-coding toolkit for coding agents and humans.

`zx-vibes` packages the feedback loop needed to create, build, run, inspect,
debug, and publish small ZX Spectrum 48K projects from one modern toolchain. It
combines a TypeScript Z80 assembler/disassembler, a headless and browser-capable
emulator, the `zxs` CLI, an MCP server for agent integrations, starter projects,
reference docs, and a public gallery.

- Public gallery: <https://alvaromah.github.io/zx-vibes/>
- npm release: `0.1.0`
- Runtime: Node.js 20 or newer
- Package manager: pnpm recommended

## What You Get

- `pnpm create zx-vibes` to scaffold a working Spectrum project.
- `zxs build`, `zxs run`, `zxs verify`, and `zxs preview` for the local loop.
- `zxs-mcp` for Codex, Claude, and other MCP-capable coding agents.
- A default embedded assembler from `@zx-vibes/asm`.
- Optional `sjasmplus` support for advanced assembler workflows.
- A ZX Spectrum 48K emulator package for headless tests and browser players.
- Reference notes for memory, screen layout, keyboard input, ROM routines,
  colour attributes, timing, and common Spectrum bugs.

## Quick Start From npm

Create a project from the published npm package:

```bash
pnpm create zx-vibes my-game --template game --install
cd my-game
pnpm exec zxs doctor
pnpm exec zxs build
pnpm exec zxs verify
pnpm exec zxs preview
```

Use the `platformer` starter when you want a slightly more game-shaped baseline:

```bash
pnpm create zx-vibes my-platformer --template platformer --install
cd my-platformer
pnpm exec zxs verify
```

The generated project includes:

- `src/main.asm` as the assembler entry point.
- `lib/` helpers for screen and keyboard routines.
- `tests/smoke.test.json` for declarative verification.
- `zx.config.json` for build configuration.
- `CLAUDE.md` with an agent playbook that also works as human guidance.
- npm scripts for `build`, `run`, `test`, `verify`, and `preview`.

## Working With an Agent

After creating a project, open it with your coding agent and give it a concrete
Spectrum task:

```text
Create a simple arcade game for the ZX Spectrum.
Build it, run it, inspect the screen, and iterate until verify passes.
```

The intended loop is:

1. Edit Z80 assembly.
2. Run `pnpm exec zxs build`.
3. Run `pnpm exec zxs run --bin build/main.bin --org 0x8000 --frames 300 --screenshot screen.png`.
4. Inspect the screen with `pnpm exec zxs screen --text --png screen.png`.
5. Run `pnpm exec zxs verify`.

Agents can use the same commands directly, or connect through the MCP server for
structured build, run, screen, inspect, debug, keyboard, and state tools.

## CLI Basics

Install through a generated project, or add the umbrella package yourself:

```bash
pnpm add -D zx-vibes
pnpm exec zxs --help
```

Common commands:

```bash
pnpm exec zxs new demo --template game
pnpm exec zxs doctor
pnpm exec zxs build
pnpm exec zxs run --bin build/main.bin --org 0x8000 --frames 300 --screenshot screen.png
pnpm exec zxs screen --text --png screen.png
pnpm exec zxs test tests
pnpm exec zxs verify
pnpm exec zxs preview --port 5173
pnpm exec zxs bench --frames 2000
```

Debug and inspection commands are also available:

```bash
pnpm exec zxs regs
pnpm exec zxs mem read 0x8000 --len 64
pnpm exec zxs break add 0x8000
pnpm exec zxs step 10
pnpm exec zxs trace --frames 5
pnpm exec zxs state save session.zxstate
```

## MCP Server

`zx-vibes` exposes `zxs-mcp`, an MCP server for coding agents. Generate local
configuration snippets with:

```bash
pnpm exec zxs setup --agent codex
pnpm exec zxs setup --agent claude
```

For Codex, the config shape is:

```toml
[mcp_servers.zx_vibes]
command = "pnpm"
args = ["exec", "zxs-mcp"]
startup_timeout_sec = 30
tool_timeout_sec = 300
```

For Claude-compatible clients:

```json
{
  "mcpServers": {
    "zx_vibes": {
      "command": "pnpm",
      "args": ["exec", "zxs-mcp"]
    }
  }
}
```

## Assembler Backends

The default backend is `@zx-vibes/asm`, a TypeScript Z80 assembler and
disassembler that works without native dependencies. For projects that need a
`sjasmplus` feature, install `sjasmplus` separately and select it with either:

```bash
ZXS_ASSEMBLER=sjasmplus pnpm exec zxs build
pnpm exec zxs build --assembler sjasmplus
```

The starter projects are designed to work with the embedded assembler by
default.

## Using This Repository

Clone the monorepo when you want to work on the toolkit itself:

```bash
git clone https://github.com/Alvaromah/zx-vibes.git
cd zx-vibes
pnpm install
pnpm run verify
```

Useful root commands:

```bash
pnpm run build
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run pack
pnpm run verify
```

### Local Clone Workflows

`pnpm exec zxs ...` is a project-local command. It expects to run inside a
directory with a `package.json`, so from an empty parent directory pnpm exits
before `zxs` starts. When testing a clone before publishing changes, build the
monorepo and invoke the built CLI directly:

```bash
cd /path/to/zx-vibes
pnpm install
pnpm run build

mkdir -p /tmp/zx-vibes-local
cd /tmp/zx-vibes-local
node /path/to/zx-vibes/packages/toolkit/dist/cli/index.js new my-game --template platformer
cd my-game
node /path/to/zx-vibes/packages/toolkit/dist/cli/index.js verify
```

After a generated project has installed `zx-vibes`, use the normal project-local
commands:

```bash
pnpm exec zxs verify
pnpm exec zxs preview
```

`pnpm run pack` writes package tarballs to `.packs/`. Installing only
`.packs/zx-vibes-*.tgz` is not an all-local monorepo install: packed
`workspace:*` dependencies are rewritten to exact published versions, so
`@zx-vibes/toolkit`, `@zx-vibes/asm`, and `@zx-vibes/emulator` resolve like
regular registry dependencies. Use the built CLI workflow above for local
clone testing, or publish all package tarballs to a local registry when you
need to test unpublished package metadata together.

Target a single package when iterating:

```bash
pnpm --filter @zx-vibes/toolkit test
pnpm --filter @zx-vibes/asm test
pnpm --filter @zx-vibes/emulator test
pnpm --filter create-zx-vibes run check:assets
```

## Monorepo Layout

```text
docs/                     Shared reference docs and MCP config snippets
gallery/                  Built GitHub Pages gallery output
packages/asm/             @zx-vibes/asm assembler/disassembler
packages/create-zx-vibes/ create-zx-vibes project generator
packages/emulator/        @zx-vibes/emulator Spectrum emulator
packages/toolkit/         @zx-vibes/toolkit CLI, MCP server, recipes, gallery
packages/zx-vibes/        zx-vibes umbrella package and bin shims
starters/                 Source starter projects copied by the generator
```

## Published Packages

| Package | Purpose |
| --- | --- |
| `zx-vibes` | Umbrella package that exposes `zxs`, `zxs-mcp`, and related bins. |
| `create-zx-vibes` | `pnpm create zx-vibes` project generator. |
| `@zx-vibes/toolkit` | CLI, MCP server, build/run/verify loop, recipes, and gallery tooling. |
| `@zx-vibes/asm` | TypeScript Z80 assembler/disassembler. |
| `@zx-vibes/emulator` | JavaScript ZX Spectrum 48K emulator. |

## Gallery and Docs

The public gallery is deployed with GitHub Pages at
<https://alvaromah.github.io/zx-vibes/>. It showcases generated Spectrum games
with playable browser snapshots, screenshots, metadata, and transcripts.

Reference docs live in `docs/reference/` and are copied into generated projects
so agents can answer common Spectrum implementation questions without leaving
the workspace.

## Contributing

Contributions are welcome while the project is still early. Before opening a
pull request, run:

```bash
pnpm install
pnpm run verify
pnpm run pack
```

Keep starter projects compatible with the embedded assembler unless a change is
explicitly about optional `sjasmplus` support. If you change starter assets,
make sure the generator package assets stay in sync.

## License

The zx-vibes source code is released under the MIT License. See
[`LICENSE`](LICENSE).

The repository includes a ZX Spectrum 48K ROM for emulator use. That ROM is
copyrighted material distributed under the permission described in
[`packages/emulator/rom/README.md`](packages/emulator/rom/README.md). The ROM
notice is separate from the MIT license that covers the zx-vibes source code.
