# @zx-vibes/toolkit

The `zxs` CLI: an agent-facing, JSON-first build/run/observe/verify toolkit over
the `@zx-vibes` assembler and emulator cores, for ZX Spectrum **48K** projects.

Current package version in this repository: `0.4.0`.

> **Regeneration status — core surface complete (through Slice 11a).**
> This package is regenerated from its DNA product specs
> (`dna/product/cli.md`, `errors.md`, `config-schema.md`, `toolkit-runtime.md`).
> Every core verb is implemented; no deferred stubs remain in the command
> registry. The rich starter templates (`create-zx-vibes`, W5) and the
> generated knowledge pack for `setup` are the main deferred slices.

## What's implemented

- **Output envelope + exit codes** (`src/output/envelope.ts`) — the `{ ok, stage, … }`
  success/error envelope, the `0=OK / 1=USER_ERROR / 2=HANG / 3=ENV_ERROR` exit-code
  enum, and the single place that prints an envelope (human vs `--json`).
- **Config service** (`src/config/config.ts`) — loads `zx.config.json` and resolves
  each value by **CLI flag > env > config > default** (`org` `0x8000`, `assembler`
  `builtin`, `outDir` `build`; `spectral` → `builtin`).
- **Sessions** (`src/runtime/session.ts`) — a fresh-by-default clean-ROM boot
  over `@zx-vibes/machine`, plus the opt-in persistent `.zxstate` session
  (`--state`) shared with the MCP server.
- **The full CLI** (`bin/zxs.js` → `src/cli.ts`, registry in `src/registry.ts`) —
  `build`, `run`, `test`, `verify`, `screen`, `regs`, `mem`, `disasm`, `step`,
  `trace`, `symbols`, `coverage`, `key`, `type`, `state`, `break`, `watch`,
  `preview` (project, `--blank`, or `.z80`/`.tap`/`.tzx`/`.bin` files, with
  `--watch` live reload and detached lifecycle), `new`, `init`, `clean`,
  `doctor`, `setup`, `gfx`, and `version`.
- **MCP server** (`bin/zxs-mcp.js` → `src/mcp.ts`) — structured build, run,
  screen, inspect, debug, keyboard, and state tools over the same runtime.
- **Reverse-engineering add-on** (`src/reveng/`) — `snapshot`, `scan`, `xref`,
  and extended `gfx` subcommands, mounted when `ZXS_REVENG` is enabled.
- **Scaffold** (`src/scaffold/scaffold.ts`) — `zxs new`/`init` emit a minimal
  verify-passing project; the rich `game`/`platformer` starter templates belong
  to the future `create-zx-vibes` slice (W5 boundary).

## The `.zxstate` session format

The opt-in **persistent session** (`zxs state`, `run --state`, and any mutating
command with `--state`) is serialized to a `.zxstate` file — by default
`.zxs/state.zxstate` (`cli.md` CLI-PROD-CONV-SOURCE-001). It is the **interop
contract** the MCP server (`zxs-mcp`) and the CLI share so an agent can hand a
machine between MCP and CLI workflows (`mcp-tools.md` MCP-PROD-RULE-INTEROP-001 /
MCP-PROD-AC-INTEROP-001).

**The on-disk byte layout is Incidental** — `file-formats.md` FF-ZXSTATE-001 and
`cli.md` CLI-PROD-FREE-002 declare it the implementer's choice *unless a consumer
needs it pinned*, in which case the path is to **author `dna/product/zxstate-format.md`
and conform** (a flagged W4 follow-up, not a silent decision). No conformance
fixture pins it today.

The format is a self-describing JSON envelope wrapping the machine's own `.z80`
snapshot codec (`@zx-vibes/machine` `writeZ80`/`readZ80`):

```jsonc
{
  "emulatorId": "zx-vibes",        // interop identity — a foreign id is rejected, not mis-loaded
  "format": "zxstate",
  "version": 1,                     // envelope schema version
  "machine": {
    "z80": "<base64 of writeZ80({ registers, memory, border })>",  // regs + 48K RAM + border
    "halted": false,                // NOT carried by .z80 — preserved here
    "memptr": 0                     // the WZ register, likewise
  },
  "debug": {                        // the break/watch store rides along (MCP handoff)
    "breakpoints": [ { "id": 1, "addr": 32771, "spec": "0x8003" } ],
    "watchpoints": [ { "id": 1, "type": "write", "from": 36864, "to": 36865, "spec": "0x9000-0x9001" } ],
    "nextBreakId": 2, "nextWatchId": 2
  }
}
```

- The machine snapshot reuses the core `.z80` codec (`writeZ80`, version 3), so
  registers + 48K RAM + border round-trip through a format the MCP server reconstructs
  identically. The fixed 48K **ROM** (0x0000–0x3FFF) is *implied* by the `.z80` format
  (not stored); it is re-mapped on load — the standard snapshot-load semantics.
- `state export --z80 <file>` is a separate path: CLI-PROD-STATE-001 mandates a `.z80`
  **version 1** snapshot, which the toolkit writes itself (the core `writeZ80` emits only
  v3). `--tap`/`--scr` export the same machine through the real formats emitters:
  `--tap` wraps the session RAM as a loadable CODE tape and `--scr` writes the
  6912-byte screen image.
- **Breakpoints / watchpoints** also live in a standalone **live store**,
  `.zxs/debug.json`, so `break`/`watch` additions survive across stateless `zxs`
  invocations and feed `run --until-break`/`--until-watch` (the one watchpoint model).
  A `.zxstate` embeds a *copy* of that store; `state load` republishes it to the live
  store so a session handed from MCP carries its breakpoints.
- **Read watchpoints** cannot be observed by the cores (no memory-read bus hook), so
  `watch add --read` and `run --watch-read` **fail loud** (ENV_ERROR) rather than
  silently no-op (tracked gap W4-GAP-01).

## Bins

- `zxs` / `zx-vibes` — the CLI (identical).
- `zxs-mcp` — the MCP stdio server.

## Scripts

`build` (tsup) · `typecheck` (`tsc --noEmit`) · `lint` (eslint) · `test`
(`vitest run`) · `check:docs` (drift placeholder).

## License

MIT. See `LICENSE`. The package ships a ZX Spectrum 48K ROM (`assets/48k.rom`)
under the separate Amstrad redistribution notice in `assets/ROM-NOTICE.md`.
