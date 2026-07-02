# Toolkit Runtime Product Surface

The orchestration engine under the `zxs` CLI (`cli.md`) and the MCP server
(`mcp-tools.md`): the session machine, build orchestration, the run loop, the
verify pipeline, the preview server, and the declarative test runner. Mined once
from the oracle (`packages/toolkit/src/cli/` in the legacy oracle repo —
`session.ts`, `machine-source.ts`, `config.ts`, `commands/{run,verify,preview,
test-cmd}.ts`). This spec fixes the runtime *contract*; the command-surface view
is in `cli.md`, the project-config schema in `config-schema.md`.

## Purpose

- [id: RT-PROD-SCOPE-001] The toolkit runtime is the shared engine that boots and drives a ZX Spectrum 48K machine, orchestrates the assembler, and exposes build/run/observe/verify services consumed identically by the `zxs` CLI and the `zxs-mcp` server. [provenance: contract]
- [id: RT-PROD-SCOPE-002] The runtime is deterministic for a fixed input (source, frame budget, input schedule), which is what makes normalized CLI-snapshot conformance fixtures possible. [provenance: contract]

## Public Behavior — runtime services

- [id: RT-PROD-SESSION-001] The generative loop is **stateless/fresh by default** — the runtime does not implicitly resume any on-disk session (ADR-0027). A persistent session machine (serialized to `.zxs/state.zxstate`) is an **opt-in** for interactive debugging, selected by an explicit `--state` request; only then do observation/execution services resume and persist it. [provenance: decision:ADR-0027]
- [id: RT-PROD-SESSION-002] A machine is sourced from exactly one of: a **fresh boot** (the default — a cached clean 48K ROM machine), a `.z80` snapshot, a `.sna` snapshot, a `.tap` image, a raw binary loaded at a chosen origin, or an opt-in resumed session (`--state`). [provenance: decision:ADR-0027]
- [id: RT-PROD-SESSION-003] When a persistent session is active (`--state`), a mutating service persists it afterward unless the caller requests read-only/no-save; under the default stateless loop there is nothing to persist. [provenance: decision:ADR-0027]
- [id: RT-PROD-BUILD-001] The build service assembles the configured entry with the embedded `@zx-vibes/asm` — the **sole** assembler (ADR-0027 D3) — into the output directory, producing the binary plus SLD symbol/debug data; an external `sjasmplus` backend is a documented escape hatch only. It can additionally emit loadable `.tap`/`.scr`/`.z80` artifacts (the formats service, RT-PROD-FORMATS-001). [provenance: decision:ADR-0027]

## Run loop

- [id: RT-PROD-RUN-001] The run loop executes the machine for a bounded frame budget (default 300 frames; 50 frames ≈ 1 emulated second). [provenance: contract]
- [id: RT-PROD-RUN-002] The run loop honors stop conditions — target PC, breakpoints, read/write watchpoints, and memory-change watches — terminating early with a `status` of `breakpoint` or `watchpoint` and reporting the stop PC. There is **one** watchpoint model (ADR-0027), fed identically by the ephemeral `run --watch-*` flags and the persistent `watch add` store. [provenance: contract]
- [id: RT-PROD-RUN-003] A hang watchdog monitors execution; on a detected hang/crash the run reports `status: "hang"` and the run service maps it to exit code 2 (HANG). [provenance: contract]
- [id: RT-PROD-RUN-004] The run loop applies a scheduled-key plan **and** a scheduled Kempston-`joy` plan (ADR-0027; port `0x1F` `000FUDLR`, peripherals.md) relative to the run's start frame and reports the realized schedule. [provenance: contract]
- [id: RT-PROD-RUN-005] The run loop analyzes audio activity and reports `audio.beeperEdges` as an integer count (≥ 0) of port-`0xFE` bit-4 transitions, alongside port-write counts and tone analysis. [provenance: contract]
- [id: RT-PROD-RUN-006] `--until-break` raises the effective frame budget (≥ 3000 frames) so a stop condition has time to fire within one run. [provenance: contract]

## Verify pipeline

- [id: RT-PROD-VERIFY-001] The verify pipeline runs, in order: (1) load project config (entry, outDir, org) — failing as a user error if required config is missing; (2) build; (3) if the build succeeded, **invoke the real `run` service** (fresh boot, load at the configured origin, 300 frames under the hang watchdog) and use its full report + a captured screenshot — not a trimmed inline re-implementation (ADR-0027); (4) if a `tests/` directory exists, run the test suite. [provenance: contract]
- [id: RT-PROD-VERIFY-002] The verify result `ok` is true iff `build.ok` AND `run.ok` AND (no tests ran OR `tests.failed === 0`); the service exits 0 when `ok` and 1 otherwise. [provenance: contract]
- [id: RT-PROD-VERIFY-003] Verify is the single project acceptance gate: any failing stage makes the whole pipeline fail (non-zero exit). [provenance: contract]

## Preview server

- [id: RT-PROD-PREVIEW-001] The preview server builds the project and serves the **bundled core** browser player over HTTP bound to `127.0.0.1` — the single optional human-review handoff (ADR-0027 D4: the player stays in the toolkit, not relocated to the gallery). One `preview` verb collapses the legacy `boot` (blank screen) and `play` (load a file) modes. [provenance: decision:ADR-0027]
- [id: RT-PROD-PREVIEW-002] Port selection tries the requested port (default 5173) and, unless `--strict-port`, falls back to the next free port up to a bounded number of attempts; `--strict-port` fails instead of falling back. [provenance: contract]
- [id: RT-PROD-PREVIEW-003] A detached preview server records `{ pid, port, url, token, owner }` in `.zxs/preview-server.json`; the `owner` marks it as a zx-vibes preview server and the `token` is a per-server UUID. [provenance: contract]
- [id: RT-PROD-PREVIEW-004] `preview --stop` stops a recorded server only after verifying it owns the recorded token (via the server's control endpoint); a missing/foreign token is a user error (exit 1). [provenance: contract]
- [id: RT-PROD-PREVIEW-005] `preview --watch` polls source for changes (~500 ms) and pushes build/reload events to connected clients over a server-sent-events stream. [provenance: contract]

## Test runner

- [id: RT-PROD-TEST-001] The test runner loads declarative specs (`test.json` / `*.test.json`), runs each against a fresh/seeded machine, and reports `{ total, passed, failed, results[] }`. [provenance: contract]
- [id: RT-PROD-TEST-002] The v2 assertion vocabulary (16 types — full schema in `recipes-and-assertions.md`) is: `status`, `haltSynced`, `screenChanged`, `cellsNonBlank`, `attrNonBlank`, `screenIncludes`, `memEquals`, `regEquals`, `pixelAt`, `borderColor`, `beeperEdges`, `portFEWrites`, plus `at`, `memInRange`, `memDelta`, `screenDiff`. The legacy `coloredCells` alias is dropped (ADR-0027). [provenance: decision:ADR-0027]
- [id: RT-PROD-TEST-003] Numeric assertions take `{min?, max?}` bounds; equality assertions take `{equals}` or a typed value; the suite passes iff every spec passes. [provenance: contract]
- [id: RT-PROD-TEST-004] To serve the temporal/delta assertions, the runner captures — in one run — the start-of-run referenced memory and a per-checkpoint snapshot at each `at`-frame, so `at`/`memDelta` evaluate without re-running (ADR-0027). [provenance: decision:ADR-0027]

## Observe & formats services (v2)

- [id: RT-PROD-OBSERVE-001] The observe services expose, over the same machine source-selection, the cheap-eyes + debug cluster — screen (`text` OCR / `png` / `base64` data-URI), regs, mem read/dump, disasm, step, trace, break/watch — plus the v2 additions: `symbols` (dump the SLD label→addr map as JSON), `coverage` (which code was reached over a run), and `screenDiff` (post-run framebuffer vs a golden PNG). There is **one** screenshot encoder shared by `screen`, `run --screenshot`, and `gfx` (ADR-0027). [provenance: decision:ADR-0027]
- [id: RT-PROD-FORMATS-001] The formats service builds loadable `.tap`/`.scr`/`.z80` artifacts from a built binary or the live machine via the `@zx-vibes/machine` codecs (`file-formats.md`); `preview <file>` serves any of these in the bundled core player. [provenance: decision:ADR-0027]

## Inputs

- [id: RT-PROD-CONFIG-001] The runtime reads project configuration from `zx.config.json` — at minimum the entry source, output directory, and load origin; the assembler defaults to the embedded `@zx-vibes/asm` (an external backend is an escape-hatch field only). Full schema in `config-schema.md`. [provenance: decision:ADR-0027]
- [id: RT-PROD-CONFIG-002] Source-selection, frame budget, stop conditions, and input schedule are passed per-invocation (the CLI/MCP surfaces map their flags/parameters onto these). [provenance: contract]

## Outputs

- [id: RT-PROD-OUT-001] Run/verify/test/observe services return the `{ ok, stage, ... }` JSON envelopes specified per-command in `cli.md`; the runtime is their source of truth. [provenance: contract]
- [id: RT-PROD-OUT-002] The screenshot/PNG, WAV, and binary-dump artifacts are written to caller-specified paths; their byte content is a function of the deterministic run. [provenance: contract]

## Rules

- [id: RT-PROD-RULE-DET-001] Given identical source, frame budget, and input schedule, repeated runs produce identical machine state and identical audio/screen summaries (modulo normalized fields: paths, ports, timestamps, durations). [provenance: contract]
- [id: RT-PROD-RULE-ROMCACHE-001] Fresh boots reuse a cached clean-ROM machine so boot is deterministic and cheap across invocations. [provenance: contract]
- [id: RT-PROD-RULE-EXIT-001] The runtime maps outcomes to the CLI exit-code enumeration (0 OK / 1 USER_ERROR / 2 HANG / 3 ENV_ERROR) defined in `cli.md`. [provenance: contract]

## Edge cases

- [id: RT-PROD-EDGE-001] A run that never reaches a configured stop condition ends at the frame budget with `status: "ok"`. [provenance: contract]
- [id: RT-PROD-EDGE-002] `verify` with no `tests/` directory passes on `build.ok && run.ok` alone (tests are optional, not required). [provenance: contract]
- [id: RT-PROD-EDGE-003] Two preview servers requesting the same port coexist via port fallback (unless `--strict-port`), each with its own ownership token. [provenance: contract]

## Errors

- [id: RT-PROD-ERR-001] Missing required project config, an unbuildable entry, or an unavailable strict port are user errors (exit 1); a missing/invalid toolchain surfaces via `doctor` as an environment error (exit 3). [provenance: contract]

## Degrees of freedom

- [id: RT-PROD-FREE-001] The on-disk byte layout of `.zxs/state.zxstate` and `.zxs/preview-server.json`, the exact port-fallback attempt count, the SSE event channel name, and internal scheduling are Incidental — unspecified beyond the observable contract above. [provenance: decision:ADR-0001]
- [id: RT-PROD-FREE-002] Hang-watchdog heuristics (how a hang is detected) are Incidental; only the observable outcome (`status: "hang"` → exit 2) is contract. [provenance: decision:ADR-0001]

## Provenance

- The KEPT runtime contract is `contract`, mined once from the oracle toolkit
  runtime (`src/cli/session.ts`, `machine-source.ts`, `config.ts`,
  `commands/{run,verify,preview,test-cmd}.ts`). The v2 re-scope — the stateless/
  fresh-default session model, `verify` composing the real `run` report, the single
  embedded assembler, the Kempston `joy` plan, the v2 assertion set + checkpoint
  capture, the bundled-core `preview`, and the new observe (`symbols`/`coverage`/
  `screenDiff`/base64) + formats (`.tap`/`.scr`/`.z80`) services — is
  `decision:ADR-0027`. Two rows are `decision:ADR-0001` (Incidental). No `UNKNOWN`.
  Cross-references: `cli.md` (command surface), `mcp-tools.md` (MCP surface),
  `config-schema.md` (project config), `recipes-and-assertions.md` (assertions),
  `peripherals.md` (Kempston), `file-formats.md` (codecs).

## Examples

```bash
zxs verify --json     # load config -> build -> run 300f -> screenshot -> tests
zxs run --until-pc 0x8003 --frames 600 --json   # stops early at status:"breakpoint"
zxs preview --detach --json && zxs preview --stop --json   # owned start/stop
```

## Acceptance criteria

- [id: RT-PROD-AC-VERIFY-001] The verify pass condition (RT-PROD-VERIFY-002) backs coverage row `CLI-EXIT-VERIFY-001` (fixture `conformance/cli/verify-exit.json`). [provenance: contract]
- [id: RT-PROD-AC-BEEPER-001] The run-loop audio contract (RT-PROD-RUN-005) backs coverage row `RUN-BEEPER-001` (fixture `conformance/cli/run-beeper-edges.json`). [provenance: contract]
- [id: RT-PROD-AC-DET-001] Runtime determinism (RT-PROD-RULE-DET-001) is the precondition any `conformance/cli/` snapshot fixture relies on for byte-stable normalized comparison. [provenance: contract]
