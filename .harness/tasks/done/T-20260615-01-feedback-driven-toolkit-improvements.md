---
id: T-20260615-01
title: Feedback-driven toolkit improvements backlog
status: done
areas: [toolkit, assembler, emulator, scaffolding, reference-docs, distribution]
created: 2026-06-15
completed: 2026-06-15
---

# Feedback-driven toolkit improvements backlog

## Goal

Turn the AI-agent dogfooding feedback in `.feedback/feedback-0.md` through
`.feedback/feedback-3.md` into focused, implementable improvements for
`zx-vibes`.

This is a roadmap task, not a single oversized patch. Implement it as small
branches/PRs with one coherent work package per change. Keep the codebase as
source of truth and re-check any feedback claim before changing behavior.

## Completion summary

Implemented a PR-sized foundation that touches every requested work package:

- Normalized `verify` and preview build boot paths to the cached ROM-ready
  baseline used by `run`/`test`, and surfaced boot mode metadata in JSON.
- Hardened session writes with retry/backoff, safer tmp names, and
  `ZXS_STATE_DIR`; added `run --read-only`/`--no-save` coverage and read-only
  source loading for investigative commands.
- Made key schedules explicit in `run --json` as run-start-relative, added
  temporary run-attached watchpoints (`--watch-read`, `--watch-write`,
  `--until-write`, `--until-change`, `--until-watch`), and enriched watchpoint
  hit JSON with instruction/disassembly context.
- Added snapshot and memory I/O: `snapshot info`, `snapshot ram`,
  `snapshot mem`, `mem dump`, and `mem load` for 48K `.z80` v1 / `.sna`
  workflows, with unsupported `.z80` v2/v3 called out.
- Added stateless source support for `screen`, `regs`, `mem read`, `disasm`,
  `trace`, `scan`, `xref`, and `gfx` via `--z80`, `--sna`, and
  `--bin --org` where practical.
- Added `zxs gfx` primitives for screen, attrs, linear/sheet/font rendering,
  deterministic candidate finding, and linear blit simulation.
- Added range disassembly, structured disassembly JSON, ROM annotations,
  `scan --opcode`, `scan --imm-range`, and `xref`.
- Added `docs/reference/sound.md`, `testing-assertions.md`,
  `reverse-engineering.md`, a reverse-engineering skill, ROM/IY/IX/string
  caveats, `zxs test --list-assertions`, and `attrNonBlank`/`coloredCells`.
- Added preview process tracking (`preview --list`, `--stop`, `--detach`),
  explicit non-JSON port-fallback warnings, and `zxs play` for `.z80`, `.sna`,
  `.tap`, and `.tzx`.
- Added headless audio edge timelines, approximate tone segments,
  `dominantHz`, and `run --wav`.
- Applied smaller polish: `watch clear`, looser generated smoke test,
  generated playbook nudges for `doctor`, `preview --json`, read-only
  inspection, and reverse-engineering docs.

Some backlog bullets were "consider" items and remain natural future
extensions rather than acceptance blockers: saved/replayable key schedules,
multi-hit watch logging or debugger scripting, full build/watch output locking,
true browser 50 Hz frame-lock documentation, `.z80` v2/v3/128K page export, and
browser audio worklet sanity checking.

## Validation completed

- `pnpm --filter @zx-vibes/toolkit typecheck`
- `pnpm --filter @zx-vibes/toolkit test`
- `pnpm --filter @zx-vibes/toolkit run check:docs`
- `pnpm --filter create-zx-vibes run check:assets`
- `pnpm --filter create-zx-vibes typecheck`
- `pnpm --filter create-zx-vibes test`
- `pnpm --filter @zx-vibes/toolkit lint` (exit 0; existing warnings only)
- `pnpm --filter create-zx-vibes lint` (exit 0; existing warnings only)
- `pnpm --filter @zx-vibes/asm typecheck`
- `pnpm --filter @zx-vibes/asm test`
- `pnpm run verify` (passed; lint warnings remain pre-existing/no-error)

## Already handled

Do not rework these unless verification shows a regression:

- `feedback-0.md` P1-1: runnable `zxs new` projects. Completed as
  `T-20260614-01`.
- Project-local agent skills and generated-project skill routing. Completed as
  `T-20260614-02`.
- `packages/toolkit/recipes/09-beeper-fx/` exists; remaining work is to make
  the sound docs and references accurate, not to recreate the recipe blindly.
- `feedback-0.md` marks band-limited beeper audio, stuck-key handling, and tape
  loading sound as already shipped. Verify current code before touching those
  paths.

## Highest-priority work packages

### 1. Normalize run/test/verify boot semantics

Problem: feedback reports that `verify`, `run`, and `test` can initialize the
machine differently, so the same binary may pass one path and fail another.

Implement:

- Audit `packages/toolkit/src/cli/commands/run.ts`,
  `test-cmd.ts`, `verify.ts`, and shared boot/session helpers.
- Make ROM boot, `IY`, sysvars, interrupts, and initial RAM assumptions
  consistent across user-facing commands, or emit a clear diagnostic where a
  command intentionally uses a different boot mode.
- Add regression coverage for ROM-dependent code that previously diverged
  between commands.

Acceptance:

- A ROM-dependent fixture has the same result under `zxs run`, `zxs test`, and
  `zxs verify`.
- Help/docs explain any intentional mode difference.

### 2. Make state safe and optionally read-only for agent workflows

Problem: persistent `.zxstate` mutations contaminate chained property tests and
can fail on Windows/managed environments with `EPERM` during tmp-file rename.

Implement:

- Add robust state write behavior in `packages/toolkit/src/cli/session.ts`
  (retry/backoff or safer replace strategy).
- Add a global or command-level read-only mode for investigative commands where
  no session mutation is required.
- Support a clean baseline workflow: explicit `state save` / `state load`,
  documented baseline files, and `run --fresh` / no-state guidance.
- Consider `ZXS_STATE_DIR` for redirecting session state outside project trees.

Acceptance:

- Read-only `run`/debug/investigation workflows do not write `.zxs/state.zxstate`.
- Property-test docs show "inject state -> run -> assert -> restore baseline".
- Windows-focused tests cover rename retry or read-only bypass behavior.

### 3. Clarify frame semantics and improve input scripting

Problem: frame budgets and input scheduling are hard for agents to reason about
because `--frames N` stops at frame boundaries and `--keys` uses global frame
numbers tied to one run invocation.

Implement:

- Document exactly what a frame budget includes and when execution stops
  relative to `HALT` and post-`HALT` loop code.
- Promote write-watchpoint or run-to-condition workflows for "did this write
  happen?" checks.
- Consider `run --until-write <addr>` / `--until-change <addr>` convenience
  flags.
- Add relative input scheduling, e.g. frames from the current run start, plus
  optional per-frame key-state output in `--json`.
- Consider saved/replayable input schedules across chained runs.

Acceptance:

- Docs and help explain `--frames` stop semantics with a concrete loop example.
- Agents can schedule input relative to a run without counting boot/menu frames
  by hand.

### 4. Add first-class snapshot and memory I/O

Problem: agents doing reverse engineering need raw RAM and snapshot metadata,
but today they must parse snapshots or hex output themselves.

Implement:

- `zxs snapshot info <file> --json` with registers, version, compression,
  hardware mode, interrupt state, and page layout where known.
- `zxs snapshot ram <file> --out ram.bin` and/or
  `zxs snapshot mem <file> <addr> --len <n> --out bytes.bin`.
- `zxs mem dump --range 0x4000-0xffff --out ram.bin` and optional
  `zxs mem load --addr 0x8000 --bin patch.bin`.
- Start with current 48K `.z80` v1 / `.sna` coverage, but document and design
  the path for `.z80` v2/v3 and 128K snapshots.

Acceptance:

- A loaded snapshot can export screen RAM and arbitrary ranges as binary files.
- JSON output is stable and parseable by agents.

### 5. Make investigative commands stateless and scriptable

Problem: reverse-engineering workflows currently require persistent sessions and
many separate `zxs` process round-trips.

Implement:

- Allow `regs`, `mem`, `disasm`, `trace`, `watch`, and `screen` to read directly
  from `--z80`, `--sna`, `--bin --org`, or an explicit `--state` file where
  practical.
- Add run-attached watchpoints such as `run --watch-write 0x4000-0x5aff
  --until-watch --json --no-save`.
- Add watchpoint hit JSON with PC, instruction, touched address, value,
  registers, and a short disassembly window.
- Consider `watch ... --on-hit log --count N` and/or `debug --script` for
  multi-step traces in one process.

Acceptance:

- A one-command read-only trace/watch workflow works from a snapshot.
- Repeated watch hits can be logged without manually re-running one breakpoint
  at a time.

### 6. Add graphics and asset extraction primitives

Problem: multiple feedback files report agents re-implementing generic Spectrum
graphics tooling: screen decode, attributes, sprite sheets, entropy scans, and
linear-to-screen blits.

Implement a `zxs gfx` family in `packages/toolkit`:

- `gfx screen` / `decode-screen`: render 6912-byte screen memory with attrs.
- `gfx linear` / `gfx sheet`: render 1bpp linear sprites by address,
  width-bytes, height, stride, count, scale, ink/paper, invert, transparency.
- `gfx attrs`: render or export attribute maps.
- `gfx font`: render fixed-size font/UDG tables.
- `gfx find`: heuristic scan for probable graphics regions, row stride, fonts,
  sprite/tile blocks, entropy changes, and inter-row correlation.
- `gfx blit-linear`: simulate common Spectrum linear-block-to-screen blitters.

Acceptance:

- A snapshot or session can produce PNGs for full screens, sprite sheets, and
  attribute views without custom scripts.
- `gfx find --json` returns deterministic candidate ranges useful to agents.

### 7. Improve disassembly, xref, and scan workflows

Problem: `disasm` is useful, but agents need structured output and code search
to follow call graphs and locate display-memory routines.

Implement:

- Range disassembly, e.g. `zxs disasm 0xd600-0xd660 --json`.
- Structured JSON operands, immediate targets, branch/call targets, and byte
  ranges.
- ROM symbol annotations and SLD/project symbol integration where available.
- Static helpers such as `zxs scan --opcode "ED B0"`,
  `zxs scan --imm-range 0x4000-0x5aff`, and `zxs xref --addr 0xd5e6 --json`.

Acceptance:

- Agents can parse disassembly and candidate xrefs without scraping prose.
- ROM entry points such as `RST 0x10`, `CLS`, and `BEEPER` are annotated.

### 8. Fill documentation and assertion gaps

Problem: the docs are strong, but several first-use and agent-testing paths are
still implicit or scattered.

Implement:

- Add `docs/reference/sound.md` covering port `0xfe` bit 4, ROM `BEEPER`,
  timing, blocking behavior, test strategy, `beeperEdges`, `portFEWrites`, and
  pitch/frequency limitations.
- Add a full assertion reference and/or `zxs test --list-assertions`, covering
  fields for `status`, `haltSynced`, `screenChanged`, `cellsNonBlank`,
  `screenIncludes`, `memEquals`, `regEquals`, `pixelAt`, `borderColor`,
  `beeperEdges`, and `portFEWrites`.
- Add ROM routine clobber data, especially `BEEPER` and `IX`/`IY` hazards.
- Warn about ROM print helpers that use zero-terminated strings with control
  codes; provide or document a counted-length variant.
- Add a reverse-engineering / asset-ripping skill and recipe: load snapshot,
  inspect screen/RAM, scan for graphics, watch draw routines, disassemble
  address formulas, and export assets.

Acceptance:

- Root docs, toolkit-copied docs, and create-package docs remain in sync.
- Generated-project playbooks route agents to the new docs/skills.

### 9. Improve preview/player lifecycle and browser UX

Problem: preview/watch workflows can collide with builds, silently serve stale
snapshots, fall back to a different port, or leave orphaned servers.

Implement:

- Loud non-JSON warning when `preview` falls back to another port.
- `zxs preview --list`, `--stop`, and `--detach` using tracked PID/lock files
  under `.zxs/`.
- Build/watch output locking or conflict detection so a one-shot `build` cannot
  silently race `preview --watch`.
- `zxs play <file.z80|file.sna|file.tap>` or `preview --load <file>` for opening
  arbitrary games in the browser player with sound.
- Consider a true 50 Hz / frame-locked preview mode, or document host-refresh
  flicker for XOR motion.

Acceptance:

- Agents can start, discover, and stop preview servers without OS-specific port
  cleanup.
- A stale preview build is surfaced as an error/warning, not hidden.
- A snapshot/tape can be opened directly in the player.

### 10. Add audio introspection and rendering

Problem: headless audio currently proves that sound happened, but not pitch,
melody, or audible output.

Implement:

- Capture timed beeper edge data with T-states or equivalent frame/cycle timing.
- Add `zxs run --wav out.wav` and JSON such as `audio.edgeTimeline`,
  `audio.toneSegments`, or `audio.dominantHz`.
- Add tests that can assert approximate note pitch for fixed-duration tones.
- Reuse current browser beeper DSP in fallback paths or remove obsolete fallback
  audio code.
- Consider a small `--check-audio` sanity command for browser/worklet audio.

Acceptance:

- A headless run can emit a playable WAV and enough timing metadata to assert
  pitch or note sequence.

## Smaller polish items

- Loosen generated smoke tests so the first extra sprite does not fail
  `cellsNonBlank max 1`.
- Add generated playbook nudges for `zxs doctor`, `preview --json`, and when to
  hand the user a `preview --watch` URL.
- Add `watch clear` as an alias for removing all watchpoints.
- Document that `--bin` starts from a fresh boot and that resuming after poking
  memory requires running without `--bin`.
- Add `screen --text` caveats for custom-font/bitmap games.
- Add `attrNonBlank` / `coloredCells`, or document reliable alternatives for
  attribute-only screens.
- Keep CLI errors and `--json` failures structured and include next-command
  hints where useful.

## Validation

- Toolkit command changes: `pnpm --filter @zx-vibes/toolkit typecheck`,
  `lint`, and focused Vitest files; use full toolkit tests for shared behavior.
- Emulator/snapshot changes: run the relevant emulator tests and toolkit
  integration tests.
- Docs/skills changes: run `pnpm --filter @zx-vibes/toolkit run check:docs`
  and `pnpm --filter create-zx-vibes run check:assets`.
- Cross-package behavior, generated assets, or package contracts: run root
  `pnpm run verify`.
