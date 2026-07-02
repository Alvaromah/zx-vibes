# MCP Tools (`zxs-mcp`) Product Surface

The `zxs-mcp` Model Context Protocol server: the agent-native surface over the
toolkit runtime (`toolkit-runtime.md`), exposing a curated subset of the `zxs`
CLI (`cli.md`) as MCP tools over stdio. Mined once from the oracle
(`../../../zx-vibes/packages/toolkit/src/mcp/server.ts`); contract-tier behavior
(server identity, tool catalog, input schemas, result shapes) captured exactly.

## Purpose

- [id: MCP-PROD-SCOPE-001] `zxs-mcp` is a Model Context Protocol server that lets an agent build, run, observe, and debug a ZX Spectrum 48K machine through structured tool calls instead of the shell. [provenance: contract]
- [id: MCP-PROD-SCOPE-002] The server exposes a deliberately small, high-level tool set over the same toolkit runtime the CLI uses, so MCP and CLI workflows share one machine session and state format. [provenance: contract]
- [id: MCP-PROD-SCOPE-003] The **CLI is the canonical contract**; `zxs-mcp` is a thin, optional skin justified by exactly two wins — inline `image` content for vision models (`zx_screen`) and a hot in-memory session for interactive debugging (ADR-0027 D2). The CLI closes the one former MCP-only advantage via `screen --base64` (cli.md CLI-PROD-SCREEN-002), so MCP adds no capability the CLI lacks — only ergonomics. The catalog stays at exactly seven tools; it is intentionally not grown. [provenance: decision:ADR-0027]

## Public Behavior — server

- [id: MCP-PROD-SERVER-001] The server is registered with MCP name `zx-vibes` and the package version, and runs over the **stdio** transport via the `@modelcontextprotocol/sdk` server API. [provenance: contract]
- [id: MCP-PROD-SERVER-002] The `zxs-mcp` bin starts the stdio server; on start it advertises its tools: `zx_build`, `zx_run`, `zx_screen`, `zx_inspect`, `zx_debug`, `zx_keys`, `zx_state`. [provenance: contract]
- [id: MCP-PROD-SERVER-003] The tool catalog is exactly those seven tools — no more, no fewer. [provenance: contract]
- [id: MCP-PROD-SERVER-004] The server holds one persistent machine session per process, shared across all tool calls in a connection; breakpoints, watchpoints, and loaded symbols accumulate across calls. This hot in-memory session is MCP's second justification (ADR-0027 D2) — the converse of the CLI's stateless/fresh default. [provenance: contract]

## Inputs — tool catalog

- [id: MCP-PROD-TOOL-BUILD-001] `zx_build` assembles a `.asm` file. Params: `entry` (string, optional — defaults to `zx.config.json` entry), `outDir` (string, optional — default `./build`), and `assembler` (optional escape-hatch backend; defaults to the embedded `@zx-vibes/asm`, ADR-0027 D3). On success it loads SLD symbols for the debugger tools. [provenance: contract]
- [id: MCP-PROD-TOOL-RUN-001] `zx_run` runs the live machine. Params: `bin`/`org`/`pc`, `sna`, `z80`, `tap`, `fresh` (boolean), `frames` (int 0–50000, default 300), `untilPc` (string), `keys` (string schedule), `detectHangs` (boolean, default true). Loading a program boots clean first; otherwise execution continues from current state. [provenance: contract]
- [id: MCP-PROD-TOOL-SCREEN-001] `zx_screen` returns the current display. Param: `scale` (int 1–4, default 2). [provenance: contract]
- [id: MCP-PROD-TOOL-INSPECT-001] `zx_inspect` returns the full register set (including shadow registers) and, optionally, a memory dump. Params: `memAddr` (string), `memLen` (int 1–4096, default 64). [provenance: contract]
- [id: MCP-PROD-TOOL-DEBUG-001] `zx_debug` performs a debugger `action`: `break-add`, `break-rm`, `break-list`, `watch-add`, `watch-rm`, `watch-list`, `step`, `step-over`, `disasm`, `trace`. Params: `spec` (addr/label/`file:line`), `id` (int; omit = all), `type` (`read`|`write`, default write), `range`, `count` (int 1–256), `frames` (int 1–5000, default 5). [provenance: contract]
- [id: MCP-PROD-TOOL-DEBUG-002] `zx_debug` break/watch additions persist for subsequent `zx_run` calls (run with `untilPc`/`frames` to continue to them). [provenance: contract]
- [id: MCP-PROD-TOOL-KEYS-001] `zx_keys` injects keyboard input and runs enough frames for it to register. Params: `keys` (frame:KEY*hold schedule), `typeText` (string), `extraFrames` (int 0–5000, default 10). [provenance: contract]
- [id: MCP-PROD-TOOL-STATE-001] `zx_state` performs a state `action`: `save`, `load`, `reset`, `export-z80`. Param: `file` (string). State files interoperate with the CLI session at `.zxs/state.zxstate`. [provenance: contract]

## Outputs

- [id: MCP-PROD-OUT-001] Tool success results are returned as MCP text content containing a pretty-printed JSON object (the same `{ ok, ... }` shapes the CLI returns), except `zx_screen`. [provenance: contract]
- [id: MCP-PROD-OUT-SCREEN-001] `zx_screen` returns multipart content: an `image` part (base64 PNG, `image/png`) plus a `text` part with the JSON `{ rows, nonBlankCells, borderColor, attrs }` (a 32×24 ROM-font OCR grid). [provenance: contract]
- [id: MCP-PROD-OUT-RUN-001] `zx_run` and `zx_keys` return the run report (`{ ok, status, exit, framesRun, tstatesRun, audio, registers, screen, ... }`) — the same shape as CLI `run` (see `cli.md` CLI-PROD-OUT-RUN-001). [provenance: contract]
- [id: MCP-PROD-OUT-BUILD-001] `zx_build` returns `{ ok, errors[], warnings[], outputs: { bin?, sld?, artifacts? }, symbolsLoaded }`. [provenance: contract]
- [id: MCP-PROD-OUT-INSPECT-001] `zx_inspect` returns `{ registers: { pc, sp, af, bc, de, hl, afPrime, bcPrime, dePrime, hlPrime, ix, iy, i, r, im, iff1, halted }, memory?: { addr, hex, ascii } }`. [provenance: contract]

## Rules

- [id: MCP-PROD-RULE-SUBSET-001] The MCP surface is intentionally a subset of the CLI: build, run, screen, inspect (regs + mem read), debug (break/watch/step/disasm/trace), keys (key/type), and state map to MCP tools. The v2 commands **not** exposed as MCP tools are `verify`, `test`, `preview`, `new`, `init`, `clean`, `gfx`, `symbols`, `coverage`, `doctor`, `setup`, memory-write ops, and `regs set`; the optional reverse-engineering add-on (`snapshot`/`scan`/`xref`/`gfx find`) is out of MCP scope entirely (ADR-0027). [provenance: decision:ADR-0027]
- [id: MCP-PROD-RULE-SANDBOX-001] File-path parameters are resolved relative to the project root and rejected if they escape it (no `..`, no absolute paths). [provenance: contract]
- [id: MCP-PROD-RULE-INTEROP-001] The MCP session and the CLI session share the `.zxs/state.zxstate` format, so an agent can hand a machine between MCP and CLI workflows. [provenance: contract]
- [id: MCP-PROD-RULE-NOEXIT-001] The MCP server reports failures in-band (it does not use process exit codes); the CLI exit-code enumeration does not apply to tool calls. [provenance: contract]

## Edge cases

- [id: MCP-PROD-EDGE-001] `zx_keys` runs with hang detection disabled (input injection is not a hang). [provenance: contract]
- [id: MCP-PROD-EDGE-002] `zx_debug step-over`/`step` and `trace` are internally bounded (a step-over caps its instruction/frame budget; trace caps its frames) so a single debug call always terminates. [provenance: contract]
- [id: MCP-PROD-EDGE-003] `zx_debug` address/label specs require symbols from a prior `zx_build`; raw hex addresses work without symbols. [provenance: contract]

## Errors

- [id: MCP-PROD-ERR-001] Tool errors are returned with `isError: true` and a single text content of the form `error: <message>`; path-escape attempts, bad specs, and runtime failures all use this shape. [provenance: contract]

## Degrees of freedom

- [id: MCP-PROD-FREE-001] Tool `title`/`description` wording, the JSON indentation, and the startup banner text are Incidental — unspecified beyond the tool names, schemas, and result shapes above. [provenance: decision:ADR-0001]
- [id: MCP-PROD-FREE-002] Internal step/trace caps (exact instruction/frame ceilings) are Incidental; only "a debug call terminates" is contract. [provenance: decision:ADR-0001]

## Provenance

- The KEPT MCP contract (the seven-tool catalog, schemas, result shapes, sandbox,
  interop, in-band errors) is `contract`, mined once from the oracle MCP server
  (`src/mcp/server.ts`: tool registrations, the session model, the
  `jsonContent`/`errorContent`/`resolveMcpPath` helpers). The v2 framing —
  CLI-canonical with `screen --base64` parity, the assembler escape-hatch param,
  the hot-session D2 justification, and the re-scoped not-exposed list — is
  `decision:ADR-0027`. Two rows are `decision:ADR-0001` (Incidental). No `UNKNOWN`.
  Cross-references: `cli.md` (CLI surface), `toolkit-runtime.md` (the shared engine).

## Examples

```jsonc
// tool: zx_build  { "entry": "src/main.asm" }
// tool: zx_run    { "frames": 300 }          -> { ok, status, audio:{beeperEdges}, ... }
// tool: zx_debug  { "action": "break-add", "spec": "main_loop" }
// tool: zx_screen { "scale": 2 }             -> [image/png, text(JSON grid)]
// tool: zx_state  { "action": "export-z80", "file": "out.z80" }
```

## Acceptance criteria

- [id: MCP-PROD-AC-CATALOG-001] A regenerated `zxs-mcp` MUST register exactly the seven tools (MCP-PROD-SERVER-003) with the input schemas above; an MCP server test asserts the catalog and each tool's schema. [provenance: contract]
- [id: MCP-PROD-AC-INTEROP-001] A `.zxstate` saved by `zx_state` MUST be loadable by the CLI `zxs state load` and vice versa (MCP-PROD-RULE-INTEROP-001). [provenance: contract]
- [id: MCP-PROD-AC-SANDBOX-001] A tool file-path parameter containing `..` or an absolute path MUST be rejected (MCP-PROD-RULE-SANDBOX-001). [provenance: contract]
