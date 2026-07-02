<p align="center">
  <img src="assets/zx-vibes-logo.png" alt="ZX Vibes sticker logo" width="520">
</p>

# ZX Vibes

ZX Spectrum vibe-coding toolkit for coding agents and humans.

`zx-vibes` packages the feedback loop needed to create, build, run, inspect,
debug, and verify small ZX Spectrum 48K projects from one modern toolchain. It
combines a TypeScript Z80 assembler/disassembler, JavaScript CPU/ULA/machine
emulator cores, the `zxs` CLI, an MCP server for agent integrations, and an
executable conformance suite (`dna/`) that pins the whole behavior.

- npm packages: `zx-vibes`, `@zx-vibes/toolkit`, `@zx-vibes/asm`,
  `@zx-vibes/cpu`, `@zx-vibes/ula`, and `@zx-vibes/machine`
- Runtime: Node.js 20 or newer
- Package manager: pnpm recommended

> **Registry note:** this repository is a slice-by-slice regeneration of
> zx-vibes. Until its first release is published, the packages on npm still
> contain the previous implementation (including `create-zx-vibes` and
> `@zx-vibes/emulator`, which are not part of this tree).

## What You Get

- `zxs new` to scaffold a minimal, verify-passing Spectrum project.
- `zxs build`, `zxs run`, `zxs test`, and `zxs verify` for the local loop.
- `zxs screen`, `zxs regs`, `zxs mem`, `zxs disasm`, `zxs step`, `zxs trace`,
  `zxs break`, `zxs watch`, `zxs symbols`, `zxs coverage`, and `zxs gfx` for
  inspection and debugging.
- `zxs preview` for browser playback of the current project, a clean 48K
  machine (`--blank`), or `.z80`/`.tap`/`.tzx`/`.bin` files.
- `zxs state` sessions (`.zxstate`) shared between the CLI and the MCP server,
  with `.z80`, `.tap`, and `.scr` export.
- `zxs-mcp`, an MCP server for Codex, Claude, and other MCP-capable coding
  agents, configured by `zxs setup --agent codex|claude`.
- A default embedded assembler from `@zx-vibes/asm`, exposed directly as
  `zxasm`, with optional `sjasmplus` support.
- Reverse-engineering add-on commands (`zxs snapshot`, `zxs scan`, `zxs xref`)
  behind the `ZXS_REVENG` environment flag.
- Standalone emulator cores (`@zx-vibes/cpu`, `@zx-vibes/ula`,
  `@zx-vibes/machine`) exercised by an extensive conformance harness.

## Quick Start

Install the umbrella package and scaffold a project:

```bash
npm install -g zx-vibes
zxs new my-game
cd my-game
zxs doctor
zxs build
zxs verify
zxs preview --watch
```

The generated project is intentionally minimal and passes `zxs verify` out of
the box:

- `src/main.asm` as the assembler entry point (a HALT-synced 48K loop at
  `ORG 0x8000`).
- `tests/smoke.asm` and `tests/smoke.test.json` for declarative verification.
- `zx.config.json` for build configuration.
- `AGENTS.md` and `CLAUDE.md` with the agent playbook.

The rich `game`/`platformer` starter projects under `starters/` belong to the
future `create-zx-vibes` generator slice and have no consumer in this
repository yet; `zxs new --template` currently records the template choice as
config metadata only.

## Working With an Agent

After creating a project, open it with your coding agent and give it a concrete
Spectrum task:

```text
Create a simple arcade game for the ZX Spectrum.
Build it, run it, inspect the screen, and iterate until verify passes.
```

The intended loop is:

1. Edit Z80 assembly.
2. Run `zxs build`.
3. Run `zxs run`.
4. Inspect the screen with `zxs screen`.
5. If sound is part of the task, assert `audio.beeperEdges > 0` in run JSON or
   add a declarative `{ "type": "beeperEdges", "min": 1 }` test.
6. Run `zxs verify`.

Agents can use the same commands directly (every command supports `--json`),
or connect through the MCP server for structured build, run, screen, inspect,
debug, keyboard, and state tools. Most inspection commands can read a session,
`.z80`, or raw `--bin` source without mutating project state.

## CLI Basics

```bash
zxs new demo
zxs doctor
zxs build
zxs run --bin build/main.bin --org 0x8000 --frames 300 --screenshot screen.png
zxs screen --text --png screen.png
zxs test tests
zxs verify
zxs preview --port 5173 --watch
zxs preview --blank
zxs preview game.z80
```

`zxs preview` serves a browser player with a visible build hash. Add
`--watch` to rebuild the snapshot and reload the page when source/config files
change. If the requested port is busy, preview tries later ports and prints the
URL it actually selected; add `--strict-port` when a busy `--port` should be an
error. Use `--detach`, `--list`, and `--stop` when you want the preview server
to keep running outside the current command. Detached server records include a
local ownership token, so `--stop` only stops the tracked zx-vibes preview
server.

`zxs preview --blank` opens a clean ZX Spectrum 48K boot screen.
`zxs preview <file>` opens `.z80`, `.tap`, `.tzx`, and `.bin` files without
creating a project first. Tape playback preserves `.tap` and `.tzx` filenames
so the emulator can select the correct parser. `.sna` files are not supported
yet and fail with a clear error.

Debug and inspection commands:

```bash
zxs regs
zxs mem read 0x8000 --len 64
zxs mem dump --range 0x4000-0x5aff --out screen.ram
zxs break add 0x8000
zxs watch add --write 0x5800-0x5aff
zxs step 10
zxs disasm PC --count 12 --json
zxs trace --frames 5
zxs state save session.zxstate
zxs state export --z80 session.z80
zxs gfx screen --out screen.png
zxs gfx attrs --out attrs.png
```

Reverse-engineering add-on commands are gated behind an environment flag:

```bash
ZXS_REVENG=on zxs snapshot info game.z80
ZXS_REVENG=on zxs scan --z80 game.z80 --opcode "ED B0"
ZXS_REVENG=on zxs xref 0x5c00 --z80 game.z80
ZXS_REVENG=on zxs gfx find --z80 game.z80
```

## MCP Server

`zx-vibes` exposes `zxs-mcp`, an MCP server for coding agents. Generate local
configuration with:

```bash
zxs setup --agent claude
zxs setup --agent codex
```

`--agent claude` writes/merges a project `.mcp.json` (registering the
`zx-vibes` MCP server over `zxs-mcp`) plus a project skill under
`.claude/skills/zx-vibes/`. `--agent codex` writes `.codex/config.toml`
(project-local, or `~/.codex/config.toml` with `--write-global`) plus
`AGENTS.md`. The full knowledge pack (reference docs, skills, recipes) is a
later slice and is reported by `setup` under `deferred`.

## Assembler Backends

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
pnpm run check:drift
pnpm run conformance:check
pnpm run build
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run pack
pnpm run verify
```

`pnpm run verify` runs drift checks and the full `dna/` conformance suite
first, then build, typecheck, lint, and tests. Drift checks compare package
version surfaces, the emulator-env template, and the generated Z80 opcode
table. Starter-template and gallery-bundle drift checks are descoped until the
`create-zx-vibes` and gallery slices are regenerated.

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
node /path/to/zx-vibes/packages/toolkit/bin/zxs.js new my-game
cd my-game
node /path/to/zx-vibes/packages/toolkit/bin/zxs.js verify
```

`pnpm run pack` writes package tarballs to `.packs/`. Installing only
`.packs/zx-vibes-*.tgz` is not an all-local monorepo install: packed
`workspace:*` dependencies are rewritten to exact published versions, so
`@zx-vibes/toolkit`, `@zx-vibes/asm`, and the emulator core packages resolve
like regular registry dependencies. Use the built CLI workflow above for local
clone testing, or publish all package tarballs to a local registry when you
need to test unpublished package metadata together.

Target a single package when iterating:

```bash
pnpm --filter @zx-vibes/toolkit test
pnpm --filter @zx-vibes/asm test
pnpm --filter @zx-vibes/machine test
```

## Monorepo Layout

```text
dna/                Source-of-truth specs + executable conformance suite
packages/asm/       @zx-vibes/asm assembler/disassembler (zxasm)
packages/cpu/       @zx-vibes/cpu Z80 CPU core
packages/ula/       @zx-vibes/ula ULA video/timing core
packages/machine/   @zx-vibes/machine 48K machine integration
packages/toolkit/   @zx-vibes/toolkit zxs CLI, MCP server, preview player
packages/zx-vibes/  zx-vibes umbrella package and bin shims
examples/           Browser demos of the machine core (prebuilt bundle)
starters/           Starter projects reserved for the future generator slice
scripts/            Drift checks and generators for the root gates
```

## The DNA and Conformance Suite

`dna/` is the project genome: self-contained normative specs for the Z80, ULA,
Spectrum machine, file formats (`domain/`), and the project-invented product
surface — CLI, MCP tools, `.zxstate`, config schema, assertions, exit codes
(`product/`) — plus an executable decider (`conformance/`). An implementation
is correct iff it passes `pnpm run conformance:check`. Every fixture carries
tier and provenance metadata; external suites (FUSE, ZEX) run through
license-aware adapters. See [`dna/README.md`](dna/README.md).

## Published Packages

Current package manifest versions:

| Package | Version | Public surface |
| --- | ---: | --- |
| `zx-vibes` | `0.3.0` | Umbrella package with `zx-vibes`, `zxs`, `zxs-mcp`, and `zxasm` bins. |
| `@zx-vibes/toolkit` | `0.4.0` | `zxs`, `zxs-mcp`, and `zx-vibes` bins; package exports for CLI and MCP internals. |
| `@zx-vibes/asm` | `0.3.0` | `zxasm` bin plus `spectral-asm` compatibility alias; assembler/disassembler API. |
| `@zx-vibes/cpu` | `0.1.0` | Z80 CPU core exercised by the `dna/conformance` suites. |
| `@zx-vibes/ula` | `0.1.0` | ULA video/timing core exercised by the `dna/conformance` suites. |
| `@zx-vibes/machine` | `0.1.0` | 48K machine integration (CPU + ULA + tape/IO) used by the toolkit. |

`zxs --version` reports the toolkit version because the CLI is implemented by
`@zx-vibes/toolkit`. `zxasm --version` reports the assembler package version.

Each starter project under `starters/` pins a `zx-vibes` dev dependency floor
of `^0.3.0`, kept in sync with the umbrella package version by
`pnpm run check:versions`.

## Release, CI, and Security

CI runs on Ubuntu, macOS, and Windows across Node 20 and 22. The required path
is `check:drift`, `conformance:check`, build, a clean `git diff`, typecheck,
lint, and tests.

Releases use Changesets. The release workflow validates on Node 20 and 22, then
only publishes when manually dispatched with `publish=true`; the publish job
installs, builds, runs `pnpm run pack`, verifies npm auth, and then runs
`pnpm changeset publish`. Version numbers in this repository sit above the
already-published lines on npm (`@zx-vibes/toolkit` 0.4.0 > 0.3.1,
`zx-vibes` 0.3.0 > 0.2.1, `@zx-vibes/asm` 0.3.0 > 0.2.0) so the first publish
supersedes them cleanly. The published-but-absent `create-zx-vibes` and
`@zx-vibes/emulator` lines still need an explicit deprecate-or-regenerate
decision at publish time.

Root pnpm overrides pin patched transitive dependency floors for
`form-data@4.0.6`, `js-yaml@4.2.0`, and `read-yaml-file@2.1.0`.

## Contributing

Contributions are welcome while the project is still early. Before opening a
pull request, run:

```bash
pnpm install
pnpm run verify
pnpm run pack
```

Keep starter projects compatible with the embedded assembler unless a change is
explicitly about optional `sjasmplus` support.

## License

The zx-vibes source code is released under the MIT License. See
[`LICENSE`](LICENSE).

The repository includes a ZX Spectrum 48K ROM for emulator use. That ROM is
copyrighted material distributed under the permission described in
[`packages/toolkit/assets/ROM-NOTICE.md`](packages/toolkit/assets/ROM-NOTICE.md);
the same terms are recorded in [`examples/NOTICE`](examples/NOTICE) and
[`dna/conformance/rom/README.md`](dna/conformance/rom/README.md). The ROM
notice is separate from the MIT license that covers the zx-vibes source code.
