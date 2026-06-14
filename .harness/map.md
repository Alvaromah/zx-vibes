# Area Map

Last updated: 2026-06-14

## Areas

### toolkit

Path: `packages/toolkit/`

Owns:

- `zxs` and `zxs-mcp` command behavior.
- CLI command implementations under `src/cli/commands/`.
- MCP server tools under `src/mcp/`.
- Core machine/run/debug/screen/input state under `src/core/`.
- Recipes, examples, preview behavior, and toolkit package tests.

Typical user language:

- CLI, command, flag, preview, verify, run, screen, debug, inspect.
- MCP, tool, server, stdio, agent integration.
- Recipe, example, golden image, screenshot, runtime loop.

### assembler

Path: `packages/asm/`

Owns:

- Embedded Z80 assembler/disassembler implementation.
- `zxasm` and `spectral-asm` CLI behavior.
- Source parsing, expression handling, macro/conditional support.
- Compatibility with the current toolkit starter/recipe corpus.

Typical user language:

- assembler, disassembler, Z80, instruction, opcode, label.
- sjasmplus compatibility, macro, include, expression, SLD.
- syntax diagnostic, emitted bytes, assembly output.

### emulator

Path: `packages/emulator/`

Owns:

- ZX Spectrum 48K emulator runtime.
- CPU, registers, flags, instruction decoding, memory, ULA/display.
- Tape, snapshot, sound, touch keyboard, ROM loading.
- Browser bundle and Jest test suite.

Typical user language:

- CPU, Z80, instruction, cycle, T-state, register, flag.
- Spectrum, ULA, memory, screen, border, audio, tape, snapshot.
- ROM, browser emulator, display, performance.

### scaffolding

Paths: `packages/create-zx-vibes/`, `starters/`, `packages/toolkit/templates/`

Owns:

- `pnpm create zx-vibes` generator behavior.
- Source starter projects under root `starters/`.
- Copied generator assets under `packages/create-zx-vibes/starters/` and
  `packages/create-zx-vibes/docs/`.
- Toolkit templates under `packages/toolkit/templates/`.

Typical user language:

- create package, scaffold, starter, template, generated project.
- generated `AGENTS.md`/`CLAUDE.md`, `zx.config.json`, smoke test, copied docs.
- asset sync, check assets, project generator.

### reference-docs

Paths: `docs/reference/`, `packages/toolkit/docs/reference/`,
`packages/create-zx-vibes/docs/reference/`

Owns:

- Spectrum reference docs used by agents and generated projects.
- Memory map, screen layout, ROM routines, keyboard, timing, color attributes,
  common bugs, and assembler cheatsheet.
- Keeping copied docs in sync where package builds ship them.

Typical user language:

- docs, reference, guide, cheatsheet.
- generated project knowledge, agent instructions, Spectrum implementation help.

### gallery

Paths: `gallery/`, `packages/toolkit/gallery/`

Owns:

- Static playable gallery HTML/CSS/JS.
- Generated game metadata, screenshots, transcripts, and `.z80` snapshots.
- GitHub Pages deployment source under root `gallery/`.
- Toolkit-shipped gallery assets under `packages/toolkit/gallery/`.

Typical user language:

- gallery, GitHub Pages, playable game, player, screenshot.
- transcript, metadata, browser snapshot, public site.

### distribution

Path: repository root

Owns:

- Root package scripts and pnpm workspace shape.
- CI, Pages, release workflows, changesets, pack/publish flow.
- Umbrella `zx-vibes` package and bin shims.
- Shared repo tooling such as ESLint and `scripts/ensure-shebang.js`.

Typical user language:

- workspace, package manager, lockfile, verify, CI, release.
- changeset, publish, npm, package metadata, bin shim.
- GitHub Actions, Pages deploy, root script.

## Cross-area routing rules

- If a task mentions `zxs`, `zxs-mcp`, verification, preview, run/debug/screen
  commands, recipes, or examples, start with `toolkit`.
- If a task mentions Z80 parsing, emitted bytes, labels, macros, expressions,
  disassembly, or sjasmplus compatibility, start with `assembler`.
- If a task mentions CPU behavior, Spectrum hardware, screen rendering, tape,
  snapshot, ROM, sound, or emulator browser behavior, start with `emulator`.
- If a task mentions `pnpm create zx-vibes`, starter projects, generated
  project layout, or copied template assets, include `scaffolding`.
- If a task changes root `docs/reference/`, include `reference-docs` and check
  generated/copied docs where relevant.
- If a task changes public game artifacts or GitHub Pages output, include
  `gallery`.
- If a task changes root scripts, package metadata, release, CI, changesets,
  lockfile, or the umbrella package, include `distribution`.
- If a change crosses package boundaries, include every package consumer that
  imports or packages the changed behavior.
- If the task mentions recently added functionality, check `recent.md` and
  related task files before deciding scope.
- If one area needs data or contracts from another area, include both areas in
  the task context.
- If scope is ambiguous but low-risk, proceed with the most likely area and
  record the assumption.
- If scope is ambiguous and the wrong choice could cause significant rework,
  ask before changing code.
