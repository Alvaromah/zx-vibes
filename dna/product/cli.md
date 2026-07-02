# Toolkit CLI (`zxs`) Product Surface — v2

The `zxs` command-line tool: the agent-facing orchestration layer over the
reconstructed assembler and emulator cores (build, run, observe, debug, verify,
preview, scaffold). **v2 is a product redesign** ratified by `decisions.md`
ADR-0027 — *a knowledge pack + a tight, idempotent, JSON-first loop* re-based on
`@zx-vibes/{cpu,ula,machine,asm}`. The surface KEPT from the legacy oracle
(`packages/toolkit`, `src/cli/` in the legacy oracle repo) stays `contract`; the v2
re-scope (stateless-default, the verb collapses, the additions, the demotions)
is `decision:ADR-0027`. The clean-room-implementer rule (read `dna/` only) applies
to the regeneration slices, not to this re-author phase.

## Purpose

- [id: CLI-PROD-SCOPE-001] `@zx-vibes/toolkit` provides the `zxs` CLI that orchestrates the embedded `@zx-vibes/asm` assembler and the `@zx-vibes/machine` emulator into a single build/run/observe/verify workflow for ZX Spectrum **48K** projects (128K + AY is out of scope for v2, ADR-0027 D1). [provenance: contract]
- [id: CLI-PROD-SCOPE-002] The CLI is designed for autonomous agents and humans alike: every command supports a machine-readable `--json` mode and a deterministic, normalizable output envelope. [provenance: contract]
- [id: CLI-PROD-SCOPE-003] The generative loop (`build`/`run`/`verify`/`test`) is **stateless/fresh by default**: a command is a pure function of (source, frame budget, scheduled input) and does not implicitly resume any on-disk machine state. An optional persistent session — successive commands (`run`, `step`, `mem`, `regs`, `screen`) observing and mutating one machine — is opt-in via `--state <file>` for interactive debugging. [provenance: decision:ADR-0027]

## Public Behavior

- [id: CLI-PROD-PKG-001] The package name is `@zx-vibes/toolkit`; it is published as an ESM package requiring Node.js 20 or newer. [provenance: contract]
- [id: CLI-PROD-PKG-002] The package exposes `zxs` as the canonical CLI bin and `zx-vibes` as an identical alias bin (both resolve to the same CLI entry). [provenance: contract]
- [id: CLI-PROD-PKG-003] The package exposes `zxs-mcp` as a separate bin that starts the thin, optional MCP stdio server (specified in `mcp-tools.md`, not here); the CLI is the canonical contract (ADR-0027 D2). [provenance: contract]
- [id: CLI-PROD-PKG-004] Argument parsing is Commander-style: a top-level `zxs <command> [subcommand] [args] [flags]` dispatch, with sub-commanded groups for `mem`, `regs`, `state`, `break`, `watch`, `symbols`, and `gfx`. [provenance: contract]
- [id: CLI-PROD-CMDSET-001] The v2 core top-level command set is exactly: `build`, `run`, `verify`, `test`, `preview`, `screen`, `key`, `type`, `mem`, `regs`, `state`, `break`, `watch`, `step`, `disasm`, `trace`, `symbols`, `coverage`, `gfx`, `new`, `init`, `clean`, `doctor`, `setup`. [provenance: decision:ADR-0027]
- [id: CLI-PROD-CMDSET-002] Relative to legacy, v2 **removes** `bench` (diagnostic only), **folds** `boot`/`play` into one `preview` verb, and **demotes** `snapshot`, `scan`, `xref`, and the reverse-engineering `gfx` sub-commands (`find`, `blit-linear`) to the optional add-on (CLI-PROD-REVENG-001, ADR-0027 D5). The dropped scope is recorded here, not silently absent (C5). [provenance: decision:ADR-0027]

## Global conventions

- [id: CLI-PROD-CONV-JSON-001] Every command accepts `--json`; in JSON mode it prints a single JSON object and prints no human-readable text. [provenance: contract]
- [id: CLI-PROD-CONV-JSON-002] Every JSON result object carries a top-level `ok` boolean and a `stage` string naming the command (e.g. `"build"`, `"run"`, `"verify"`). [provenance: contract]
- [id: CLI-PROD-CONV-JSON-003] Success result objects frequently include a `next` array of suggested follow-up command strings; its wording is incidental (not a contract). [provenance: contract]
- [id: CLI-PROD-CONV-ADDR-001] Address and numeric arguments accept `0x8000`, `$8000`, `8000h`, and decimal `32768` forms interchangeably. [provenance: contract]
- [id: CLI-PROD-CONV-RANGE-001] Range arguments use a `from-to` form (e.g. `0x4000-0x5aff`), inclusive of both endpoints. [provenance: contract]
- [id: CLI-PROD-CONV-SOURCE-001] Observation commands (screen, regs, mem, disasm, gfx, step, trace, run, symbols, coverage) select their machine from one of: a `--z80 <file>`, a `--sna <file>`, a raw `--bin <file>` loaded at `--org <addr>` (default `0x8000`), or — only when explicitly requested — an opt-in persistent session via `--state <file>` (default session path `.zxs/state.zxstate`). With no source given, the machine is booted fresh (ADR-0027). [provenance: decision:ADR-0027]

### Exit codes

- [id: CLI-PROD-EXIT-001] Exit code `0` (OK) means the command succeeded. [provenance: contract]
- [id: CLI-PROD-EXIT-002] Exit code `1` (USER_ERROR) means a user-facing failure: build/assemble errors, invalid arguments, missing configuration, a failing `test`/`verify`, or a failed operation. [provenance: contract]
- [id: CLI-PROD-EXIT-003] Exit code `2` (HANG) means `run` detected a hang/crash via the watchdog. [provenance: contract]
- [id: CLI-PROD-EXIT-004] Exit code `3` (ENV_ERROR) means an environment/toolchain failure, raised by `doctor` when any check fails. [provenance: contract]

## Inputs — commands, arguments, flags

### build

- [id: CLI-PROD-BUILD-001] `zxs build [file]` assembles an entry `.asm` file (defaulting to the `entry` from `zx.config.json`) to a binary plus symbol/debug data (the SLD label/line map). [provenance: contract]
- [id: CLI-PROD-BUILD-002] `build` accepts `--out-dir <dir>` (default `build`) and `--json`. The embedded `@zx-vibes/asm` is the **sole** assembler (ADR-0027 D3); path-sandbox confinement of includes/reads (reject `..`, absolute, UNC) is always on. [provenance: decision:ADR-0027]
- [id: CLI-PROD-BUILD-003] `build` can emit loadable artifacts via `--tap`, `--scr`, and `--z80` (optionally with a path; default beside the binary). These use the `@zx-vibes/machine` codecs pinned in `file-formats.md` (`.tap` W10.6, `.scr` W10.4, `.z80` snapshot). [provenance: decision:ADR-0027]
- [id: CLI-PROD-BUILD-004] `--assembler <name>` exists only as a documented escape hatch for an alternative external backend (e.g. `sjasmplus`); it is not part of the default story and not required for any conformance behavior (ADR-0027 D3). [provenance: decision:ADR-0027]

### run

- [id: CLI-PROD-RUN-001] `zxs run` executes the emulator **fresh by default** — a pure function of (source, frame budget, scheduled input) — booting from a `--bin`/`--sna`/`--z80`/`--tap` source or the configured entry. On-disk session resume is opt-in via `--state <file>` (ADR-0027 stateless-default). [provenance: decision:ADR-0027]
- [id: CLI-PROD-RUN-002] `run` accepts a frame budget `--frames <n>` (default `300`; 50 frames ≈ 1 second). [provenance: contract]
- [id: CLI-PROD-RUN-003] `run` supports stop conditions `--until-pc <addr>`, `--until-break`, `--until-watch`, `--until-write <range>`, `--until-change <addr>`, and temporary watchpoints `--watch-read <range>` / `--watch-write <range>`. These feed the **one** watchpoint model shared with `watch add` (ADR-0027 — no separate ephemeral vs persistent model). [provenance: contract]
- [id: CLI-PROD-RUN-004] `run` supports scheduled keyboard input via `--keys <spec>` (the canonical input form, e.g. `"60:O*30,120:SPACE*5"`), output capture via `--screenshot <file>` / `--wav <file>`, and session control via `--state <file>` (opt-in resume) and `--no-save` / `--read-only` (when a session is active). [provenance: contract]
- [id: CLI-PROD-RUN-005] `run` supports scheduled **Kempston joystick** input via `--joy <spec>` using the same `frame:value*hold` schedule as `--keys`, where the value is any subset of `UDLR` + `F` (fire) mapping to the active-high `000FUDLR` byte on port `0x1F` (peripherals.md `JOY-KEMPSTON-*`, W10.13). [provenance: decision:ADR-0027]

### verify

- [id: CLI-PROD-VERIFY-001] `zxs verify` runs the project acceptance pipeline: build → run (300 frames, fresh, with hang watchdog) → screenshot → run the `tests/` suite if present. It **composes the real `run` report** (the same JSON shape as `run --json`), not a trimmed inline re-implementation (ADR-0027). [provenance: contract]
- [id: CLI-PROD-VERIFY-002] `verify` accepts `--screenshot <file>` (default `.zxs/verify-screen.png`) and `--json`. [provenance: contract]

### preview

- [id: CLI-PROD-PREVIEW-001] `zxs preview` builds the project and serves it in the bundled browser player — the single optional **human-review handoff** (the headless agent loop never needs it). The player stays a first-class **core** toolkit capability (ADR-0027 D4 override); it is not relocated to the gallery product. [provenance: decision:ADR-0027]
- [id: CLI-PROD-PREVIEW-002] `preview` collapses the legacy `preview`/`boot`/`play` trio into one verb with modes: the default serves the built project; `--blank` serves a clean 48K boot screen (legacy `boot`); `<file>` serves a `.z80`/`.sna`/`.tap`/`.tzx` image (legacy `play`). Flags: `--port <n>` (default `5173`), `--strict-port`, `--watch`, `--detach`, `--list`, `--stop`, `--json`. [provenance: decision:ADR-0027]

### Observation — screen, regs, mem, disasm, step, trace, symbols, coverage

- [id: CLI-PROD-SCREEN-001] `zxs screen` reports the current machine screen without executing; `--text` (ROM-font OCR, default on), `--attrs`, `--png <file>` (the one screenshot encoder), source-selection flags, `--json`. [provenance: contract]
- [id: CLI-PROD-SCREEN-002] `zxs screen --base64` emits the PNG screenshot inline as a base64 data-URI in the JSON envelope (the one MCP-only gap closed at the CLI; ADR-0027 D2). [provenance: decision:ADR-0027]
- [id: CLI-PROD-SCREEN-003] `zxs screen --diff <baseline.png>` compares the current screen against a golden image and reports a visual-regression result (`--update-baseline` writes/refreshes it); the metric and storage match the `screenDiff` assertion in `recipes-and-assertions.md`. [provenance: decision:ADR-0027]
- [id: CLI-PROD-REGS-001] `zxs regs` reports the CPU registers (main + alternate set, IX/IY, I, R, IM, IFF1, halted, decoded flags); `zxs regs set <reg> <value>` writes one register into the session. [provenance: contract]
- [id: CLI-PROD-MEM-001] `zxs mem read <addr> [--len n]`, `mem dump --range <from-to> --out <file>`, `mem load <addr> --bin <file>`, and `mem write <addr> <hexBytes>` read and mutate session memory. [provenance: contract]
- [id: CLI-PROD-DISASM-001] `zxs disasm <spec>` disassembles from an address, label, `file.asm:line`, or `PC`; `--count <n>` (default `16`) and source-selection flags. [provenance: contract]
- [id: CLI-PROD-STEP-001] `zxs step [n]` executes `n` instructions (default `1`) in the session; `--over` steps over `CALL`/`RST`. [provenance: contract]
- [id: CLI-PROD-TRACE-001] `zxs trace` runs with instruction tracing; `--frames <n>` (default `5`), `--top <n>` (default `10`), `--last <n>` (default `50`), `--out <file>`, `--no-save`. [provenance: contract]
- [id: CLI-PROD-SYMBOLS-001] `zxs symbols` dumps the SLD symbol table from the last build as JSON — `{ ok, stage: "symbols", symbols: [{ name, addr, kind }] }` — so an agent can **enumerate** labels (not just resolve a known one); `symbols get <name>` reports one entry; source-selection picks the SLD/build. [provenance: decision:ADR-0027]
- [id: CLI-PROD-COVERAGE-001] `zxs coverage` runs the program (frame budget + scheduled input like `run`) and reports which code was reached — `{ ok, stage: "coverage", executed: [addr…], routines: [{ name, addr, reached }], reachedCount, totalSymbols }` — answering "was routine X executed?" (the gap `trace` hot-spots cannot fill). [provenance: decision:ADR-0027]

### Input — key, type

- [id: CLI-PROD-INPUT-001] `zxs key <key>` presses one key (A–Z, 0–9, ENTER, SPACE, CAPS_SHIFT, SYMBOL_SHIFT) for `--hold <frames>` (default `3`); thin sugar over the canonical scheduled `--keys` model. [provenance: contract]
- [id: CLI-PROD-INPUT-002] `zxs type <text>` types a string through the keyboard matrix at `--frames-per-key <n>` (default `3`); thin sugar over `--keys`. [provenance: contract]

### State & debug — state, break, watch

- [id: CLI-PROD-STATE-001] `zxs state` manages the opt-in persistent session: `save <file>`, `load <file>`, `reset`, and `export --z80 <file>` (exports the session as a `.z80` v1 snapshot; `--tap`/`--scr` export the same machine in those formats). [provenance: contract]
- [id: CLI-PROD-BREAK-001] `zxs break` manages breakpoints: `add <spec>` (label / `file.asm:line` / address), `list`, and `rm <id|all>`. [provenance: contract]
- [id: CLI-PROD-WATCH-001] `zxs watch` manages memory watchpoints (the one watchpoint model): `add --read <range>|--write <range>`, `list`, `rm <id|all>`, and `clear`. [provenance: contract]

### gfx (forward graphics decode)

- [id: CLI-PROD-GFX-001] `zxs gfx` decodes the agent's **own** Spectrum graphics data to PNG (a "cheap eyes" view of sprite/tile bytes), with core sub-commands `attrs` and `linear`; each requires `--out <png>`. `gfx screen` is subsumed by `screen --png` (the one screenshot path). [provenance: decision:ADR-0027]
- [id: CLI-PROD-GFX-002] `gfx linear` decodes a linear bitmap region (`--addr`, `--width`, `--height`) and folds the legacy `gfx sheet` / `gfx font` into named layout **presets** (`--preset sheet|font`), since they shared one handler (ADR-0027). [provenance: decision:ADR-0027]
- [id: CLI-PROD-GFX-003] The reverse-engineering `gfx` sub-commands (`find`, `blit-linear`) — which inspect *third-party* games — are demoted to the optional add-on (CLI-PROD-REVENG-001, ADR-0027 D5), not part of core `gfx`. [provenance: decision:ADR-0027]

### Project & environment — new, init, clean, doctor, setup

- [id: CLI-PROD-NEW-001] `zxs new <name>` scaffolds a fresh project from `--template <game|platformer>` (default `game`); `--no-install` skips dependency install; fails if the target directory exists. (Generated-project contract is specified in `scaffolding.md`.) [provenance: contract]
- [id: CLI-PROD-INIT-001] `zxs init` scaffolds the toolkit contract (`zx.config.json`, `tests/`, the generated `AGENTS.md`/`CLAUDE.md` playbook) into an **existing** directory without failing when files are present; `--force` overwrites managed files. It onboards an agent already inside a repo (the gap `new` cannot fill). [provenance: decision:ADR-0027]
- [id: CLI-PROD-CLEAN-001] `zxs clean` removes generated artifacts (`build/` and the `.zxs/` session/cache dir) so the next attempt starts clean; `--json` reports `{ ok, stage: "clean", removed: [path…] }`. [provenance: decision:ADR-0027]
- [id: CLI-PROD-TEST-001] `zxs test [path]` runs declarative asm tests from a directory or `*.test.json` spec (default `.`); `--list-assertions` prints the assertion vocabulary (the v2 set incl. the temporal/checkpoint + memory delta/range + `screenDiff` assertions, specified in `recipes-and-assertions.md`). [provenance: contract]
- [id: CLI-PROD-DOCTOR-001] `zxs doctor` checks the toolchain: Node ≥ 20, embedded `@zx-vibes/asm` importable, and the 48K ROM present (16384 bytes). `sjasmplus` is checked only when configured as the escape-hatch backend (ADR-0027 D3), not by default. [provenance: decision:ADR-0027]
- [id: CLI-PROD-SETUP-001] `zxs setup --agent <codex|claude>` generates/installs the agent config (the thin MCP snippet + the native skills registration); `--write-global` writes the Codex global config. [provenance: contract]

## Reverse-engineering add-on (optional, ADR-0027 D5)

- [id: CLI-PROD-REVENG-001] `snapshot` (info/ram/mem), `scan` (opcode/imm-range memory search), `xref` (static reference finder), and the reverse-engineering `gfx` sub-commands (`find`, `blit-linear`) are an **optional add-on** (e.g. `@zx-vibes/reveng` or a clearly-marked subcommand group), not core. They inspect *third-party* games — an agent *building* its own rarely needs them; the `zx-reverse-engineering` skill is retained as knowledge. Their legacy JSON shapes (e.g. `snapshot info` → `{ format, version, hardwareMode, … }`) are preserved by the add-on, not by core. [provenance: decision:ADR-0027]

## Outputs

- [id: CLI-PROD-OUT-BUILD-001] `build --json` reports `{ ok, stage: "build", entry, errorCount, warningCount, errors[], warnings[], outputs: { bin, sld, artifacts[] }, durationMs }`; `errors[]` carry `file:line` + `sourceLine` + a did-you-mean `hint` for self-correction. [provenance: contract]
- [id: CLI-PROD-OUT-BUILD-002] `build` exits `0` on success and `1` when assembly fails or no entry is configured. [provenance: contract]
- [id: CLI-PROD-OUT-RUN-001] `run --json` reports `{ ok, stage: "run", status, boot, exit: { reason, pc }, framesRun, tstatesRun, audio, registers, screen, input }` where `status` is one of `ok`, `hang`, `breakpoint`, `watchpoint`. [provenance: contract]
- [id: CLI-PROD-OUT-RUN-AUDIO-001] The `run` JSON `audio.beeperEdges` field is an integer count (≥ 0) of beeper (port `0xFE` bit-4) edge transitions during the run. [provenance: contract]
- [id: CLI-PROD-OUT-RUN-002] `run` exits `2` (HANG) when the watchdog detects a hang, and `0` otherwise. The watchdog reports a named verdict (`di-halt`, `rom-error`, `tight-loop`, `sp-corrupt`, `pc-in-rom`) + `likelyCause` in `exit`. [provenance: contract]
- [id: CLI-PROD-OUT-VERIFY-001] `verify --json` reports `{ ok, stage: "verify", build, run?, tests? }` where `run` is the full `run` report (CLI-PROD-OUT-RUN-001 shape); `ok` is true iff the build succeeded AND the run reported `ok` AND (no tests ran OR zero tests failed). [provenance: contract]
- [id: CLI-PROD-OUT-VERIFY-002] `verify` exits `0` when its `ok` is true and `1` otherwise. [provenance: contract]
- [id: CLI-PROD-OUT-TEST-001] `test --json` reports `{ ok, stage: "test", total, passed, failed, results[] }`; it exits `0` when all specs pass and `1` when any fails. [provenance: contract]
- [id: CLI-PROD-OUT-DOCTOR-001] `doctor --json` reports `{ ok, stage: "doctor", checks: [{ name, ok, detail }] }` and exits `3` (ENV_ERROR) if any check fails. [provenance: contract]
- [id: CLI-PROD-OUT-NEW-001] `new` exits `1` when the project name is invalid or the target directory already exists, and `0` otherwise. [provenance: contract]

## Rules

- [id: CLI-PROD-RULE-SESSION-001] The generative loop (`run`/`verify`/`test`) is **stateless/fresh by default** — it does not implicitly resume any on-disk session (ADR-0027). A persistent session is used only when `--state <file>` is given; then mutating commands persist it afterward unless `--no-save`/`--read-only` is set. The deterministic clean-ROM **boot cache** makes "always fresh" nearly free. [provenance: decision:ADR-0027]
- [id: CLI-PROD-RULE-VERIFY-001] `verify` is the single project acceptance gate: it must run the full build→run→(tests) pipeline, compose the real `run` report, and fail (non-zero exit) if any stage fails. [provenance: contract]
- [id: CLI-PROD-RULE-PREVIEW-PORT-001] `preview` binds `127.0.0.1` on the requested port, and (unless `--strict-port`) falls back to the next free port, up to a bounded number of attempts; `--strict-port` fails instead of falling back. [provenance: contract]
- [id: CLI-PROD-RULE-PREVIEW-OWN-001] A detached `preview` server is recorded in `.zxs/preview-server.json` with a per-server ownership token; `preview --stop` only stops a server whose recorded token it owns, else it fails (exit `1`). [provenance: contract]
- [id: CLI-PROD-RULE-DETERMINISM-001] For a fixed source-selection, frame budget, and input schedule, a `run`/`verify`/`test` produces the same machine-state and audio/screen summary across repeated invocations (reinforced by the stateless default; the basis for normalized CLI-snapshot fixtures). [provenance: contract]
- [id: CLI-PROD-RULE-SCREENSHOT-001] There is **one** screenshot encoder: `screen --png` (and `--base64`). `run --screenshot` and any `gfx` rendering route through it, not three independent encoders (ADR-0027). [provenance: decision:ADR-0027]

## Edge cases

- [id: CLI-PROD-EDGE-001] `run --until-break` raises the effective frame budget (≥ 3000 frames) so a breakpoint/watchpoint has time to fire. [provenance: contract]
- [id: CLI-PROD-EDGE-002] `break add` / `watch add` against a session with no symbol data still accept raw addresses; label/`file:line` specs require SLD symbols from a prior build. [provenance: contract]
- [id: CLI-PROD-EDGE-003] `break rm <id|all>` and `watch rm <id|all>` exit `1` when no matching entry exists. [provenance: contract]
- [id: CLI-PROD-EDGE-004] `init` against an existing project does not fail on present files (unlike `new`); it merges/preserves unless `--force` (ADR-0027). [provenance: decision:ADR-0027]

## Errors

- [id: CLI-PROD-ERR-001] User errors (bad args, missing config, missing files) are emitted as a structured error and map to exit `1`; the human-readable wording is incidental. [provenance: contract]
- [id: CLI-PROD-ERR-002] The full error catalog (messages, codes, recovery) across CLI/assembler/emulator is consolidated in `errors.md` (WX-02); this spec fixes only the exit-code mapping. [provenance: contract]

## Degrees of freedom

- [id: CLI-PROD-FREE-001] Human-readable (non-`--json`) text wording, colorization, and the contents of `next` hint arrays are Incidental — unspecified and the implementer's choice. [provenance: decision:ADR-0001]
- [id: CLI-PROD-FREE-002] Internal flags (e.g. `preview --detached-child`) and the on-disk byte layout of `.zxs/state.zxstate` are Incidental at the CLI surface; the session format is specified separately (`zxstate-format.md`) only to the extent consumers depend on it. [provenance: decision:ADR-0001]
- [id: CLI-PROD-FREE-003] The packaging of the optional reverse-engineering add-on (separate package `@zx-vibes/reveng` vs a gated subcommand group) is the implementer's choice, provided core does not depend on it and its absence is the documented default (ADR-0027 D5). [provenance: decision:ADR-0027]

## Provenance

- KEPT rows are `contract` — the `zxs` surface mined once from the oracle CLI
  (`packages/toolkit/src/cli/`, esp. `output.ts` for exit codes, `commands/verify.ts`
  for the verify pipeline, `commands/run.ts` for the run/audio JSON), unchanged in v2.
- v2 RE-SCOPE rows are `decision:ADR-0027` — the stateless-fresh default, the
  `boot`/`play`→`preview` collapse (with the D4 override keeping the player core), the
  `gfx` fold + reveng demotion, the one-screenshot/one-watchpoint consolidations, the
  D3 single-assembler lead, and the additions (`symbols`, `coverage`, `screen --base64`,
  `screen --diff`, Kempston `--joy`, `.tap`/`.scr`/`.z80` build outputs, `init`, `clean`).
  Additions exposing DNA-domain capabilities cite their domain spec (Kempston →
  `peripherals.md`; formats → `file-formats.md`).
- Two rows remain `decision:ADR-0001` (explicitly Incidental). No `UNKNOWN`.

## Examples

```bash
zxs build src/main.asm --json --tap      # also emits a loadable game.tap
zxs run --frames 300 --json              # fresh by default; audio.beeperEdges is an integer >= 0
zxs run --joy "60:R*30,90:RF*10" --json  # scheduled Kempston input (right, then right+fire)
zxs verify --json                        # exit 0 on pass, non-zero on any failure
zxs test tests/ --json                   # exit 0 iff all specs pass
zxs symbols --json                       # enumerate SLD labels -> addresses
zxs coverage --frames 300 --json         # which routines were reached?
zxs doctor --json                        # exit 3 if any toolchain check fails
zxs preview --port 5173 --detach --json  # optional human-review handoff (core player)
```

## Acceptance criteria

Conformance rows any regenerated `zxs` MUST satisfy (W4 slice, area `toolkit`;
fixtures under `conformance/cli/`). These re-home the rows deferred in ADR-0013:

- [id: CLI-PROD-AC-VERIFY-001] `zxs verify` exits `0` on a passing project and non-zero on failure → coverage row `CLI-EXIT-VERIFY-001` (fixture `conformance/cli/verify-exit.json`). Traces to CLI-PROD-OUT-VERIFY-002 / CLI-PROD-RULE-VERIFY-001. [provenance: contract]
- [id: CLI-PROD-AC-BEEPER-001] `zxs run --json` reports `audio.beeperEdges` as an integer `>= 0` → coverage row `RUN-BEEPER-001` (fixture `conformance/cli/run-beeper-edges.json`). Traces to CLI-PROD-OUT-RUN-AUDIO-001. [provenance: contract]
- [id: CLI-PROD-AC-EXIT-001] The exit-code enumeration (0 OK / 1 USER_ERROR / 2 HANG / 3 ENV_ERROR) is observable per CLI-PROD-EXIT-00x and is the normalization-stable contract a CLI-snapshot suite asserts. [provenance: contract]
