<p align="center">
  <img src="assets/zx-vibes-logo.png" alt="ZX Vibes sticker logo" width="520">
</p>

# ZX Vibes

ZX Spectrum vibe-coding toolkit for coding agents and humans.

`zx-vibes` packs the whole feedback loop into one modern toolchain: scaffold a
project, assemble Z80, run it on a fast headless emulator (~130× real
hardware), read the screen back as text or PNG, debug, and gate everything
behind a single `zxs verify`. Claude, Codex, and any MCP-capable agent can
drive it through the `zxs` CLI (every command speaks `--json`) or the bundled
MCP server.

Requires Node.js 20+.

## Pong in five minutes

```bash
npm install -g zx-vibes
zxs new pong
cd pong
zxs setup --agent claude    # or: zxs setup --agent codex
```

`zxs new` doesn't scaffold an empty loop — it's a small playable game that
already builds, runs, and passes `zxs verify`. The code your agent will edit
is `src/main.asm`. `zxs setup` registers the MCP server and installs the
agent playbook plus a knowledge pack (hardware reference, technique skills,
CI-tested recipes) where your agent will find them.

Now open your agent in the project — `claude` or `codex` — and paste:

```text
Turn this project into Pong: two paddles (Q/A on the left, O/P on the
right), a bouncing ball, and a score row. After every change, build and
run it and look at the screen. Done means zxs verify passes.
```

While the agent works (and after), play the game yourself:

```bash
zxs preview --watch    # browser player; rebuilds and reloads on every edit
```

That's the entire workflow. The loop the agent follows — the same one you'd
use by hand — is:

1. Edit `src/main.asm`.
2. `zxs build`
3. `zxs run --json` — check `status: "ok"`, `haltSynced: true`, and
   `frameBudget.overrunFrames: 0`.
4. `zxs screen --text` — look at the result. Never trust, always look.
5. `zxs verify` — the acceptance gate (build → run → screenshot → tests).

## Recipes

[`docs/recipes.md`](docs/recipes.md) is the task-shaped cookbook — start
there when you (or your agent) want to:

- **Create a game** — what the scaffold gives you and the tight iteration loop.
- **Inspect the screen** — text OCR, PNG snapshots, declarative screen assertions.
- **Enforce frame timing** — expose missed deadlines and profile T-states by routine.
- **Anchor scenarios** — inject test state with `setup` and start input at `waitFor`.
- **Assert sound** — prove the beeper actually beeped (`beeperEdges`).
- **Debug hangs** — what the `di-halt`, `tight-loop`, and `pc-in-rom` verdicts mean.
- **IM1 vs IM2** — when to leave the ROM interrupt handler behind, with a
  verified IM2 template to copy.

## What's in the box

- `zxs new` — scaffold a playable, verify-passing game
  (`--template game|platformer`).
- `zxs build` / `run` / `test` / `verify` — the local loop; every command
  supports `--json`.
- `zxs screen`, `regs`, `mem`, `disasm`, `step`, `trace`, `break`, `watch`,
  `symbols`, `coverage`, `gfx` — inspection and debugging.
- `zxs preview` — browser playback of the current project, a blank 48K
  machine (`--blank`), or `.z80`/`.tap`/`.tzx`/`.bin` files.
- `zxs state` — `.zxstate` sessions shared between the CLI and the MCP
  server, with `.z80`/`.tap`/`.scr` export.
- `zxs-mcp` — MCP server for Claude, Codex, and other MCP-capable agents.
- `zxasm` — the embedded TypeScript Z80 assembler/disassembler (no native
  dependencies), with optional `sjasmplus` support.
- `zxs snapshot` / `scan` / `xref` — reverse-engineering extras behind
  `ZXS_REVENG=on`.
- `@zx-vibes/cpu`, `@zx-vibes/ula`, `@zx-vibes/machine` — standalone emulator
  cores, pinned by the executable conformance suite in `dna/`.

## CLI tour

The everyday commands:

```bash
zxs doctor                  # check runtime assets and ambiguous PATH installs
zxs build
zxs run --frames 120 --keys "5:P*40" --screenshot screen.png
zxs screen --text           # the 32×24 grid as text — cheap eyes for agents
zxs test tests
zxs verify
zxs preview game.z80        # also .tap/.tzx/.bin, or --blank for a clean 48K
```

Debugging and inspection:

```bash
zxs regs
zxs mem read 0x8000 --len 64
zxs disasm PC --count 12
zxs break add 0x8000
zxs watch add --write 0x5800-0x5aff
zxs step 10
zxs trace --frames 5 --profile
zxs state save session.zxstate
zxs state export --z80 session.z80
zxs gfx screen --out screen.png
zxs gfx attrs --out attrs.png
```

`zxs preview` serves the browser player with a visible build hash; `--watch`
rebuilds and reloads on source changes. If the requested port is busy it
picks the next free one and prints the URL (`--strict-port` to fail
instead). `--detach`, `--list`, and `--stop` manage a background server;
`--stop` only stops the tracked zx-vibes server. Click or press a key once
to enable beeper audio; emulation continues while a hidden tab's rendering
is suspended. `.sna` files are not supported yet and fail with a clear error.

Reverse-engineering commands are gated behind an environment flag:

```bash
ZXS_REVENG=on zxs snapshot info game.z80
ZXS_REVENG=on zxs scan --z80 game.z80 --opcode "ED B0"
ZXS_REVENG=on zxs xref 0x5c00 --z80 game.z80
ZXS_REVENG=on zxs gfx find --z80 game.z80
```

## MCP server and agent setup

`zxs-mcp` exposes structured build, run, screen, inspect, debug, keyboard,
and state tools to MCP-capable agents. `zxs setup --agent <claude|codex>`
does the wiring in one shot:

- **claude** — merges a project `.mcp.json` (registering the `zx-vibes`
  server over the `zxs-mcp` bin) and installs a project skill under
  `.claude/skills/zx-vibes/`: the playbook plus the knowledge pack —
  `reference/` docs generated from the DNA, technique `skills/`, and
  CI-tested `recipes/`.
- **codex** — writes `.codex/config.toml` (project-local, or
  `~/.codex/config.toml` with `--write-global`), `AGENTS.md`, and the same
  knowledge pack under `.codex/zx-vibes/`.

Setup is idempotent and non-destructive: existing files are reported as
`skipped` unless you pass `--force`, and other MCP servers in `.mcp.json`
are left alone. The only content still reported under `deferred` is the
worked-examples pack.

No MCP? No problem — agents can drive the plain CLI; every command supports
`--json`, and most inspection commands can read a session, a `.z80`, or a
raw `--bin` without touching project state.

## Assembler backends

The default backend is `@zx-vibes/asm` — a TypeScript Z80 assembler and
disassembler with no native dependencies, also usable standalone as `zxasm`:

```bash
zxasm assemble src/main.asm -I lib --out-dir build
zxasm disasm build/main.bin --org 0x8000 --count 32
zxasm doctor
```

The embedded backend keeps the name `spectral` in `zxs build --assembler`,
and `spectral-asm` remains a bin alias for `zxasm`, for compatibility with
older configurations.

Need a `sjasmplus`-only feature? Install `sjasmplus` separately and select
it with `zxs build --assembler sjasmplus` or `ZXS_ASSEMBLER=sjasmplus`.

## Try the emulator in your browser

[`examples/`](examples/) contains three self-contained HTML demos of the
`@zx-vibes/machine` core — open
[`examples/index.html`](examples/index.html) straight from disk, no build
step:

- **Basic** — boots the real 48K BASIC ROM; the whole embed is three lines.
- **Medium** — on-screen keyboard, program loading, pause/reset.
- **Full** — `LOAD ""` real `.tap`/`.tzx` tapes (audible loading), `.z80`
  snapshots, sound, Kempston joystick.

See [`examples/README.md`](examples/README.md) to embed the emulator in
your own page.

## Hacking on the toolkit

Clone the monorepo when you want to work on zx-vibes itself:

```bash
git clone https://github.com/Alvaromah/zx-vibes.git
cd zx-vibes
pnpm install
pnpm run verify    # drift checks + conformance + build + typecheck + lint + tests
```

Layout:

```text
dna/                Source-of-truth specs + executable conformance suite
packages/asm/       @zx-vibes/asm assembler/disassembler (zxasm)
packages/cpu/       @zx-vibes/cpu Z80 CPU core
packages/ula/       @zx-vibes/ula ULA video/timing core
packages/machine/   @zx-vibes/machine 48K machine integration
packages/toolkit/   @zx-vibes/toolkit zxs CLI, MCP server, preview player
packages/zx-vibes/  zx-vibes umbrella package and bin shims
examples/           Browser demos of the machine core (prebuilt bundle)
docs/               Task-shaped agent recipes (recipes.md)
starters/           Installable starter projects; their source seeds `zxs new`
scripts/            Drift checks and generators for the root gates
```

`dna/` is the project genome: self-contained normative specs for the Z80,
ULA, Spectrum machine, and file formats (`domain/`), the project-invented
product surface — CLI, MCP tools, `.zxstate`, config schema, assertions,
exit codes (`product/`) — and an executable decider (`conformance/`). An
implementation is correct iff it passes `pnpm run conformance:check`. Every
fixture carries tier and provenance metadata; external suites (FUSE, ZEX)
run through license-aware adapters. See [`dna/README.md`](dna/README.md).

Tips for testing a local clone:

- From the repo root (after `pnpm run build`), `pnpm zxs --help` runs the
  built CLI without the long path.
- To use it from anywhere, alias the built entry point —
  `alias zxs="node /path/to/zx-vibes/packages/toolkit/bin/zxs.js"` — then
  `zxs new` / `zxs verify` in a scratch directory as if installed globally.
- `pnpm run pack` writes tarballs to `.packs/`, but installing only the
  umbrella tarball is not an all-local install: packed `workspace:*`
  dependencies resolve to published versions. Use the alias workflow above,
  or a local registry when testing unpublished package metadata together.
- Iterate on one package with `pnpm --filter @zx-vibes/toolkit test` (same
  for `asm`, `machine`, …).
- The scaffold templates are generated from `starters/` — edit a starter,
  then run `pnpm run gen:scaffold-templates`; `check:drift` fails on any
  mismatch.

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the pull-request checklist.
Keep starter projects compatible with the embedded assembler unless a
change is explicitly about optional `sjasmplus` support.

## Published packages

| Package | Version | What it is |
| --- | ---: | --- |
| `zx-vibes` | `0.6.0` | Umbrella package: `zx-vibes`, `zxs`, `zxs-mcp`, and `zxasm` bins. |
| `@zx-vibes/toolkit` | `0.6.0` | The `zxs` CLI, MCP server, and preview player implementation. |
| `@zx-vibes/asm` | `0.3.0` | `zxasm` assembler/disassembler (+ `spectral-asm` alias). |
| `@zx-vibes/cpu` | `0.1.0` | Z80 CPU core. |
| `@zx-vibes/ula` | `0.1.0` | ULA video/timing core. |
| `@zx-vibes/machine` | `0.1.0` | 48K machine integration (CPU + ULA + tape/IO). |

`zxs --version` reports the toolkit version (the CLI is implemented by
`@zx-vibes/toolkit`); `zxasm --version` reports the assembler version. The
earlier `create-zx-vibes` and `@zx-vibes/emulator` packages are deprecated
on npm — `zxs new` and the emulator core packages replace them.

Each starter under `starters/` pins a `zx-vibes` dev dependency floor of
`^0.6.0`, kept in sync with the umbrella package version by
`pnpm run check:versions`.

## CI and releases

CI runs `check:drift`, `conformance:check`, build, a clean `git diff`,
typecheck, lint, and tests on Ubuntu, macOS, and Windows across Node 20
and 22. Releases use Changesets; the release workflow validates on both
Node versions and only publishes when manually dispatched with
`publish=true`. Root pnpm overrides pin patched floors for `form-data`,
`js-yaml`, and `read-yaml-file`.

## License

The zx-vibes source code is released under the MIT License — see
[`LICENSE`](LICENSE).

The repository includes a ZX Spectrum 48K ROM for emulator use. That ROM is
copyrighted material distributed under the permission described in
[`packages/toolkit/assets/ROM-NOTICE.md`](packages/toolkit/assets/ROM-NOTICE.md);
the same terms are recorded in [`examples/NOTICE`](examples/NOTICE) and
[`dna/conformance/rom/README.md`](dna/conformance/rom/README.md). The ROM
notice is separate from the MIT license that covers the source code.
